"""Builds webapp/branding/intuitive_reference.docx: the pandoc --reference-doc that gives every
exported BRD/TSD/one-pager the company look (Satoshi type scale, #003AE3 headings, A4 portrait,
logo top-left in the header, page number bottom-right in the footer).

Pandoc only takes styles, page setup, header and footer from a reference doc — its body text is
ignored — so this script starts from pandoc's own default reference.docx (keeping its numbering,
theme and settings parts) and replaces just those pieces. The output is committed; rerun this only
when the branding changes:

    python -m webapp.branding.build_reference_docx

Fonts are NOT stored in the reference doc (see fonts.py: the Satoshi licence forbids committing
them to this public repo). Word falls back to another font wherever Satoshi isn't installed, so
export_docx embeds the font files into each exported document instead.
"""

import re
import shutil
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path

from .docx_export import REFERENCE_DOCX, find_pandoc

BRANDING_DIR = Path(__file__).resolve().parent
LOGO_PATH = BRANDING_DIR / "logo.png"
OUTPUT_PATH = REFERENCE_DOCX

FONT = "Satoshi"
FONT_MEDIUM = "Satoshi Medium"  # Word sees each non-RIBBI weight as its own family name
HEADING_BLUE = "003AE3"
TEXT = "1A1A1A"
MUTED = "5B6475"
TABLE_BORDER = "D0D5DD"
TABLE_HEADER_FILL = "EDF2FD"  # #003AE3 tinted towards white, for the table header row

# A4 portrait with 1-inch margins, in twentieths of a point. The text area this leaves
# (451pt x 698pt) is what the frontend fits diagrams into — keep frontend/src/lib/diagramLayout.ts
# in sync if these change.
PAGE_W, PAGE_H = 11906, 16838
MARGIN = 1440
HEADER_FOOTER_DISTANCE = 720
LOGO_HEIGHT_PT = 28

W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def _half_points(pt: int) -> int:
    return pt * 2


def _twips(pt: int) -> int:
    return pt * 20


def _rpr(font: str = FONT, size_pt: int = 12, bold: bool = False, italic: bool = False, color: str | None = None) -> str:
    parts = [f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}" w:cs="{font}" />']
    if bold:
        parts.append("<w:b /><w:bCs />")
    if italic:
        parts.append("<w:i /><w:iCs />")
    if color:
        parts.append(f'<w:color w:val="{color}" />')
    parts.append(f'<w:sz w:val="{_half_points(size_pt)}" /><w:szCs w:val="{_half_points(size_pt)}" />')
    return "<w:rPr>" + "".join(parts) + "</w:rPr>"


def _spacing(before_pt: int = 0, after_pt: int = 0, line: str = "") -> str:
    return f'<w:spacing w:before="{_twips(before_pt)}" w:after="{_twips(after_pt)}"{line} />'


# 16pt line height for 12pt text (atLeast, so an inline image or larger run still gets room).
BODY_LINE = ' w:line="320" w:lineRule="atLeast"'
SINGLE_LINE = ' w:line="240" w:lineRule="auto"'


def _paragraph_style(style_id: str, name: str, *, based_on: str = "Normal", next_style: str = "", custom: bool = False,
                     ppr: str = "", rpr: str = "", extra: str = "") -> str:
    custom_attr = ' w:customStyle="1"' if custom else ""
    next_xml = f'<w:next w:val="{next_style}" />' if next_style else ""
    based_xml = f'<w:basedOn w:val="{based_on}" />' if based_on else ""
    return (
        f'<w:style w:type="paragraph"{custom_attr} w:styleId="{style_id}"><w:name w:val="{name}" />{based_xml}{next_xml}'
        f'{extra}<w:qFormat />{f"<w:pPr>{ppr}</w:pPr>" if ppr else ""}{rpr}</w:style>'
    )


def _character_style(style_id: str, name: str, *, based_on: str = "DefaultParagraphFont", custom: bool = True, rpr: str = "") -> str:
    custom_attr = ' w:customStyle="1"' if custom else ""
    return f'<w:style w:type="character"{custom_attr} w:styleId="{style_id}"><w:name w:val="{name}" /><w:basedOn w:val="{based_on}" />{rpr}</w:style>'


