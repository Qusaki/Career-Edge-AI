import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const input = (id: string) => {
  const idIndex = auth.indexOf(`id="${id}"`);
  const start = auth.lastIndexOf('<input', idIndex);
  const end = auth.indexOf('/>', idIndex);
  assert.ok(idIndex >= 0 && start >= 0 && end > idIndex, `${id} input should exist`);
  return auth.slice(start, end + 2);
};

test('signup identifies Middle Name as optional while other name and credential inputs stay required', () => {
  assert.match(auth, /htmlFor="signup-middle-name"[^>]*>Middle Name \(Optional\)<\/label>/);
  assert.doesNotMatch(input('signup-middle-name'), /\brequired\b/);
  for (const id of ['signup-first-name', 'signup-last-name']) {
    assert.match(input(id), /required=\{mode === 'signup'\}/);
  }
  for (const id of ['auth-email', 'auth-password']) {
    assert.match(input(id), /\brequired\s*\/>/);
  }
  assert.match(auth, /if \(!selectedDept\) \{\s*setError\('Please select a department\.'\)/);
});

test('signup accepts a missing Middle Name and normalizes blank or whitespace-only input to null', () => {
  assert.match(auth, /middlename: middleName\.trim\(\) \|\| null/);
  assert.match(auth, /body: JSON\.stringify\(payload\)/);
  assert.equal(''.trim() || null, null);
  assert.equal(' \t\n '.trim() || null, null);
  assert.equal('  de La Cruz  '.trim() || null, 'de La Cruz');
});

test('signup auto-login and ordinary sign-in branches remain distinct', () => {
  assert.match(auth, /if \(mode === 'signup'\) \{/);
  assert.match(auth, /onSuccess\(\{ isNewSignup: true \}\)/);
  assert.match(auth, /onSuccess\(\{ isNewSignup: false \}\)/);
  assert.match(auth, /\$\{API_URL\}\/auth\/login/);
});
