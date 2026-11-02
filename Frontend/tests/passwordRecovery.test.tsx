import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getNewPasswordError } from '../src/utils/passwordPolicy';

const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const reset = readFileSync(new URL('../src/components/ResetPasswordPage.tsx', import.meta.url), 'utf8');

test('Sign In exposes an accessible forgot-password control and keeps normal auth branches', () => {
  assert.match(auth, /mode === 'signin' && \([\s\S]*?<button type="button"[\s\S]*?Forgot password\?/);
  assert.doesNotMatch(auth, /Recovery unavailable/);
  assert.match(auth, /else if \(mode === 'signup'\)/);
  assert.match(auth, /onSuccess\(\{ isNewSignup: true \}\)/);
  assert.match(auth, /onSuccess\(\{ isNewSignup: false \}\)/);
});

test('forgot view has email submission, duplicate-disable, generic response, safe error and return', () => {
  assert.match(auth, /if \(mode === 'forgot'\) \{[\s\S]*?\/auth\/forgot-password/);
  assert.match(auth, /body: JSON\.stringify\(\{ email \}\)/);
  assert.match(auth, /id="auth-email"[\s\S]*?type="email"/);
  assert.match(auth, /disabled=\{isLoading\}/);
  assert.match(auth, /Send Reset Link/);
  assert.match(auth, /setForgotSent\(true\)/);
  assert.match(auth, /If an account exists for that email, you’ll receive a password reset link\./);
  assert.match(auth, /mode === 'forgot' \? "We couldn't process the request right now/);
  assert.match(auth, /Back to Sign In/);
  assert.doesNotMatch(auth, /Email not found|User does not exist/);
});

test('reset fragment wins over stored login and token is removed from URL without storage', () => {
  assert.match(app, /window\.location\.hash\.startsWith\('#\/reset-password'\)/);
  assert.match(app, /new URLSearchParams\(window\.location\.hash\.split\('\?', 2\)\[1\]/);
  assert.match(app, /\(\) => isResetPasswordFragment\(\) \? 'reset-password' : 'landing'/);
  assert.match(app, /currentView !== 'reset-password' && localStorage\.getItem\('token'\)/);
  assert.match(app, /window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{window\.location\.search\}#\/reset-password`\)/);
  assert.match(app, /onSuccess=\{\(\) => setResetToken\(null\)\}/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*reset|sessionStorage\.setItem|indexedDB.*resetToken/);
});

test('reset view uses both password controls and the existing policy without adding a second policy', () => {
  assert.match(reset, /New Password/);
  assert.match(reset, /Confirm New Password/);
  assert.match(reset, /showNewPassword \? 'text' : 'password'/);
  assert.match(reset, /showConfirmPassword \? 'text' : 'password'/);
  assert.match(reset, /aria-label=\{showNewPassword \? 'Hide new password' : 'Show new password'\}/);
  assert.match(reset, /aria-label=\{showConfirmPassword \? 'Hide confirmation password' : 'Show confirmation password'\}/);
  assert.match(reset, /getNewPasswordError\(newPassword\)/);
  assert.match(reset, /newPassword !== confirmPassword/);
  assert.equal(getNewPasswordError('short'), 'Password must be at least 15 characters.');
  assert.equal(getNewPasswordError('  valid passphrase  '), null);
  assert.match(reset, /Use at least 15 characters\. Spaces are allowed; the maximum is 72 UTF-8 bytes\./);
});

test('reset POST keeps token in body, handles safe errors, and never auto-authenticates', () => {
  assert.match(reset, /fetch\(`\$\{API_URL\}\/auth\/reset-password`, \{[\s\S]*?body: JSON\.stringify\(\{ token, new_password: newPassword \}\)/);
  assert.match(reset, /response\.status === 400[\s\S]*?setError\(INVALID_LINK_MESSAGE\)/);
  assert.match(reset, /This password reset link is invalid or has expired\. Request a new link\./);
  assert.match(reset, /Request New Link/);
  assert.match(reset, /setComplete\(true\);\s*onSuccess\(\)/);
  assert.match(reset, /Your password has been reset successfully\./);
  assert.match(reset, /Back to Sign In/);
  assert.doesNotMatch(reset, /localStorage|sessionStorage|access_token|\/auth\/login/);
});
