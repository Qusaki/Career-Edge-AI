import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { extractThesisDocxText } from '../src/utils/thesisDocx';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const manifest = `<Types xmlns="${CONTENT_TYPES_NS}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const relationships = `<Relationships xmlns="${RELATIONSHIPS_NS}"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const validDocument = `<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Research Title</w:t></w:r></w:p><w:p><w:r><w:t>A readable research </w:t></w:r><w:r><w:t>abstract.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table finding</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;

const makeDocx = (documentXml = validDocument, includeDocument = true, includeMacro = false): Uint8Array => zipSync({
  '[Content_Types].xml': strToU8(manifest),
  '_rels/.rels': strToU8(relationships),
  ...(includeDocument ? { 'word/document.xml': strToU8(documentXml) } : {}),
  ...(includeMacro ? { 'word/vbaProject.bin': strToU8('not executed') } : {}),
});

// Node has no browser DOMParser. This narrow test double exercises the extractor's
// DOM traversal while the production implementation uses the browser's XML parser.
class TestDOMParser {
  parseFromString(xml: string): XMLDocument {
    const parserError = xml.includes('<w:p>') && !xml.includes('</w:p>');
    const leaf = (name: string, text = '') => ({ nodeType: 1, localName: name, namespaceURI: WORD_NS, textContent: text, childNodes: [] });
    const documentElement = xml.startsWith('<Types')
      ? { namespaceURI: CONTENT_TYPES_NS, localName: 'Types' }
      : xml.startsWith('<Relationships')
        ? { namespaceURI: RELATIONSHIPS_NS, localName: 'Relationships' }
        : { namespaceURI: WORD_NS, localName: 'document' };
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match) => {
      const children = [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\s*\/>/g)]
        .map(item => leaf(item[2] || 't', item[1] || ''));
      return { nodeType: 1, localName: 'p', namespaceURI: WORD_NS, childNodes: children };
    });
    const body = { getElementsByTagNameNS: (_ns: string, tag: string) => tag === 'p' ? paragraphs : [] };
    return {
      documentElement,
      getElementsByTagName: (tag: string) => tag === 'parsererror' && parserError ? [{}] : [],
      getElementsByTagNameNS: (ns: string, tag: string) => {
        if (ns === CONTENT_TYPES_NS && tag === 'Override') return [{ getAttribute: (key: string) => key === 'PartName' ? '/word/document.xml' : key === 'ContentType' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' : null }];
        if (ns === RELATIONSHIPS_NS && tag === 'Relationship') return [{ getAttribute: (key: string) => key === 'Type' ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' : key === 'Target' ? 'word/document.xml' : null }];
        if (ns === WORD_NS && tag === 'body') return xml.includes('<w:body>') ? [body] : [];
        return [];
      },
    } as unknown as XMLDocument;
  }
}

const previousDOMParser = globalThis.DOMParser;
globalThis.DOMParser = TestDOMParser as unknown as typeof DOMParser;
test.after(() => { globalThis.DOMParser = previousDOMParser; });

test('DOCX extracts heading, paragraphs, and table-cell text', () => {
  assert.equal(extractThesisDocxText(makeDocx()), 'Research Title\nA readable research abstract.\nTable finding');
});

test('fake, malformed, missing-main-document, and empty DOCX are rejected', () => {
  assert.throws(() => extractThesisDocxText(strToU8('not a ZIP')), /valid DOCX/);
  assert.throws(() => extractThesisDocxText(makeDocx(validDocument, false)), /valid DOCX/);
  assert.throws(() => extractThesisDocxText(makeDocx(validDocument, true, true)), /valid DOCX/);
  assert.throws(() => extractThesisDocxText(makeDocx(`<w:document xmlns:w="${WORD_NS}"><w:body><w:p></w:body></w:document>`)), /valid DOCX/);
  assert.throws(() => extractThesisDocxText(makeDocx(`<w:document xmlns:w="${WORD_NS}"><w:body><w:p/></w:body></w:document>`)), /No readable thesis text/);
});

test('oversized decompressed document XML is rejected before inflation', () => {
  const bomb = `<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>${'A'.repeat(2 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>`;
  assert.ok(makeDocx(bomb).length < 10 * 1024 * 1024);
  assert.throws(() => extractThesisDocxText(makeDocx(bomb)), /valid DOCX/);
  assert.throws(() => extractThesisDocxText(new Uint8Array(10 * 1024 * 1024 + 1)), /10 MB/);
});
