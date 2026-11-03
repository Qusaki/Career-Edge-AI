import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OnboardingGuide, ONBOARDING_STEPS, positionOnboardingCard, targetForOnboardingStep } from '../src/components/OnboardingGuide';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/components/OnboardingGuide.tsx', import.meta.url), 'utf8');
const onboardingState = readFileSync(new URL('../src/utils/onboardingState.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('the tour has exactly four Dashboard-only steps and stable responsive targets', () => {
  assert.equal(ONBOARDING_STEPS.length, 4);
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.target), ['welcome', 'summary', 'recent-sessions', 'navigation']);
  assert.equal(targetForOnboardingStep(0, false), 'welcome');
  assert.equal(targetForOnboardingStep(1, true), 'summary');
  assert.equal(targetForOnboardingStep(2, false), 'recent-sessions');
  assert.equal(targetForOnboardingStep(3, false), 'navigation-desktop');
  assert.equal(targetForOnboardingStep(3, true), 'navigation-mobile');
  assert.match(dashboard, /<h1 data-onboarding="welcome"/);
  assert.match(dashboard, /<div data-onboarding="summary"/);
  assert.match(dashboard, /<div data-onboarding="recent-sessions"/);
  assert.match(dashboard, /data-onboarding="navigation-desktop"[\s\S]*?openAuthenticatedTab\('dashboard'\)/);
  assert.match(dashboard, /data-onboarding="navigation-mobile"[\s\S]*?aria-label="Open navigation menu"/);
  assert.match(dashboard, /interviewHistory\.filter\(hasCompletedTotalScore\)\.length === 0/);
});

