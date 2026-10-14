"""Markdown -> branded DOCX: runs pandoc with the company reference doc, sizes the diagram images
so each one fits on an A4 portrait page, and embeds the Satoshi fonts into the result.
"""

import base64
import re
import shutil
import struct
import subprocess
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .fonts import DOCX_FONT_DIR, DOCX_FONTS, docx_fonts_available

BRANDING_DIR = Path(__file__).resolve().parent
REFERENCE_DOCX = BRANDING_DIR / "intuitive_reference.docx"

# The reference doc's text area (A4, 1-inch margins — see build_reference_docx.py) is 451pt x
# 698pt. A diagram image may use the full width, but leaves room on its page for the spacing above
# it and its one-line caption below; frontend/src/lib/diagramLayout.ts uses the same numbers.
TEXT_WIDTH_PT = 451.0
MAX_DIAGRAM_HEIGHT_PT = 640.0

DIAGRAM_NAMES = ("architecture", "flowchart")


@dataclass
class DiagramPart:
    """One page's worth of a diagram, as laid out by the frontend: PNG bytes, the size (in points)
    it should be printed at, and a caption suffix such as "part 2 of 3" (empty for a diagram that
    fits on one page)."""

    png: bytes
    width_pt: float
    height_pt: float
    label: str = ""

    def __post_init__(self) -> None:
        _png_size(self.png)  # raises ValueError if this isn't a PNG


def find_pandoc() -> str:
    found = shutil.which("pandoc")
    if found:
        return found
    fallback = Path.home() / "AppData" / "Local" / "Pandoc" / "pandoc.exe"
    if fallback.exists():
        return str(fallback)
    raise RuntimeError("pandoc not found on PATH or at the default install location")


def decode_png_data_url(data_url: str) -> bytes:
    match = re.match(r"^data:image/png;base64,(.+)$", data_url, re.DOTALL)
    return base64.b64decode(match.group(1) if match else data_url)


def _png_size(data: bytes) -> tuple[int, int]:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG image")
    return struct.unpack(">II", data[16:24])


def _fit(width_pt: float, height_pt: float, max_w: float = TEXT_WIDTH_PT, max_h: float = MAX_DIAGRAM_HEIGHT_PT) -> tuple[float, float]:
    """Scales (width, height) down — never up — to fit inside max_w x max_h, keeping the aspect ratio."""
    scale = min(1.0, max_w / width_pt, max_h / height_pt)
    return width_pt * scale, height_pt * scale


def _image_markdown(caption: str, filename: str, width_pt: float, height_pt: float) -> str:
    # Pandoc's size attributes don't accept points, so convert to inches.
    return f"![{caption}]({filename}){{width={width_pt / 72:.3f}in height={height_pt / 72:.3f}in}}"


def place_diagrams(text: str, run_dir: Path, parts_by_name: dict[str, list[DiagramPart]], prefix: str) -> str:
    """Rewrites each `![caption](flowchart.png)` / `![caption](architecture.png)` reference in a
    document so the diagram prints at a known size that fits on one A4 portrait page.

    If the frontend sent the diagram already split into page-sized parts (parts_by_name), each part
    becomes its own image, captioned with the part's label (e.g. "Process Flow (part 1 of 3)") and
    written to run_dir as <prefix>_<name>_<i>.png.
    Otherwise the full diagram PNG from the earlier upload is scaled to fit the page. If neither
    exists the reference is dropped, so pandoc doesn't fail on a missing file."""
    for name in DIAGRAM_NAMES:
        pattern = re.compile(rf"!\[([^\]]*)\]\({re.escape(name)}\.png\)(\{{[^}}]*\}})?")
        parts = parts_by_name.get(name) or []
        full_png = run_dir / f"{name}.png"

        def replace(match: re.Match, name: str = name, parts: list[DiagramPart] = parts, full_png: Path = full_png) -> str:
            caption = match.group(1).strip() or f"{name.title()} diagram"
            if parts:
                images = []
                for index, part in enumerate(parts, start=1):
                    filename = f"{prefix}_{name}_{index}.png"
                    (run_dir / filename).write_bytes(part.png)
                    # Brackets/newlines would break the markdown image syntax the label goes into.
                    label = re.sub(r"[\[\]\r\n]", "", part.label).strip()[:80]
                    label = label or ("" if len(parts) == 1 else f"part {index} of {len(parts)}")
                    part_caption = f"{caption} ({label})" if label else caption
                    images.append(_image_markdown(part_caption, filename, *_fit(part.width_pt, part.height_pt)))
                return "\n\n".join(images)
            if full_png.exists():
                width_px, height_px = _png_size(full_png.read_bytes())
                # The frontend rasterizes at 2x CSS pixels, and one CSS pixel is 0.75pt.
                return _image_markdown(caption, full_png.name, *_fit(width_px / 2 * 0.75, height_px / 2 * 0.75))
            return ""

        text = pattern.sub(replace, text)
    return text