# (style id, display name, size pt, font, bold, space before pt, space after pt). All headings are
# blue; hierarchy comes from the 4pt size scale plus Bold/Medium weight, per the brand guide.
HEADINGS = [
    ("Heading1", "heading 1", 24, FONT, True, 24, 12),
    ("Heading2", "heading 2", 16, FONT, True, 16, 8),
    ("Heading3", "heading 3", 16, FONT_MEDIUM, False, 12, 4),
    ("Heading4", "heading 4", 12, FONT, True, 12, 4),
    ("Heading5", "heading 5", 12, FONT_MEDIUM, False, 8, 4),
    ("Heading6", "heading 6", 12, FONT_MEDIUM, False, 8, 4),
    ("Heading7", "heading 7", 12, FONT_MEDIUM, False, 8, 4),
    ("Heading8", "heading 8", 12, FONT_MEDIUM, False, 8, 4),
    ("Heading9", "heading 9", 12, FONT_MEDIUM, False, 8, 4),
]


def build_styles_xml() -> str:
    styles = [
        _paragraph_style(
            "Normal", "Normal", based_on="", ppr=_spacing(0, 8, BODY_LINE), extra="",
            rpr=_rpr(color=TEXT),
        ).replace('<w:style w:type="paragraph"', '<w:style w:type="paragraph" w:default="1"', 1),
        _paragraph_style("BodyText", "Body Text", ppr=_spacing(0, 8, BODY_LINE), extra='<w:link w:val="BodyTextChar" />'),
        _paragraph_style("FirstParagraph", "First Paragraph", based_on="BodyText", next_style="BodyText", custom=True),
        _paragraph_style("Compact", "Compact", based_on="BodyText", custom=True, ppr=_spacing(2, 2, BODY_LINE)),
        _paragraph_style(
            "Title", "Title", next_style="BodyText", extra='<w:link w:val="TitleChar" />',
            ppr=_spacing(0, 24, SINGLE_LINE) + "<w:contextualSpacing />",
            rpr=_rpr(size_pt=32, bold=True, color=HEADING_BLUE),
        ),
        _character_style("TitleChar", "Title Char", rpr=_rpr(size_pt=32, bold=True, color=HEADING_BLUE)),
        _paragraph_style(
            "Subtitle", "Subtitle", based_on="Title", next_style="BodyText", extra='<w:link w:val="SubtitleChar" />',
            ppr=_spacing(0, 16, SINGLE_LINE), rpr=_rpr(FONT_MEDIUM, 16, color=MUTED),
        ),
        _character_style("SubtitleChar", "Subtitle Char", rpr=_rpr(FONT_MEDIUM, 16, color=MUTED)),
        _paragraph_style("Author", "Author", based_on="Normal", next_style="BodyText", custom=True,
                         ppr="<w:keepNext /><w:keepLines />", rpr=_rpr(color=MUTED)),
        _paragraph_style("Date", "Date", based_on="Normal", next_style="BodyText",
                         ppr="<w:keepNext /><w:keepLines />", rpr=_rpr(color=MUTED)),
        _paragraph_style("AbstractTitle", "Abstract Title", next_style="Abstract", custom=True,
                         ppr="<w:keepNext /><w:keepLines />" + _spacing(16, 4), rpr=_rpr(bold=True)),
        _paragraph_style("Abstract", "Abstract", next_style="BodyText", custom=True,
                         ppr="<w:keepNext /><w:keepLines />" + _spacing(4, 16, BODY_LINE)),
        _paragraph_style("Bibliography", "Bibliography", next_style="Bibliography"),
    ]

    for level, (style_id, name, size, font, bold, before, after) in enumerate(HEADINGS):
        heading_rpr = _rpr(font, size, bold=bold, color=HEADING_BLUE)
        styles.append(_paragraph_style(
            style_id, name, next_style="BodyText", extra=f'<w:link w:val="{style_id}Char" /><w:uiPriority w:val="9" />',
            ppr=f'<w:keepNext /><w:keepLines />{_spacing(before, after, SINGLE_LINE)}<w:outlineLvl w:val="{level}" />',
            rpr=heading_rpr,
        ))
        styles.append(_character_style(f"{style_id}Char", f"Heading {level + 1} Char", rpr=heading_rpr))

    styles += [
        _paragraph_style("BlockText", "Block Text", based_on="BodyText", next_style="BodyText",
                         ppr=f'<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="{HEADING_BLUE}" /></w:pBdr>'
                         + _spacing(8, 8, BODY_LINE) + '<w:ind w:left="320" w:right="320" w:firstLine="0" />',
                         rpr=_rpr(color=MUTED)),
        _paragraph_style("FootnoteText", "Footnote Text", next_style="FootnoteText", ppr=_spacing(0, 4, BODY_LINE)),
        _paragraph_style("FootnoteBlockText", "Footnote Block Text", based_on="FootnoteText", next_style="FootnoteText",
                         ppr=_spacing(4, 4, BODY_LINE) + '<w:ind w:left="480" w:right="480" w:firstLine="0" />'),
        '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font" /><w:semiHidden /><w:unhideWhenUsed /></w:style>',
        # Pandoc tags every table with this style. Header row: Medium weight on a light brand tint.
        '<w:style w:type="table" w:default="1" w:styleId="Table"><w:name w:val="Table" /><w:qFormat />'
        '<w:tblPr><w:tblInd w:w="0" w:type="dxa" />'
        f'<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" /><w:left w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" />'
        f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" /><w:right w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" />'
        f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" /><w:insideV w:val="single" w:sz="4" w:space="0" w:color="{TABLE_BORDER}" /></w:tblBorders>'
        '<w:tblCellMar><w:top w:w="80" w:type="dxa" /><w:left w:w="120" w:type="dxa" /><w:bottom w:w="80" w:type="dxa" /><w:right w:w="120" w:type="dxa" /></w:tblCellMar></w:tblPr>'
        f'<w:tblStylePr w:type="firstRow"><w:rPr><w:rFonts w:ascii="{FONT_MEDIUM}" w:hAnsi="{FONT_MEDIUM}" w:eastAsia="{FONT_MEDIUM}" w:cs="{FONT_MEDIUM}" /></w:rPr>'
        f'<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="{TABLE_HEADER_FILL}" /><w:vAlign w:val="bottom" /></w:tcPr></w:tblStylePr></w:style>',
        _paragraph_style("DefinitionTerm", "Definition Term", next_style="Definition", custom=True,
                         ppr="<w:keepNext /><w:keepLines />" + _spacing(0, 0, BODY_LINE), rpr=_rpr(bold=True)),
        _paragraph_style("Definition", "Definition", custom=True),
        _paragraph_style("Caption", "Caption", ppr=_spacing(4, 16, BODY_LINE), rpr=_rpr(color=MUTED)),
        _paragraph_style("TableCaption", "Table Caption", based_on="Caption", custom=True, ppr="<w:keepNext />" + _spacing(8, 4, BODY_LINE)),
        _paragraph_style("ImageCaption", "Image Caption", based_on="Caption", custom=True, ppr='<w:jc w:val="center" />'),
        # Diagram paragraphs: centred, single spacing (an atLeast line rule would still be fine, but
        # an inline picture must never sit in an "exact" line), kept with their caption.
        _paragraph_style("Figure", "Figure", custom=True, ppr=_spacing(8, 0, SINGLE_LINE) + '<w:jc w:val="center" />'),
        _paragraph_style("CaptionedFigure", "Captioned Figure", based_on="Figure", custom=True, ppr="<w:keepNext />"),
        _character_style("BodyTextChar", "Body Text Char"),
        _character_style("VerbatimChar", "Verbatim Char", based_on="BodyTextChar",
                         rpr='<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas" /><w:sz w:val="24" /><w:szCs w:val="24" /></w:rPr>'),
        _paragraph_style("SourceCode", "Source Code", custom=True,
                         ppr='<w:shd w:val="clear" w:color="auto" w:fill="F5F7FA" /><w:wordWrap w:val="off" />' + _spacing(8, 8, SINGLE_LINE),
                         rpr='<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas" /><w:sz w:val="24" /><w:szCs w:val="24" /></w:rPr>'),
        _character_style("SectionNumber", "Section Number", based_on="BodyTextChar"),
        _character_style("FootnoteReference", "Footnote Reference", based_on="BodyTextChar", custom=False,
                         rpr='<w:rPr><w:vertAlign w:val="superscript" /></w:rPr>'),
        _character_style("Hyperlink", "Hyperlink", based_on="BodyTextChar", custom=False,
                         rpr=f'<w:rPr><w:color w:val="{HEADING_BLUE}" /><w:u w:val="single" /></w:rPr>'),
        _paragraph_style("TOCHeading", "TOC Heading", based_on="Heading1", next_style="BodyText",
                         ppr='<w:outlineLvl w:val="9" />'),
        _paragraph_style("Header", "header", ppr=_spacing(0, 0, SINGLE_LINE), rpr=_rpr(color=MUTED)),
        _paragraph_style("Footer", "footer", ppr=_spacing(0, 0, SINGLE_LINE) + '<w:jc w:val="right" />', rpr=_rpr(color=MUTED)),
    ]

    doc_defaults = (
        "<w:docDefaults><w:rPrDefault>" + _rpr()[:-len("</w:rPr>")] + '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA" /></w:rPr>'
        "</w:rPrDefault><w:pPrDefault><w:pPr>" + _spacing(0, 8, BODY_LINE) + "</w:pPr></w:pPrDefault></w:docDefaults>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f"<w:styles {R_NS} {W_NS}>{doc_defaults}"
        '<w:latentStyles w:defLockedState="0" w:defUIPriority="0" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="276" />'
        + "".join(styles)
        + "</w:styles>"
    )


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    return struct.unpack(">II", data[16:24])


