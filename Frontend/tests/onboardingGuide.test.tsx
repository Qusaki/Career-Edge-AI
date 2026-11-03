import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OnboardingGuide, ONBOARDING_STEPS, positionOnboardingCard, tabForOnboardingStep, targetForOnboardingStep } from '../src/components/OnboardingGuide';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/components/OnboardingGuide.tsx', import.meta.url), 'utf8');
const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const onboardingState = readFileSync(new URL('../src/utils/onboardingState.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/components/AuthPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('the tour has exactly ten feature steps and stable responsive targets', () => {
  assert.equal(ONBOARDING_STEPS.length, 10);
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.target), [
    'welcome', 'summary', 'navigation', 'pre-test', 'drills', 'post-test-navigation',
    'interview-history', 'enrollment-interview', 'thesis-interview', 'progress',
  ]);
  assert.equal(targetForOnboardingStep(0, false), 'welcome');
  assert.equal(targetForOnboardingStep(1, true), 'summary');
  assert.equal(targetForOnboardingStep(2, false), 'navigation-desktop');
  assert.equal(targetForOnboardingStep(2, true), 'navigation-mobile');
  assert.equal(targetForOnboardingStep(5, false), 'post-test-navigation');
  assert.equal(targetForOnboardingStep(5, true), null);
  assert.equal(targetForOnboardingStep(7, false, false), null);
  assert.equal(targetForOnboardingStep(8, false, false), null);
  assert.match(dashboard, /<h1 data-onboarding="welcome"/);
  assert.match(dashboard, /<div data-onboarding="summary"/);
  assert.match(dashboard, /data-onboarding="navigation-desktop"[\s\S]*?openAuthenticatedTab\('dashboard'\)/);
  assert.match(dashboard, /data-onboarding="navigation-mobile"[\s\S]*?aria-label="Open navigation menu"/);
  for (const marker of ['post-test-navigation', 'interview-history', 'enrollment-interview', 'thesis-interview', 'progress']) {
    assert.ok(dashboard.includes(`data-onboarding="${marker}"`));
  }
  assert.match(dashboard, /interviewHistory\.filter\(hasCompletedTotalScore\)\.length === 0/);
});