def markdown_to_docx(md_path: Path, out_path: Path) -> None:
    """Runs pandoc in md_path's folder (so relative image paths resolve) with the company reference
    doc, then embeds the brand fonts."""
    cmd = [find_pandoc(), md_path.name, "-o", out_path.name]
    if REFERENCE_DOCX.exists():
        cmd += ["--reference-doc", str(REFERENCE_DOCX)]
    subprocess.run(cmd, cwd=str(md_path.parent), check=True, capture_output=True)
    if docx_fonts_available():
        embed_fonts(out_path)
    else:
        print(f"Satoshi fonts not found in {DOCX_FONT_DIR}; exported {out_path.name} without embedded fonts "
              "(run `python -m webapp.branding.fonts` to fetch them).")


# --- Font embedding -------------------------------------------------------------------------------
# A .docx can carry its own fonts (Word: File > Options > Save > "Embed fonts in the file"), so the
# document looks right on machines without Satoshi installed. The format (ECMA-376 Part 1, 17.8.1)
# stores each font obfuscated: the first 32 bytes are XORed with a per-font GUID key, so the file
# inside the package isn't a usable standalone font — which is also what the Satoshi licence asks
# of embedded copies.

_OBFUSCATED_FONT_TYPE = "application/vnd.openxmlformats-officedocument.obfuscatedFont"
_FONT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
# settings.xml children that the schema puts before <w:embedTrueTypeFonts>.
_SETTINGS_BEFORE_EMBED = (
    "writeProtection", "view", "zoom", "removePersonalInformation", "removeDateAndTime",
    "doNotDisplayPageBoundaries", "displayBackgroundShape", "printPostScriptOverText",
    "printFractionalCharacterWidth", "printFormsData",
)


def _obfuscate(font: bytes, font_key: str) -> bytes:
    key = bytes.fromhex(font_key.strip("{}").replace("-", ""))[::-1]
    head = bytes(font[i] ^ key[i % 16] for i in range(32))
    return head + font[32:]


def embed_fonts(docx_path: Path, font_dir: Path = DOCX_FONT_DIR) -> None:
    with zipfile.ZipFile(docx_path) as src:
        parts = {name: src.read(name) for name in src.namelist()}

    font_table = parts["word/fontTable.xml"].decode("utf-8")
    rels_name = "word/_rels/fontTable.xml.rels"
    rels = parts.get(rels_name, b"").decode("utf-8") or (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    )

    embeds_by_family: dict[str, list[str]] = {}
    for index, (family, slot, filename) in enumerate(DOCX_FONTS, start=1):
        font_key = "{" + str(uuid.uuid4()).upper() + "}"
        rel_id = f"rIdBrandFont{index}"
        parts[f"word/fonts/brandfont{index}.odttf"] = _obfuscate((font_dir / filename).read_bytes(), font_key)
        rels = rels.replace(
            "</Relationships>",
            f'<Relationship Id="{rel_id}" Type="{_FONT_REL_TYPE}" Target="fonts/brandfont{index}.odttf" /></Relationships>',
        )
        embeds_by_family.setdefault(family, []).append(f'<w:embed{slot} r:id="{rel_id}" w:fontKey="{font_key}" />')

    for family, embeds in embeds_by_family.items():
        # Drop any entry pandoc/Word already wrote for this family, then add ours with the embeds.
        font_table = re.sub(rf'<w:font w:name="{re.escape(family)}"\s*>.*?</w:font>', "", font_table, flags=re.DOTALL)
        entry = (
            f'<w:font w:name="{family}"><w:charset w:val="00" /><w:family w:val="auto" /><w:pitch w:val="variable" />'
            + "".join(embeds) + "</w:font>"
        )
        font_table = font_table.replace("</w:fonts>", entry + "</w:fonts>")
    fonts_start = font_table.index("<w:fonts")
    if 'xmlns:r="' not in font_table[fonts_start:font_table.index(">", fonts_start)]:
        font_table = font_table.replace(
            "<w:fonts ", '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1
        )
    parts["word/fontTable.xml"] = font_table.encode("utf-8")
    parts[rels_name] = rels.encode("utf-8")

    content_types = parts["[Content_Types].xml"].decode("utf-8")
    if 'Extension="odttf"' not in content_types:
        content_types = content_types.replace(
            "</Types>", f'<Default Extension="odttf" ContentType="{_OBFUSCATED_FONT_TYPE}" /></Types>'
        )
    parts["[Content_Types].xml"] = content_types.encode("utf-8")

    settings = parts["word/settings.xml"].decode("utf-8")
    if "<w:embedTrueTypeFonts" not in settings:
        insert_at = settings.index(">", settings.index("<w:settings")) + 1
        for element in _SETTINGS_BEFORE_EMBED:
            match = None
            for match in re.finditer(rf"<w:{element}\b[^>]*?(/>|>.*?</w:{element}>)", settings, flags=re.DOTALL):
                pass
            if match:
                insert_at = max(insert_at, match.end())
        settings = settings[:insert_at] + "<w:embedTrueTypeFonts />" + settings[insert_at:]
    parts["word/settings.xml"] = settings.encode("utf-8")

    partial = docx_path.with_name(f".{docx_path.name}.{uuid.uuid4().hex}.part")
    with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as out:
        out.writestr("[Content_Types].xml", parts.pop("[Content_Types].xml"))
        for name, data in parts.items():
            out.writestr(name, data)
    partial.replace(docx_path)
