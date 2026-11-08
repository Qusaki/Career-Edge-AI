import { unzipSync } from 'fflate';
import { THESIS_ABSTRACT_MAX_BYTES } from './thesisAbstractUpload';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCX_MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const OFFICE_DOCUMENT_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MAX_DOCUMENT_XML_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_XML_BYTES = 64 * 1024;
const MAX_ZIP_ENTRIES = 2048;
const INVALID_DOCX_MESSAGE = 'The DOCX file could not be read. Please upload a valid DOCX document.';

const parseXml = (data: Uint8Array): XMLDocument => {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(INVALID_DOCX_MESSAGE);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error(INVALID_DOCX_MESSAGE);
  return document;
};

export const extractThesisDocxText = (bytes: Uint8Array): string => {
  if (bytes.length > THESIS_ABSTRACT_MAX_BYTES) throw new Error('The thesis abstract must be 10 MB or smaller.');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error(INVALID_DOCX_MESSAGE);
  }
  try {
    const required = new Set(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const seen = new Set<string>();
    let entryCount = 0;
    const entries = unzipSync(bytes, {
      filter: entry => {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES) throw new Error(INVALID_DOCX_MESSAGE);
        if (entry.name.toLowerCase().endsWith('vbaproject.bin')) throw new Error(INVALID_DOCX_MESSAGE);
        if (!required.has(entry.name)) return false;
        if (seen.has(entry.name)) throw new Error(INVALID_DOCX_MESSAGE);
        seen.add(entry.name);
        const limit = entry.name === 'word/document.xml' ? MAX_DOCUMENT_XML_BYTES : MAX_METADATA_XML_BYTES;
        if (entry.originalSize > limit || entry.compression !== 0 && entry.compression !== 8) {
          throw new Error(INVALID_DOCX_MESSAGE);
        }
        return true;
      },
    });
    if ([...required].some(name => !entries[name])) throw new Error(INVALID_DOCX_MESSAGE);
    if (entries['word/document.xml'].length > MAX_DOCUMENT_XML_BYTES
      || entries['[Content_Types].xml'].length > MAX_METADATA_XML_BYTES
      || entries['_rels/.rels'].length > MAX_METADATA_XML_BYTES) throw new Error(INVALID_DOCX_MESSAGE);

    const manifest = parseXml(entries['[Content_Types].xml']);
    if (manifest.documentElement.namespaceURI !== CONTENT_TYPES_NS || manifest.documentElement.localName !== 'Types'
      || ![...manifest.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override')].some(item =>
        item.getAttribute('PartName') === '/word/document.xml'
        && item.getAttribute('ContentType') === DOCX_MAIN_CONTENT_TYPE)) throw new Error(INVALID_DOCX_MESSAGE);

    const relationships = parseXml(entries['_rels/.rels']);
    if (relationships.documentElement.namespaceURI !== RELATIONSHIPS_NS || relationships.documentElement.localName !== 'Relationships'
      || ![...relationships.getElementsByTagNameNS(RELATIONSHIPS_NS, 'Relationship')].some(item =>
        item.getAttribute('Type') === OFFICE_DOCUMENT_RELATIONSHIP
        && ['word/document.xml', '/word/document.xml'].includes(item.getAttribute('Target') || '')
        && item.getAttribute('TargetMode') !== 'External')) throw new Error(INVALID_DOCX_MESSAGE);

    const document = parseXml(entries['word/document.xml']);
    if (document.documentElement.namespaceURI !== WORD_NS || document.documentElement.localName !== 'document') {
      throw new Error(INVALID_DOCX_MESSAGE);
    }
    const body = document.getElementsByTagNameNS(WORD_NS, 'body')[0];
    if (!body) throw new Error(INVALID_DOCX_MESSAGE);
    const paragraphs = [...body.getElementsByTagNameNS(WORD_NS, 'p')].map(paragraph => {
      const parts: string[] = [];
      const visit = (node: Node): void => {
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (element.namespaceURI === WORD_NS && element.localName === 't') {
          parts.push(element.textContent || '');
          return;
        }
        if (element.namespaceURI === WORD_NS && (element.localName === 'tab' || element.localName === 'br')) {
          parts.push(' ');
          return;
        }
        for (const child of element.childNodes) visit(child);
      };
      visit(paragraph);
      return parts.join('').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    const text = paragraphs.join('\n');
    if (!/[\p{L}\p{N}]/u.test(text)) throw new Error('No readable thesis text was found in this document.');
    return text;
  } catch (error) {
    if (error instanceof Error && error.message === 'No readable thesis text was found in this document.') throw error;
    throw new Error(INVALID_DOCX_MESSAGE);
  }
};
