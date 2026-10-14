"""Validation and local text extraction for uploaded project documents.

Parsing is done locally wherever possible, since it's free: TXT/MD are decoded, DOCX goes through
pandoc (already in the backend image for the .docx export), and text-layer PDFs through pypdf. Only
a PDF with no usable text layer (a scan) is left for Gemini to read natively, flagged as
needs_native, because that's the one case local parsing can't handle without an OCR engine.

Every check here raises UploadRejected with a message written for the end user, naming the file.
"""

import hashlib
import io
import re
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from pypdf import PdfReader

from webapp.branding.docx_export import find_pandoc

MAX_FILES = 5
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 30 * 1024 * 1024
MAX_PDF_PAGES = 200

# Rough token estimates, used only to decide between one combined extraction call and per-file
# calls (and to reject files no single call could hold).
CHARS_PER_TOKEN = 4
TOKENS_PER_SCANNED_PAGE = 600
MAX_FILE_TOKENS = 150_000

# A PDF page with fewer extracted characters than this on average is treated as a scan.
_MIN_CHARS_PER_PAGE = 50

# DOCX is a zip: cap what it may expand to, so a crafted file can't exhaust memory or disk.
_MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
_MAX_DOCX_ENTRIES = 5_000

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}


class UploadRejected(ValueError):
    """A user-facing reason an uploaded file can't be used."""


@dataclass
class ParsedDocument:
    file_name: str
    kind: str  # "pdf" | "docx" | "txt" | "md"
    sha256: str
    size_bytes: int
    text: str = ""  # Markdown-ish text; empty when needs_native
    page_count: int | None = None
    needs_native: bool = False  # a scanned PDF, sent to Gemini as the raw file instead of text
    raw: bytes = field(default=b"", repr=False)  # the uploaded bytes, as received

    @property
    def estimated_tokens(self) -> int:
        if self.needs_native:
            return (self.page_count or 1) * TOKENS_PER_SCANNED_PAGE
        return len(self.text) // CHARS_PER_TOKEN + 1


def safe_file_name(name: str) -> str:
    """The uploaded name reduced to a safe basename: no directories, no characters that could
    misbehave in a Volume path, and a bounded length that keeps the extension."""
    base = Path(name.replace("\\", "/")).name or "document"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._") or "document"
    ext = re.sub(r"[^A-Za-z0-9]+", "", ext)[:8]
    return f"{stem[:80]}.{ext.lower()}" if ext else stem[:80]


def _extension(file_name: str) -> str:
    return Path(file_name).suffix.lower()


def check_extension(file_name: str) -> str:
    ext = _extension(file_name)
    if ext == ".doc":
        raise UploadRejected(
            f"{file_name}: the old Word .doc format isn't supported. Open it in Word and use "
            "Save As > Word Document (.docx), then upload that."
        )
    if ext == ".docm":
        raise UploadRejected(f"{file_name}: macro-enabled Word files aren't accepted. Save it as a .docx without macros.")
    if ext not in SUPPORTED_EXTENSIONS:
        raise UploadRejected(f"{file_name}: unsupported file type. Upload a PDF, DOCX, TXT, or MD file.")
    return ext.lstrip(".")


def parse_document(file_name: str, data: bytes) -> ParsedDocument:
    """Validates one uploaded file against its claimed type and extracts its text."""
    kind = check_extension(file_name)
    if not data:
        raise UploadRejected(f"{file_name}: the file is empty.")
    if len(data) > MAX_FILE_BYTES:
        raise UploadRejected(f"{file_name}: the file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")

    doc = ParsedDocument(
        file_name=file_name, kind=kind, sha256=hashlib.sha256(data).hexdigest(), size_bytes=len(data), raw=data
    )
    if kind == "pdf":
        _parse_pdf(doc, data)
    elif kind == "docx":
        doc.text = _parse_docx(file_name, data)
    else:
        doc.text = _decode_text(file_name, data)

    if not doc.needs_native and not doc.text.strip():
        raise UploadRejected(f"{file_name}: no readable text was found in this file.")
    if doc.estimated_tokens > MAX_FILE_TOKENS:
        raise UploadRejected(
            f"{file_name}: this document is too long to process in one go (about "
            f"{doc.estimated_tokens:,} tokens). Split it into smaller files, or upload only the relevant sections."
        )
    return doc


