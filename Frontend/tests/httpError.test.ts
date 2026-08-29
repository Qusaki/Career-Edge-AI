import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeApiError } from '../src/utils/httpError';

const fallback = 'The request could not be completed.';

test('A: FastAPI string detail is returned directly', () => {
  assert.equal(normalizeApiError({ detail: 'Session not found' }, fallback), 'Session not found');
});

test('B: FastAPI validation details become clean readable messages', () => {
  const body = {
    detail: [
      { loc: ['path', 'session_id'], msg: 'Input should be a valid integer', type: 'int_parsing' },
      { loc: ['body', 'answer'], msg: 'Answer is required', type: 'missing' },
    ],
  };
  assert.equal(
    normalizeApiError(body, fallback),
    'Input should be a valid integer; Answer is required',
  );
});

test('C: object detail message is returned directly', () => {
  assert.equal(normalizeApiError({ detail: { message: 'Invalid session' } }, fallback), 'Invalid session');
});

test('D: top-level message is returned when detail is absent', () => {
  assert.equal(normalizeApiError({ message: 'Request failed' }, fallback), 'Request failed');
});

test('E: Error instances return their message', () => {
  assert.equal(normalizeApiError(new Error('Network failed'), fallback), 'Network failed');
});

test('F and G: malformed, null, and undefined bodies use the fallback', () => {
  assert.equal(normalizeApiError({}, fallback), fallback);
  assert.equal(normalizeApiError(null, fallback), fallback);
  assert.equal(normalizeApiError(undefined, fallback), fallback);
});

test('H: nested unknown objects never render as object coercion text', () => {
  const result = normalizeApiError({ detail: { nested: { reason: 'private' } } }, fallback);
  assert.equal(result, fallback);
  assert.doesNotMatch(result, /\[object Object\]/);
});

test('structured 422 bodies normalize consistently for Pre-Test, Post-Test, and Drills fallbacks', () => {
  const validationBody = { detail: [{ msg: 'Input should be a valid integer' }] };
  const pageFallbacks = [
    'Unable to start Who Am I?.',
    'Unable to start the post-test interview.',
    'Unable to start Just-a-Minute Speaking.',
  ];
  for (const pageFallback of pageFallbacks) {
    assert.equal(normalizeApiError(validationBody, pageFallback), 'Input should be a valid integer');
  }
});
