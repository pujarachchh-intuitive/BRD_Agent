"""Satoshi font files: where they live and how to fetch them.

The Satoshi licence (ITF Free Font License, fontshare.com) lets us self-host the font for our own
app and embed it in documents we produce, but forbids redistributing the files through publicly
accessible servers — and this repo is public on GitHub. So the font files are never committed
(see .gitignore); they're downloaded straight from Fontshare instead:

    python -m webapp.branding.fonts

once per dev machine, and at image build time by the Dockerfiles. Everything that uses them
degrades gracefully if they're missing (the DOCX export just skips embedding them).
"""

import io
import sys
import urllib.request
import zipfile
from pathlib import Path

SATOSHI_DOWNLOAD_URL = "https://api.fontshare.com/v2/fonts/download/satoshi"

BRANDING_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRANDING_DIR.parent.parent
DOCX_FONT_DIR = BRANDING_DIR / "fonts"
WEB_FONT_DIR = REPO_ROOT / "frontend" / "public" / "fonts"

# (Word font family, embed slot, file). Word only knows four styles per family (regular, bold,
# italic, bold italic); every other weight is its own family name, which is why Medium is listed
# as the "Satoshi Medium" family's regular. These are exactly the fonts the reference doc's styles
# ask for (build_reference_docx.py).
DOCX_FONTS: list[tuple[str, str, str]] = [
    ("Satoshi", "Regular", "Satoshi-Regular.ttf"),
    ("Satoshi", "Bold", "Satoshi-Bold.ttf"),
    ("Satoshi", "Italic", "Satoshi-Italic.ttf"),
    ("Satoshi", "BoldItalic", "Satoshi-BoldItalic.ttf"),
    ("Satoshi Medium", "Regular", "Satoshi-Medium.ttf"),
]

WEB_FONTS = [
    "Satoshi-Regular.woff2",
    "Satoshi-Italic.woff2",
    "Satoshi-Medium.woff2",
    "Satoshi-Bold.woff2",
    "Satoshi-BoldItalic.woff2",
]


def fetch(docx_dir: Path = DOCX_FONT_DIR, web_dir: Path | None = WEB_FONT_DIR) -> None:
    """Downloads the official Satoshi package and extracts the TTFs the DOCX export embeds (and,
    if web_dir is given, the WOFF2s the frontend serves). Files are copied unmodified."""
    request = urllib.request.Request(SATOSHI_DOWNLOAD_URL, headers={"User-Agent": "Mozilla/5.0 (BRD Agent font fetch)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        package = zipfile.ZipFile(io.BytesIO(response.read()))

    by_basename = {Path(name).name: name for name in package.namelist() if "/WEB/fonts/" in name}
    wanted = [(docx_dir, filename) for _, _, filename in DOCX_FONTS]
    if web_dir is not None:
        wanted += [(web_dir, filename) for filename in WEB_FONTS]
    for target_dir, filename in wanted:
        if filename not in by_basename:
            raise RuntimeError(f"{filename} not found in the Satoshi package from {SATOSHI_DOWNLOAD_URL}")
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / filename).write_bytes(package.read(by_basename[filename]))


def docx_fonts_available(font_dir: Path = DOCX_FONT_DIR) -> bool:
    return all((font_dir / filename).exists() for _, _, filename in DOCX_FONTS)


if __name__ == "__main__":
    # --docx-only: the backend image has no frontend/ folder to write web fonts into.
    fetch(web_dir=None if "--docx-only" in sys.argv else WEB_FONT_DIR)
    print(f"Satoshi fonts written to {DOCX_FONT_DIR}" + ("" if "--docx-only" in sys.argv else f" and {WEB_FONT_DIR}"))
