"""Bounded, text-only extraction from a DOCX WordprocessingML document."""

import io
import zipfile
from xml.etree import ElementTree


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOCX_MAIN_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
OFFICE_DOCUMENT_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
MAX_DOCX_XML_BYTES = 2 * 1024 * 1024
MAX_METADATA_XML_BYTES = 64 * 1024
MAX_ZIP_ENTRIES = 2048


class InvalidThesisDocxError(ValueError):
    pass


def _read_entry(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    if info.file_size > limit or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} or info.flag_bits & 1:
        raise InvalidThesisDocxError("The DOCX document is invalid or too large to extract safely.")
    with archive.open(info) as stream:
        data = stream.read(limit + 1)
    if len(data) > limit or len(data) != info.file_size:
        raise InvalidThesisDocxError("The DOCX document is invalid or too large to extract safely.")
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise InvalidThesisDocxError("The DOCX document contains unsupported XML declarations.")
    return data


def extract_thesis_docx_text(content: bytes) -> str:
    """Read only the content-type manifest and main document XML; never extract files."""
    if not content.startswith(b"PK\x03\x04"):
        raise InvalidThesisDocxError("The DOCX file is not a valid ZIP document.")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise InvalidThesisDocxError("The DOCX document contains too many entries.")
            if any(info.filename.lower().endswith("vbaproject.bin") for info in entries):
                raise InvalidThesisDocxError("Macro-enabled Word documents are not supported.")
            required = ("[Content_Types].xml", "_rels/.rels", "word/document.xml")
            info_by_name = {}
            for info in entries:
                if info.filename in required:
                    if info.filename in info_by_name:
                        raise InvalidThesisDocxError("The DOCX document contains duplicate required entries.")
                    info_by_name[info.filename] = info
            if any(name not in info_by_name for name in required):
                raise InvalidThesisDocxError("The DOCX document is missing its main document XML.")
            manifest = ElementTree.fromstring(_read_entry(archive, info_by_name[required[0]], MAX_METADATA_XML_BYTES))
            if manifest.tag != f"{{{CONTENT_TYPES_NS}}}Types" or not any(
                item.tag == f"{{{CONTENT_TYPES_NS}}}Override"
                and item.get("PartName") == "/word/document.xml"
                and item.get("ContentType") == DOCX_MAIN_CONTENT_TYPE
                for item in manifest
            ):
                raise InvalidThesisDocxError("The DOCX content type is invalid.")
            relationships = ElementTree.fromstring(_read_entry(archive, info_by_name[required[1]], MAX_METADATA_XML_BYTES))
            if relationships.tag != f"{{{RELATIONSHIPS_NS}}}Relationships" or not any(
                item.tag == f"{{{RELATIONSHIPS_NS}}}Relationship"
                and item.get("Type") == OFFICE_DOCUMENT_RELATIONSHIP
                and item.get("Target") in {"word/document.xml", "/word/document.xml"}
                and item.get("TargetMode") != "External"
                for item in relationships
            ):
                raise InvalidThesisDocxError("The DOCX main document relationship is invalid.")
            document = ElementTree.fromstring(_read_entry(archive, info_by_name[required[2]], MAX_DOCX_XML_BYTES))
            if document.tag != f"{{{WORD_NS}}}document":
                raise InvalidThesisDocxError("The DOCX document XML is invalid.")
            body = document.find(f"{{{WORD_NS}}}body")
            if body is None:
                raise InvalidThesisDocxError("The DOCX document has no body.")
            paragraphs = []
            for paragraph in body.iter(f"{{{WORD_NS}}}p"):
                parts = []
                for node in paragraph.iter():
                    if node.tag == f"{{{WORD_NS}}}t":
                        parts.append(node.text or "")
                    elif node.tag in {f"{{{WORD_NS}}}tab", f"{{{WORD_NS}}}br"}:
                        parts.append(" ")
                line = " ".join("".join(parts).split())
                if line:
                    paragraphs.append(line)
            text = "\n".join(paragraphs)
            if not any(char.isalnum() for char in text):
                raise InvalidThesisDocxError("No readable thesis text was found in this document.")
            return text
    except (zipfile.BadZipFile, RuntimeError, ElementTree.ParseError, UnicodeError, EOFError) as error:
        raise InvalidThesisDocxError("The DOCX file could not be read.") from error