def build_header_xml() -> str:
    width_px, height_px = _png_size(LOGO_PATH)
    cy = LOGO_HEIGHT_PT * 12700  # EMU
    cx = round(cy * width_px / height_px)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:hdr {W_NS} {R_NS} '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<w:p><w:pPr><w:pStyle w:val="Header" /><w:jc w:val="left" /></w:pPr><w:r><w:drawing>'
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}" /><wp:docPr id="9001" name="Intuitive logo" descr="Intuitive logo" />'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
        '<pic:nvPicPr><pic:cNvPr id="0" name="intuitive_logo.png" /><pic:cNvPicPr /></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rIdLogo" /><a:stretch><a:fillRect /></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0" /><a:ext cx="{cx}" cy="{cy}" /></a:xfrm><a:prstGeom prst="rect"><a:avLst /></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>"
    )


def build_footer_xml() -> str:
    field = (
        '<w:r><w:fldChar w:fldCharType="begin" /></w:r>'
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate" /></w:r><w:r><w:t>1</w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="end" /></w:r>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:ftr {W_NS} {R_NS}><w:p><w:pPr><w:pStyle w:val="Footer" /><w:jc w:val="right" /></w:pPr>{field}</w:p></w:ftr>'
    )


SECT_PR = (
    "<w:sectPr>"
    '<w:headerReference w:type="default" r:id="rIdHeader1" />'
    '<w:footerReference w:type="default" r:id="rIdFooter1" />'
    '<w:footnotePr><w:numRestart w:val="eachSect" /></w:footnotePr>'
    f'<w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}" />'
    f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" w:left="{MARGIN}" '
    f'w:header="{HEADER_FOOTER_DISTANCE}" w:footer="{HEADER_FOOTER_DISTANCE}" w:gutter="0" />'
    "</w:sectPr>"
)

