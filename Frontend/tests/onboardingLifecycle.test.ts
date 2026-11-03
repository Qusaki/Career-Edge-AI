import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  bindNewSignupToVerifiedUser,
  clearNewSignupHandoff,
  hasNewSignupHandoff,
  isOnboardingInspectionPending,
  readOnboardingState,
  recordAuthenticationEntry,
  shouldAutoStartOnboarding,
} from '../src/utils/onboardingState';

const authSource = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

test('signup callback, App handoff, verified Dashboard ID, inspection and guide eligibility form one chain', () => {
  // The production call sites are checked as well as the functions they invoke.
  assert.match(authSource, /localStorage\.setItem\('token', loginData\.access_token\);\s*onSuccess\(\{ isNewSignup: true \}\)/);
  assert.match(appSource, /onSuccess=\{\(\{ isNewSignup \}\) => \{\s*setIsNewSignupSession\(recordAuthenticationEntry\(isNewSignup\)\);\s*setCurrentView\('dashboard'\)/);
  assert.match(dashboardSource, /setAuthenticatedUserId\(data\.id\)/);
  assert.match(dashboardSource, /bindNewSignupToVerifiedUser\(authenticatedUserId, isNewSignupSession\)/);
  assert.match(dashboardSource, /<OnboardingGuide onDismiss=\{dismissOnboardingGuide\}/);

  const tab = storage();
  const accounts = storage();
  const isNewSignupSession = recordAuthenticationEntry(true, tab);
  assert.equal(hasNewSignupHandoff(tab), true);
  assert.equal(accounts.length, 0); // No account ID exists before /users/me.

  const verifiedUserId = 17; // Simulated valid /users/me response.
  assert.equal(bindNewSignupToVerifiedUser(verifiedUserId, isNewSignupSession, accounts, tab), 'pending');
  assert.equal(readOnboardingState(verifiedUserId, accounts), 'pending');
  assert.equal(hasNewSignupHandoff(tab), false);
  assert.equal(isOnboardingInspectionPending(verifiedUserId, null, null), true);
  assert.equal(shouldAutoStartOnboarding({
    userId: verifiedUserId,
    isNewSignupSession,
    state: readOnboardingState(verifiedUserId, accounts),
    dashboardVisible: true,
    blocked: true,
  }), false);
  assert.equal(isOnboardingInspectionPending(verifiedUserId, verifiedUserId, null), false);
  assert.equal(shouldAutoStartOnboarding({
    userId: verifiedUserId,
    isNewSignupSession,
    state: readOnboardingState(verifiedUserId, accounts),
    dashboardVisible: true,
    blocked: false,
  }), true);
});

test('reload before verified ID preserves signup intent and restarts the guide after binding', () => {
  const tab = storage();
  const accounts = storage();
  recordAuthenticationEntry(true, tab);
  // App remount resets its React state to false, but sessionStorage survives this tab reload.
  const isNewSignupSessionAfterRemount = false;
  assert.equal(bindNewSignupToVerifiedUser(18, isNewSignupSessionAfterRemount, accounts, tab), 'pending');
  assert.equal(hasNewSignupHandoff(tab), false);
  assert.equal(shouldAutoStartOnboarding({
    userId: 18,
    isNewSignupSession: isNewSignupSessionAfterRemount,
    state: readOnboardingState(18, accounts),
    dashboardVisible: true,
    blocked: false,
  }), true);
});

test('ordinary sign-in and logout discard unbound signup intent before another account verifies', () => {
  const tab = storage();
  const accounts = storage();
  recordAuthenticationEntry(true, tab);
  assert.equal(recordAuthenticationEntry(false, tab), false);
  assert.equal(bindNewSignupToVerifiedUser(19, false, accounts, tab), 'not-applicable');
  assert.equal(readOnboardingState(19, accounts), null);
  assert.match(appSource, /onLogout=\{\(\) => \{\s*clearNewSignupHandoff\(\)/);
  recordAuthenticationEntry(true, tab);
  clearNewSignupHandoff(tab);
  assert.equal(hasNewSignupHandoff(tab), false);
  assert.equal(bindNewSignupToVerifiedUser(20, false, accounts, tab), 'not-applicable');
});