test('the guide moves through safe tabs in both directions without entering locked activities', () => {
  assert.deepEqual(ONBOARDING_STEPS.map((_, index) => tabForOnboardingStep(index, true)), [
    'dashboard', 'dashboard', 'dashboard', 'pre-test', 'drills', 'drills',
    'history', 'interview-type', 'interview-type', 'analytics',
  ]);
  assert.deepEqual(ONBOARDING_STEPS.map((_, index) => tabForOnboardingStep(index, false)), [
    'dashboard', 'dashboard', 'dashboard', 'pre-test', 'drills', 'drills',
    'history', 'history', 'history', 'analytics',
  ]);
  assert.deepEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(index => tabForOnboardingStep(index, true)), [
    'analytics', 'interview-type', 'interview-type', 'history', 'drills',
    'drills', 'pre-test', 'dashboard', 'dashboard', 'dashboard',
  ]);
  assert.equal(ONBOARDING_STEPS.some(step => String(step.tab) === 'post-test'), false);
  assert.match(dashboard, /if \(tab === 'interview-type' && !onboardingInterviewEligible\) return/);
  assert.match(dashboard, /window\.history\.replaceState\(\{\}, '', path\)/);
  assert.doesNotMatch(guide, /window\.history\.back\(|history\.back\(/);
});

test('feature copy matches the ten-step learning journey and highlights only safe landing content', () => {
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.title), [
    'Welcome to Career Edge', 'Your progress at a glance', 'Find your activities',
    'Start with a Pre-Test', 'Build skills with Drills', 'Post-Test unlocks later',
    'Review interview practice', 'University Enrollment Interview', 'Thesis Defense Interview',
    'See how you improve',
  ]);
  assert.match(ONBOARDING_STEPS[3].description, /Who Am I\?.*Active Listening Pairs/);
  assert.match(ONBOARDING_STEPS[4].description, /Later levels unlock/);
  assert.match(ONBOARDING_STEPS[5].description, /Once your progress is verified/);
  assert.match(ONBOARDING_STEPS[6].description, /Completed University Enrollment and Thesis Defense/);
  assert.match(ONBOARDING_STEPS[9].description, /activity coverage, skill breakdown, and comparisons/);
  assert.match(preTest, /<header data-onboarding="pre-test"[\s\S]*?<h1[^>]*>Pre-Test<\/h1>/);
  assert.match(drills, /<header data-onboarding="drills"[\s\S]*?<h1[^>]*>Drills<\/h1>/);
  assert.match(dashboard, /data-onboarding="post-test-navigation"[\s\S]*?requestPostTestNavigation/);
  assert.match(dashboard, /data-onboarding="enrollment-interview"[\s\S]*?onClick=\{startInterviewSession\}/);
  assert.match(dashboard, /data-onboarding="thesis-interview"[\s\S]*?onClick=\{\(\) => \{ setThesisAbstractFile/);
  assert.doesNotMatch(guide, /startExercise|startDrill|startPostTest|startInterviewSession|startThesisSession|startListening|speakBrowserText/);
});

test('ineligible interview steps use centered information and the guide never opens a hidden mobile drawer', () => {
  assert.equal(tabForOnboardingStep(7, false), 'history');
  assert.equal(tabForOnboardingStep(8, false), 'history');
  assert.equal(targetForOnboardingStep(7, true, false), null);
  assert.equal(targetForOnboardingStep(8, true, false), null);
  assert.match(guide, /Interview choices are available only to CCIT, CTE, and CBAPA students/);
  assert.match(guide, /if \(!name \|\| activeTab !== tabForOnboardingStep/);
  assert.match(guide, /new MutationObserver\(schedulePosition\)/);
  assert.match(guide, /observer\?\.disconnect\(\)/);
  assert.doesNotMatch(guide, /setTimeout\(/);
  assert.doesNotMatch(guide, /setIsMobileNavOpen\(true\)/);
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
  assert.match(dashboard, /onboardingTourUserId !== null[\s\S]*?onboardingTourTab !== null[\s\S]*?!onboardingBlocked[\s\S]*?<OnboardingGuide/);
  assert.match(dashboard, /setAccountOfflineInspectionFailedUserId\(authenticatedUserId\)/);
  assert.match(dashboard, /isOnboardingOfflineErrorBlocking\([\s\S]*?offlineFoundationError,[\s\S]*?authenticatedUserId,[\s\S]*?accountOfflineInspectionFailedUserId,[\s\S]*?OFFLINE_INSPECTION_ERROR_MESSAGE/);
});

test('mobile navigation target avoids opening the focus-trapped drawer', () => {
  assert.match(guide, /matchMedia\('\(max-width: 1023px\)'\)/);
  assert.doesNotMatch(guide, /setIsMobileNavOpen|openAuthenticatedTab|setActiveTab/);
  assert.match(dashboard, /isMobileNavOpen \? 'flex' : 'hidden'/);
  assert.equal(targetForOnboardingStep(5, true), null);
  assert.match(dashboard, /setIsMobileNavOpen\(false\);\s*setActiveTab\(tab\)/);
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
  const html = renderToStaticMarkup(<OnboardingGuide onDismiss={() => {}} onNavigate={() => {}} activeTab="dashboard" interviewEligible />);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="onboarding-title"/);
  assert.match(html, /aria-describedby="onboarding-description"/);
  assert.match(html, /Step 1 of 10/);
  assert.match(html, /Welcome to Career Edge/);
  assert.match(html, /aria-label="Close guide"/);
  assert.match(html, />Skip<\/button>/);
  assert.match(html, />Next<\/button>/);
  assert.doesNotMatch(html, />Back<\/button>/);
  assert.match(guide, /stepIndex > 0 && \(/);
  assert.match(guide, /changeStep\(stepIndex - 1\)/);
  assert.match(guide, /changeStep\(stepIndex \+ 1\)/);
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
  assert.match(dashboard, /onboardingTourUserId !== authenticatedUserId \|\| onboardingTourTab === null \|\| onboardingBlocked/);
  assert.match(dashboard, /window\.history\.replaceState\(\{\}, '', '\/dashboard'\);\s*setActiveTab\('dashboard'\)/);
  assert.match(app, /onLogout=\{\(\) => \{[\s\S]*?setCurrentView\('landing'\)/);
  assert.match(app, /onLogout=\{\(\) => \{\s*clearNewSignupHandoff\(\)/);
});

test('Settings manual replay returns to Dashboard without resetting completed storage', () => {
  assert.match(dashboard, /onboarding-settings-heading/);
  assert.match(dashboard, /Replay guide/);
  assert.match(dashboard, /Review the Career Edge guide whenever you need it/);
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