test('guide starts only from verified signup or account pending state when Dashboard is safe', () => {
  assert.match(auth, /onSuccess\(\{ isNewSignup: true \}\)/);
  assert.match(auth, /onSuccess\(\{ isNewSignup: false \}\)/);
  assert.match(app, /isNewSignupSession=\{isNewSignupSession\}/);
  assert.match(app, /setIsNewSignupSession\(recordAuthenticationEntry\(isNewSignup\)\)/);
  assert.match(dashboard, /if \(!authenticatedUserId\) return;[\s\S]*?bindNewSignupToVerifiedUser\(authenticatedUserId, isNewSignupSession\)/);
  assert.match(dashboard, /shouldAutoStartOnboarding\(\{[\s\S]*?userId: authenticatedUserId,[\s\S]*?isNewSignupSession,[\s\S]*?state: readOnboardingState\(authenticatedUserId\)/);
  assert.match(dashboard, /activeTab !== 'dashboard' \|\| onboardingBlocked/);
  assert.match(dashboard, /isOnboardingInspectionPending\([\s\S]*?authenticatedUserId,[\s\S]*?accountOfflineInspectionUserId,[\s\S]*?accountOfflineInspectionFailedUserId/);
});

test('active work and higher-priority prompts defer the guide without changing them', () => {
  for (const guard of [
    'activeActivityCheckpoint !== null', 'resumableOfflineSession !== null', 'pendingSyncCount > 0',
    'showConnectionLossPrompt', 'showUpdateNotice', 'isSignOutDialogOpen', 'isLeaveModalOpen',
    'thesisIsLeaveModalOpen', 'isModuleSessionMode',
  ]) assert.ok(dashboard.includes(guard), `Missing guard: ${guard}`);
  assert.match(dashboard, /onboardingTourUserId !== null[\s\S]*?activeTab === 'dashboard'[\s\S]*?!onboardingBlocked[\s\S]*?<OnboardingGuide/);
  assert.match(dashboard, /setAccountOfflineInspectionFailedUserId\(authenticatedUserId\)/);
  assert.match(dashboard, /isOnboardingOfflineErrorBlocking\([\s\S]*?offlineFoundationError,[\s\S]*?authenticatedUserId,[\s\S]*?accountOfflineInspectionFailedUserId,[\s\S]*?OFFLINE_INSPECTION_ERROR_MESSAGE/);
});

test('mobile navigation target avoids opening the focus-trapped drawer', () => {
  assert.match(guide, /matchMedia\('\(max-width: 1023px\)'\)/);
  assert.doesNotMatch(guide, /setIsMobileNavOpen|openAuthenticatedTab|setActiveTab/);
  assert.match(dashboard, /isMobileNavOpen \? 'flex' : 'hidden'/);
});

test('a missing or offscreen target has a bounded centered fallback', () => {
  assert.equal(positionOnboardingCard(null, { width: 360, height: 260 }, { width: 375, height: 667 }), null);
  const card = positionOnboardingCard(
    { top: 600, left: 330, width: 40, height: 40 },
    { width: 343, height: 250 },
    { width: 375, height: 667 },
  );
  assert.ok(card);
  assert.ok(card.top >= 16 && card.top + 250 <= 667 - 16);
  assert.ok(card.left >= 16 && card.left + 343 <= 375 - 16);
  assert.match(guide, /target && target\.getClientRects\(\)\.length > 0 \? target : null/);
  assert.match(guide, /target\.scrollIntoView\(\{ block: 'center', inline: 'nearest', behavior: 'auto' \}\)/);
  assert.match(guide, /top: '50%', left: '50%', transform: 'translate\(-50%, -50%\)'/);
  assert.match(guide, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(guide, /w-\[min\(22\.5rem,calc\(100vw-2rem\)\)\]/);
});

test('dialog shows accessible current step and Back, Next, Skip, Finish, and close controls', () => {
  const html = renderToStaticMarkup(<OnboardingGuide onDismiss={() => {}} />);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="onboarding-title"/);
  assert.match(html, /aria-describedby="onboarding-description"/);
  assert.match(html, /Step 1 of 4/);
  assert.match(html, /Welcome to Career Edge/);
  assert.match(html, /aria-label="Close guide"/);
  assert.match(html, />Skip<\/button>/);
  assert.match(html, />Next<\/button>/);
  assert.doesNotMatch(html, />Back<\/button>/);
  assert.match(guide, /stepIndex > 0 && \(/);
  assert.match(guide, /setStepIndex\(index => index - 1\)/);
  assert.match(guide, /setStepIndex\(index => index \+ 1\)/);
  assert.match(guide, /lastStep \? 'Got it' : 'Next'/);
  assert.match(guide, /onClick=\{lastStep \? onDismiss/);
});

test('Escape, focus containment and restoration, and reduced motion are supported', () => {
  assert.match(guide, /event\.key === 'Escape'[\s\S]*?onDismissRef\.current\(\)/);
  assert.match(guide, /event\.key !== 'Tab'/);
  assert.match(guide, /document\.addEventListener\('focusin', onFocusIn\)/);
  assert.match(guide, /if \(previousFocus\?\.isConnected\) previousFocus\.focus\(\)/);
  assert.match(guide, /sibling\.inert = true/);
  assert.match(guide, /sibling\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(guide, /program-accent-focus-ring/);
  assert.match(guide, /behavior: 'auto'/);
  assert.doesNotMatch(guide, /animate-|transition-all|transition-transform/);
});

test('Skip, Finish, close and Escape share a completion path; logout and account switch unmount it', () => {
  assert.match(guide, /aria-label="Close guide" onClick=\{onDismiss\}/);
  assert.match(guide, /onClick=\{onDismiss\}[\s\S]*?>Skip/);
  assert.match(guide, /onClick=\{lastStep \? onDismiss/);
  assert.match(guide, /onDismissRef\.current\(\)/);
  assert.match(dashboard, /const dismissOnboardingGuide = \(\) => \{[\s\S]*?markOnboardingCompleted\(onboardingTourUserId\)/);
  assert.match(dashboard, /onboardingTourUserId !== authenticatedUserId \|\| activeTab !== 'dashboard' \|\| onboardingBlocked/);
  assert.match(app, /onLogout=\{\(\) => \{[\s\S]*?setCurrentView\('landing'\)/);
  assert.match(app, /onLogout=\{\(\) => \{\s*clearNewSignupHandoff\(\)/);
});

test('Settings manual replay returns to Dashboard without resetting completed storage', () => {
  assert.match(dashboard, /onboarding-settings-heading/);
  assert.match(dashboard, /Replay guide/);
  assert.match(dashboard, /setManualReplayUserId\(authenticatedUserId\);[\s\S]*?openAuthenticatedTab\('dashboard'\)/);
  assert.match(dashboard, /manualReplayUserId === authenticatedUserId[\s\S]*?setOnboardingTourUserId\(authenticatedUserId\)/);
  assert.doesNotMatch(dashboard, /setManualReplayUserId\(authenticatedUserId\);[\s\S]{0,140}markOnboardingPending/);
});

test('onboarding adds no backend request, activity/session creation, sync write, or IndexedDB schema', () => {
  assert.doesNotMatch(guide + onboardingState, /\bfetch\s*\(|XMLHttpRequest|WebSocket|accountStorage\.put|Dexie|indexedDB|createActivityCheckpoint|pending_sync|startListening|speakBrowserText/);
  assert.match(onboardingState, /career-edge:onboarding:v1:/);
  assert.match(onboardingState, /accountStorage\.setItem\(key, 'pending'\)/);
  assert.match(onboardingState, /\(storage \?\? localStorage\)\.setItem\(keyForUser\(userId\), 'completed'\)/);
});