def _decode_text(file_name: str, data: bytes) -> str:
    if b"\x00" in data[:8192]:
        raise UploadRejected(f"{file_name}: this doesn't look like a text file.")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding).replace("\r\n", "\n")
        except UnicodeDecodeError:
            continue
    raise UploadRejected(f"{file_name}: the text encoding couldn't be read. Save it as UTF-8 and try again.")


def _parse_pdf(doc: ParsedDocument, data: bytes) -> None:
    if not data.lstrip()[:5].startswith(b"%PDF-"):
        raise UploadRejected(f"{doc.file_name}: this file isn't a valid PDF.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # Many PDFs are "encrypted" with an empty user password purely to restrict editing;
            # those open fine. Only a real open-password blocks us.
            try:
                opened = reader.decrypt("")
            except Exception:  # noqa: BLE001 — unsupported encryption algorithms raise various errors
                opened = 0
            if not opened:
                raise UploadRejected(
                    f"{doc.file_name}: this PDF is password-protected. Remove the password and upload it again."
                )
        page_count = len(reader.pages)
        if page_count > MAX_PDF_PAGES:
            raise UploadRejected(f"{doc.file_name}: the PDF has {page_count} pages; the limit is {MAX_PDF_PAGES}.")
        pages = []
        total_chars = 0
        for number, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            total_chars += len(text)
            pages.append(f"--- Page {number} ---\n{text}")
    except UploadRejected:
        raise
    except Exception as exc:  # noqa: BLE001 — pypdf raises a wide range of errors on damaged files
        raise UploadRejected(f"{doc.file_name}: this PDF couldn't be read ({type(exc).__name__}).") from exc

    doc.page_count = page_count
    if page_count and total_chars / page_count < _MIN_CHARS_PER_PAGE:
        doc.needs_native = True
    else:
        doc.text = "\n\n".join(pages)


def _check_docx_container(file_name: str, data: bytes) -> None:
    if not data.startswith(b"PK\x03\x04"):
        raise UploadRejected(f"{file_name}: this file isn't a valid DOCX.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
    except zipfile.BadZipFile as exc:
        raise UploadRejected(f"{file_name}: this file isn't a valid DOCX.") from exc
    names = {entry.filename for entry in entries}
    if "word/document.xml" not in names:
        raise UploadRejected(f"{file_name}: this file isn't a valid DOCX.")
    if any(name.lower().endswith("vbaproject.bin") for name in names):
        raise UploadRejected(f"{file_name}: files containing macros aren't accepted. Save it as a .docx without macros.")
    if len(entries) > _MAX_DOCX_ENTRIES or sum(entry.file_size for entry in entries) > _MAX_DOCX_UNCOMPRESSED_BYTES:
        raise UploadRejected(f"{file_name}: this DOCX expands to an unreasonably large size and was rejected.")


def _parse_docx(file_name: str, data: bytes) -> str:
    _check_docx_container(file_name, data)
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "input.docx"
        source.write_bytes(data)
        try:
            completed = subprocess.run(
                [find_pandoc(), str(source), "-f", "docx", "-t", "gfm", "--wrap=none", "--track-changes=accept"],
                check=True,
                capture_output=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired as exc:
            raise UploadRejected(f"{file_name}: reading this DOCX took too long.") from exc
        except subprocess.CalledProcessError as exc:
            raise UploadRejected(f"{file_name}: this DOCX couldn't be read.") from exc
    text = completed.stdout.decode("utf-8", errors="replace")
    # Embedded images aren't uploaded anywhere, so their references are just noise to the model.
    return re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text).replace("\r\n", "\n")
