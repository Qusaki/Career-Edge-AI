import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getNewPasswordError } from '../src/utils/passwordPolicy';

const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('new-password policy checks Unicode characters and UTF-8 bytes without composition rules', () => {
  assert.equal(getNewPasswordError('a'.repeat(14)), 'Password must be at least 15 characters.');
  assert.equal(getNewPasswordError('a'.repeat(15)), null);
  assert.equal(getNewPasswordError(' '.repeat(15)), 'Password cannot contain only spaces.');
  assert.equal(getNewPasswordError('four words make a passphrase'), null);
  assert.equal(getNewPasswordError('  fifteen letters  '), null);
  assert.equal(getNewPasswordError('a'.repeat(72)), null);
  assert.match(getNewPasswordError('a'.repeat(73)) || '', /too long/);
  assert.equal(getNewPasswordError('🙂'.repeat(18)), null);
  assert.match(getNewPasswordError('🙂'.repeat(19)) || '', /too long/);
});

test('signup checks only new passwords and keeps visibility and optional Middle Name behavior', () => {
  const signup = auth.slice(auth.indexOf("if (mode === 'signup') {"), auth.indexOf("} else {\n        const params"));
  assert.match(signup, /getNewPasswordError\(password\)/);
  assert.match(signup, /middlename: middleName\.trim\(\) \|\| null/);
  assert.match(signup, /normalizeApiError\(data, 'Sign up failed'\)/);
  assert.match(auth, /mode === 'signup' && \(\s*<p[^>]*>Use at least 15 characters/);
  assert.match(auth, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(auth, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/);
  const signin = auth.slice(auth.indexOf("} else {\n        const params"), auth.indexOf('} catch (err: any)'));
  assert.doesNotMatch(signin, /getNewPasswordError/);
});

test('Profile skips empty passwords, validates entered ones, and retains other save fields', () => {
  const save = dashboard.slice(dashboard.indexOf('const handleSave = async () => {'), dashboard.indexOf('// Speech Recognition & TTS States'));
  assert.match(save, /if \(profile\.password\) \{\s*const passwordError = getNewPasswordError\(profile\.password\)/);
  assert.match(save, /if \(profile\.password\) formData\.append\('password', profile\.password\)/);
  for (const field of ['firstname', 'middlename', 'lastname', 'department']) {
    assert.match(save, new RegExp(`formData\\.append\\('${field}'`));
  }
  assert.match(save, /profile\.password && res\.status === 422/);
  assert.match(save, /normalizeApiError\(body, 'Unable to update password\.'\)/);
  assert.match(dashboard, /Leave blank to keep your password/);
  assert.match(dashboard, /\{profilePasswordError && <p role="alert"/);
  assert.match(dashboard, /type=\{showProfilePass \? 'text' : 'password'\}/);
  assert.match(dashboard, /aria-label=\{showProfilePass \? 'Hide password' : 'Show password'\}/);
});
