import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getNewPasswordError, NEW_PASSWORD_GUIDANCE } from '../src/utils/passwordPolicy';

const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('new-password policy enforces length, every character category, and UTF-8 byte limit', () => {
  assert.equal(getNewPasswordError('Abcde1!'), 'Password must be at least 8 characters.');
  assert.equal(getNewPasswordError('abcdef1!'), 'Password must include at least one uppercase letter.');
  assert.equal(getNewPasswordError('ABCDEF1!'), 'Password must include at least one lowercase letter.');
  assert.equal(getNewPasswordError('Abcdefg!'), 'Password must include at least one number.');
  assert.equal(getNewPasswordError('Abcdef12'), 'Password must include at least one special character.');
  assert.equal(getNewPasswordError('Abcdef1 '), 'Password must include at least one special character.');
  assert.equal(getNewPasswordError(' '.repeat(8)), 'Password cannot contain only spaces.');
  assert.equal(getNewPasswordError('Abcdef1!'), null);
  assert.equal(getNewPasswordError('  Abcdef1!  '), null);
  assert.equal(getNewPasswordError('Ab1!' + 'a'.repeat(68)), null);
  assert.match(getNewPasswordError('Ab1!' + 'a'.repeat(69)) || '', /too long/);
  assert.equal(getNewPasswordError('Ab1!' + '🙂'.repeat(17)), null);
  assert.match(getNewPasswordError('Ab1!' + '🙂'.repeat(18)) || '', /too long/);
  assert.equal(getNewPasswordError('Äbcdef١!'), null);
  assert.equal(getNewPasswordError('Abcdef1!\ud800'), 'Password contains an invalid character.');
  assert.equal(NEW_PASSWORD_GUIDANCE, 'Use at least 8 characters with uppercase and lowercase letters, numbers, and special symbols.');
});

test('signup checks only new passwords and keeps visibility and optional Middle Name behavior', () => {
  const signup = auth.slice(auth.indexOf("if (mode === 'signup') {"), auth.indexOf("} else {\n        const params"));
  assert.match(signup, /getNewPasswordError\(password\)/);
  assert.match(signup, /middlename: middleName\.trim\(\) \|\| null/);
  assert.match(signup, /normalizeApiError\(data, 'Sign up failed'\)/);
  assert.match(auth, /mode === 'signup' && \(\s*<p[^>]*>\{NEW_PASSWORD_GUIDANCE\}/);
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
  assert.match(dashboard, /Leave blank to keep your password\. \{NEW_PASSWORD_GUIDANCE\}/);
  assert.match(dashboard, /\{profilePasswordError && <p role="alert"/);
  assert.match(dashboard, /type=\{showProfilePass \? 'text' : 'password'\}/);
  assert.match(dashboard, /aria-label=\{showProfilePass \? 'Hide password' : 'Show password'\}/);
});