REL_HEADER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
REL_FOOTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'
REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'


def _default_reference_docx(dest: Path) -> None:
    subprocess.run([find_pandoc(), "-o", str(dest), "--print-default-data-file", "reference.docx"], check=True)


def build(output_path: Path = OUTPUT_PATH) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "default.docx"
        _default_reference_docx(base)
        with zipfile.ZipFile(base) as src:
            parts = {name: src.read(name) for name in src.namelist()}

    document = parts["word/document.xml"].decode("utf-8")
    document = re.sub(r"<w:sectPr>.*?</w:sectPr>", SECT_PR, document, flags=re.DOTALL)
    parts["word/document.xml"] = document.encode("utf-8")

    rels = parts["word/_rels/document.xml.rels"].decode("utf-8")
    rels = rels.replace(
        "</Relationships>",
        f'<Relationship Type="{REL_HEADER}" Id="rIdHeader1" Target="header1.xml" />'
        f'<Relationship Type="{REL_FOOTER}" Id="rIdFooter1" Target="footer1.xml" /></Relationships>',
    )
    parts["word/_rels/document.xml.rels"] = rels.encode("utf-8")

    content_types = parts["[Content_Types].xml"].decode("utf-8")
    content_types = content_types.replace(
        "</Types>",
        '<Default Extension="png" ContentType="image/png" />'
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" />'
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" /></Types>',
    )
    parts["[Content_Types].xml"] = content_types.encode("utf-8")

    # Theme fonts too, so anything that still asks for "the body/heading theme font" gets Satoshi.
    theme = parts["word/theme/theme1.xml"].decode("utf-8")
    theme = re.sub(r'(<a:(?:major|minor)Font>\s*<a:latin typeface=")[^"]*', rf"\g<1>{FONT}", theme)
    parts["word/theme/theme1.xml"] = theme.encode("utf-8")

    parts["word/styles.xml"] = build_styles_xml().encode("utf-8")
    parts["word/header1.xml"] = build_header_xml().encode("utf-8")
    parts["word/_rels/header1.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rIdLogo" Type="{REL_IMAGE}" Target="media/intuitive_logo.png" /></Relationships>'
    ).encode("utf-8")
    parts["word/footer1.xml"] = build_footer_xml().encode("utf-8")
    parts["word/media/intuitive_logo.png"] = LOGO_PATH.read_bytes()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    partial = output_path.with_suffix(".tmp")
    with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as out:
        # [Content_Types].xml first, as Office expects.
        out.writestr("[Content_Types].xml", parts.pop("[Content_Types].xml"))
        for name, data in parts.items():
            out.writestr(name, data)
    shutil.move(partial, output_path)
    return output_path


if __name__ == "__main__":
    print(f"Wrote {build()}")
