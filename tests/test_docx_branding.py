"""Tests for webapp/branding/: diagram placement in exported documents, Satoshi font embedding,
and the committed company reference doc."""

import re
import struct
import zipfile
import zlib
from pathlib import Path

import pytest

from webapp.branding import docx_export
from webapp.branding.docx_export import (
    MAX_DIAGRAM_HEIGHT_PT,
    REFERENCE_DOCX,
    TEXT_WIDTH_PT,
    DiagramPart,
    embed_fonts,
    find_pandoc,
    place_diagrams,
)
from webapp.branding.fonts import DOCX_FONTS


def _png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    raw = b"".join(b"\x00" + b"\xff" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _sizes(markdown: str) -> list[tuple[float, float]]:
    return [(float(w) * 72, float(h) * 72) for w, h in re.findall(r"\{width=([\d.]+)in height=([\d.]+)in\}", markdown)]


def _has_pandoc() -> bool:
    try:
        find_pandoc()
    except RuntimeError:
        return False
    return True


def test_diagram_parts_become_one_captioned_image_each(tmp_path):
    parts = [
        DiagramPart(_png(4, 4), 400, 600, "part 1 of 2"),
        DiagramPart(_png(4, 4), 400, 300, "part 2 of 2"),
    ]
    text = "Intro\n\n![Figure 1 — Process Flow](flowchart.png)\n\nOutro"

    out = place_diagrams(text, tmp_path, {"flowchart": parts}, ".export_x")

    assert "![Figure 1 — Process Flow (part 1 of 2)](.export_x_flowchart_1.png)" in out
    assert "![Figure 1 — Process Flow (part 2 of 2)](.export_x_flowchart_2.png)" in out
    assert (tmp_path / ".export_x_flowchart_1.png").read_bytes() == parts[0].png
    assert [v for size in _sizes(out) for v in size] == pytest.approx([400, 600, 400, 300], abs=0.1)
    assert out.startswith("Intro") and out.endswith("Outro")


def test_oversized_parts_are_scaled_down_to_the_page_keeping_aspect_ratio(tmp_path):
    out = place_diagrams("![F](flowchart.png)", tmp_path, {"flowchart": [DiagramPart(_png(1, 1), 902, 600)]}, ".x")
    ((width, height),) = _sizes(out)
    assert width == pytest.approx(TEXT_WIDTH_PT, abs=0.1)
    assert height == pytest.approx(300, abs=0.1)


def test_part_labels_cannot_break_the_markdown(tmp_path):
    out = place_diagrams("![F](flowchart.png)", tmp_path, {"flowchart": [DiagramPart(_png(1, 1), 10, 10, "a]b\n[c")]}, ".x")
    assert out.startswith("![F (abc)](.x_flowchart_1.png)")


def test_without_parts_the_uploaded_png_is_fitted_to_one_page(tmp_path):
    # The frontend uploads at 2x CSS pixels: 600x6000 px is a 225pt x 2250pt diagram.
    (tmp_path / "flowchart.png").write_bytes(_png(600, 6000))
    out = place_diagrams("![F](flowchart.png)", tmp_path, {}, ".x")
    ((width, height),) = _sizes(out)
    assert height == pytest.approx(MAX_DIAGRAM_HEIGHT_PT, abs=0.1)
    assert width == pytest.approx(MAX_DIAGRAM_HEIGHT_PT / 10, abs=0.1)


def test_missing_diagram_reference_is_dropped(tmp_path):
    assert place_diagrams("A\n![Arch](architecture.png)\nB", tmp_path, {}, ".x") == "A\n\nB"


def test_non_png_part_is_rejected():
    with pytest.raises(ValueError):
        DiagramPart(b"GIF89a....", 10, 10)


def test_font_obfuscation_follows_the_ooxml_key_order():
    font = bytes(range(64))
    key = "{00112233-4455-6677-8899-AABBCCDDEEFF}"
    obfuscated = docx_export._obfuscate(font, key)
    # Key bytes are the GUID's hex digits read from the end: FF, EE, DD, ... 00.
    assert obfuscated[0] == font[0] ^ 0xFF
    assert obfuscated[15] == font[15] ^ 0x00
    assert obfuscated[16] == font[16] ^ 0xFF
    assert obfuscated[32:] == font[32:]
    assert docx_export._obfuscate(obfuscated, key) == font


@pytest.mark.skipif(not _has_pandoc(), reason="pandoc not installed")
def test_embed_fonts_adds_every_brand_font(tmp_path):
    font_dir = tmp_path / "fonts"
    font_dir.mkdir()
    for _, _, filename in DOCX_FONTS:
        (font_dir / filename).write_bytes(filename.encode() * 20)
    (tmp_path / "doc.md").write_text("# Title\n\nBody text.", encoding="utf-8")
    docx = tmp_path / "doc.docx"
    docx_export.subprocess.run([find_pandoc(), "doc.md", "-o", "doc.docx"], cwd=tmp_path, check=True)

    embed_fonts(docx, font_dir)

    with zipfile.ZipFile(docx) as z:
        names = z.namelist()
        font_table = z.read("word/fontTable.xml").decode()
        rels = z.read("word/_rels/fontTable.xml.rels").decode()
        settings = z.read("word/settings.xml").decode()
        content_types = z.read("[Content_Types].xml").decode()
        embedded = {name: z.read(name) for name in names if name.startswith("word/fonts/")}
    assert len(embedded) == len(DOCX_FONTS)
    assert "<w:embedTrueTypeFonts />" in settings
    assert 'Extension="odttf"' in content_types
    for index, (family, slot, filename) in enumerate(DOCX_FONTS, start=1):
        match = re.search(rf'<w:embed{slot} r:id="rIdBrandFont{index}" w:fontKey="(\{{[0-9A-F-]+\}})" />', font_table)
        assert match, (family, slot)
        assert f'Target="fonts/brandfont{index}.odttf"' in rels
        original = (font_dir / filename).read_bytes()
        assert docx_export._obfuscate(embedded[f"word/fonts/brandfont{index}.odttf"], match.group(1)) == original
    assert font_table.count('<w:font w:name="Satoshi">') == 1
    assert font_table.count('<w:font w:name="Satoshi Medium">') == 1


def test_reference_doc_carries_the_company_branding():
    with zipfile.ZipFile(REFERENCE_DOCX) as z:
        document = z.read("word/document.xml").decode()
        styles = z.read("word/styles.xml").decode()
        header = z.read("word/header1.xml").decode()
        footer = z.read("word/footer1.xml").decode()
        assert "word/media/intuitive_logo.png" in z.namelist()
    assert '<w:pgSz w:w="11906" w:h="16838" />' in document  # A4 portrait
    assert 'r:id="rIdHeader1"' in document and 'r:id="rIdFooter1"' in document
    assert 'r:embed="rIdLogo"' in header
    assert " PAGE " in footer and '<w:jc w:val="right" />' in footer
    heading1 = re.search(r'w:styleId="Heading1">.*?</w:style>', styles, re.DOTALL).group(0)
    assert 'w:ascii="Satoshi"' in heading1 and 'w:val="003AE3"' in heading1 and 'w:sz w:val="48"' in heading1
    assert re.search(r'w:styleId="Heading3">.*?w:ascii="Satoshi Medium"', styles, re.DOTALL)


def test_reference_doc_is_up_to_date_with_its_build_script(tmp_path):
    """intuitive_reference.docx is committed; it must be what build_reference_docx.py produces."""
    if not _has_pandoc():
        pytest.skip("pandoc not installed")
    from webapp.branding.build_reference_docx import build

    rebuilt = build(tmp_path / "rebuilt.docx")
    with zipfile.ZipFile(REFERENCE_DOCX) as committed, zipfile.ZipFile(rebuilt) as fresh:
        for name in ("word/styles.xml", "word/document.xml", "word/header1.xml", "word/footer1.xml"):
            assert committed.read(name) == fresh.read(name), f"{name} is stale: rerun python -m webapp.branding.build_reference_docx"


def test_reference_doc_path_is_inside_the_branding_package():
    assert REFERENCE_DOCX.parent == Path(docx_export.__file__).parent
