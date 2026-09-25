import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { thesisAbstractUploadError, validateThesisAbstractFile } from '../src/utils/thesisAbstractUpload';

const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const uploadStart = source.indexOf('const uploadThesisAbstractInSession = async (file: File) =>');
const uploadEnd = source.indexOf('const startThesisSession = async () =>', uploadStart);
const uploadSource = source.slice(uploadStart, uploadEnd);

test('Thesis upload accepts only nonempty PDF/TXT up to the advertised 10 MB', () => {
  assert.equal(validateThesisAbstractFile({ name: 'abstract.pdf', size: 100 }), null);
  assert.equal(validateThesisAbstractFile({ name: 'abstract.TXT', size: 10 * 1024 * 1024 }), null);
  assert.match(validateThesisAbstractFile({ name: 'abstract.docx', size: 100 })!, /PDF and TXT/);
  assert.match(validateThesisAbstractFile({ name: 'abstract.pdf', size: 0 })!, /empty/);
  assert.match(validateThesisAbstractFile({ name: 'abstract.pdf', size: 10 * 1024 * 1024 + 1 })!, /10 MB/);
});

test('in-session upload validates server identity before the only online request', () => {
  const idGuard = uploadSource.indexOf('isPositiveServerSessionId(thesisSessionIdRef.current)');
  const request = uploadSource.indexOf('/upload-abstract`');
  assert.ok(uploadStart >= 0 && idGuard >= 0 && request > idGuard);
  assert.match(uploadSource, /formData\.append\('file', file\)/);
  assert.match(uploadSource, /formData\.append\('abstract_text', abstractText\)/);
  assert.doesNotMatch(uploadSource, /clientSessionId.*upload-abstract/);
});

test('successful online upload updates the context only after the server accepts it', () => {
  const response = uploadSource.indexOf('if (res.ok)');
  const context = uploadSource.indexOf('thesisAbstractTextRef.current = abstractText', response);
  const success = uploadSource.indexOf('setThesisAbstractUpdated(true)', response);
  assert.ok(response >= 0 && context > response && success > context);
  assert.match(uploadSource.slice(response), /setThesisAbstractFile\(file\)/);
  assert.match(source, /Thesis abstract updated\. The next question will use the new context\./);
});

test('HTTP failure and network failure display safe upload errors instead of silent 404', () => {
  assert.match(uploadSource, /setThesisUploadError\(thesisAbstractUploadError\(res\.status\)\)/);
  assert.match(uploadSource, /catch \(error\)[\s\S]*?setThesisUploadError\(error instanceof ThesisAbstractFileError \? error\.message/);
  assert.match(source, /\{thesisUploadError && \([\s\S]*?role="alert"/);
  assert.match(thesisAbstractUploadError(404), /not found/);
  assert.match(thesisAbstractUploadError(409), /no longer active/);
  assert.doesNotMatch(thesisAbstractUploadError(503), /framework|traceback/i);
});

test('offline upload stays local and does not call the backend', () => {
  const offline = uploadSource.indexOf("active?.type === 'thesis' && active.mode === 'offline'");
  const returnIndex = uploadSource.indexOf('return;', offline);
  const request = uploadSource.indexOf('/upload-abstract`');
  assert.ok(offline >= 0 && returnIndex > offline && request > returnIndex);
  assert.match(uploadSource.slice(offline, returnIndex), /updateActivityCheckpoint/);
  assert.match(source, /Thesis abstract saved on this device\./);
});
