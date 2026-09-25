import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hasCompletedTotalScore } from '../src/utils/analytics';

const readSource = (relativePath: string) => readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

const dashboard = readSource('components/Dashboard.tsx');
const auth = readSource('components/AuthPage.tsx');
const preTest = readSource('components/PreTestPage.tsx');
const postTest = readSource('components/PostTestPage.tsx');
const drills = readSource('components/DrillsPage.tsx');
const waveform = readSource('components/SoundWaveInterviewer.tsx');
const camera = readSource('components/CameraTrackingNotice.tsx');
const main = readSource('main.tsx');
const styles = readSource('index.css');

test('authenticated navigation is collapsed on narrow screens and remains present on desktop', () => {
  assert.match(dashboard, /isMobileNavOpen \? 'flex' : 'hidden'/);
  assert.match(dashboard, /lg:flex lg:h-screen/);
  assert.match(dashboard, /w-72 max-w-\[88vw\]/);
  assert.match(dashboard, /Open navigation menu/);
  assert.match(dashboard, /aria-controls="authenticated-navigation"/);
});

test('mobile drawer supports open, close, Escape, focus return, and active navigation', () => {
  assert.match(dashboard, /onClick=\{\(\) => setIsMobileNavOpen\(true\)\}/);
  assert.match(dashboard, /event\.key === 'Escape'[\s\S]*?setIsMobileNavOpen\(false\)/);
  assert.match(dashboard, /mobileNavTriggerRef\.current/);
  assert.match(dashboard, /aria-current=\{activeTab === 'dashboard' \? 'page' : undefined\}/);
  assert.match(dashboard, /aria-disabled=\{!isPostTestUnlocked\(postTestAccess\)\}/);
  assert.match(dashboard, /\(getFocusable\(\)\[0\] \|\| drawer\)\.focus\(\)/);
  assert.match(dashboard, /document\.activeElement === first \|\| document\.activeElement === drawer[\s\S]*?last\.focus\(\)/);
  assert.match(dashboard, /document\.activeElement === last \|\| !drawer\.contains\(document\.activeElement\)[\s\S]*?first\.focus\(\)/);
  assert.match(dashboard, /matchMedia\('\(min-width: 1024px\)'\)[\s\S]*?setIsMobileNavOpen\(false\)/);
});

test('history rows are native responsive buttons and zero-score results remain visible', () => {
  assert.ok((dashboard.match(/<motion\.button/g) ?? []).length >= 2);
  assert.match(dashboard, /sm:flex-row sm:items-center sm:justify-between/);
  assert.equal(hasCompletedTotalScore({ status: 'completed', total_score: 0 }), true);
  assert.equal(hasCompletedTotalScore({ status: 'completed', total_score: null }), false);
  assert.equal(hasCompletedTotalScore({ status: 'in_progress', total_score: 0 }), false);
  assert.match(dashboard, /interviewHistory\.filter\(hasCompletedTotalScore\)/);
  assert.match(dashboard, /thesisHistory\.filter\(hasCompletedTotalScore\)/);
});

test('signup departments and password controls use accessible native semantics', () => {
  assert.match(auth, /<fieldset>/);
  assert.match(auth, /<legend[^>]*>Department<\/legend>/);
  assert.match(auth, /type="button"[\s\S]*?aria-pressed=\{selectedDept === dept\}/);
  assert.match(auth, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/);
  for (const id of ['signup-first-name', 'signup-middle-name', 'signup-last-name', 'auth-email', 'auth-password']) {
    assert.match(auth, new RegExp(`htmlFor="${id}"`));
    assert.match(auth, new RegExp(`id="${id}"`));
  }
});

test('profile fields and upload trigger have explicit accessible labels', () => {
  for (const id of ['profile-full-name', 'profile-email', 'profile-password', 'profile-department']) {
    assert.match(dashboard, new RegExp(`htmlFor="${id}"`));
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(dashboard, /id="profile-picture-upload"/);
  assert.match(dashboard, /aria-label="Upload profile picture"/);
  assert.match(dashboard, /profilePictureInputRef\.current\?\.click\(\)/);
  assert.match(dashboard, /className="hidden"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(dashboard, /flex flex-col items-start gap-5 sm:flex-row sm:items-center/);
  assert.match(dashboard, /break-words text-2xl/);
});

test('connection and leave overlays are modal dialogs with focus and Escape handling', () => {
  assert.ok((dashboard.match(/role="dialog"/g) ?? []).length >= 3);
  assert.ok((dashboard.match(/aria-modal="true"/g) ?? []).length >= 3);
  assert.match(dashboard, /useDialogFocus\(showConnectionLossPrompt/);
  assert.match(dashboard, /useDialogFocus\(thesisIsLeaveModalOpen/);
  assert.match(dashboard, /useDialogFocus\(isLeaveModalOpen/);
  assert.match(dashboard, /previouslyFocused\?\.focus\(\)/);
  assert.match(dashboard, /\(getFocusable\(\)\[0\] \|\| dialog\)\.focus\(\)/);
  assert.match(dashboard, /document\.activeElement === first \|\| document\.activeElement === dialog[\s\S]*?last\.focus\(\)/);
  assert.match(dashboard, /document\.activeElement === last \|\| !dialog\.contains\(document\.activeElement\)[\s\S]*?first\.focus\(\)/);
  assert.match(dashboard, /sibling\.inert = true/);
  assert.match(dashboard, /document\.addEventListener\('focusin', handleFocusIn\)/);
});

test('history loading, error, and genuine-empty states remain distinct', () => {
  assert.match(dashboard, /interviewHistoryState[^\n]*'idle' \| 'loading' \| 'ready' \| 'error'/);
  assert.match(dashboard, /Loading interview history…/);
  assert.match(dashboard, /Interview history unavailable/);
  assert.match(dashboard, /No interviews yet/);
  assert.match(dashboard, /interviewHistoryState === 'error'/);
  assert.match(dashboard, /historyErrors\.length > 0/);
});

test('remaining contrast-sensitive statuses use readable semantic classes', () => {
  assert.match(dashboard, /program-accent-button program-accent-focus-ring mt-6 w-full[\s\S]*?>\s*Back/);
  assert.doesNotMatch(dashboard, /bg-slate-800 hover:bg-slate-700 text-white text-base rounded-xl font-bold[\s\S]*?>\s*Back/);
  assert.match(styles, /--color-muted: #756f5d/);
  assert.match(styles, /\.status-warning-text/);
  assert.match(styles, /\.dashboard-theme-dark \.status-failure-text/);
});

test('connection recovery and unavailable interview guidance remain explicit', () => {
  assert.match(dashboard, /style=\{programAccentStyle\} className="status-surface-dark/);
  assert.match(dashboard, /aria-describedby="start-interview-lock-guidance"/);
  assert.match(dashboard, /id="start-interview-lock-guidance"/);
});

test('offline Post-Test answer controls stack on narrow screens', () => {
  assert.match(postTest, /mx-auto mt-4 flex max-w-2xl flex-col gap-2 sm:flex-row/);
  assert.match(postTest, /program-accent-button w-full[\s\S]*?sm:w-auto sm:self-end/);
});

test('camera score stays visual without rapid live announcements', () => {
  assert.match(camera, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(camera, /aria-live="off">\{presentation\.detail\}/);
  assert.doesNotMatch(camera, /className="p-2\.5" role="status"/);
});

test('Motion components respect the user reduced-motion preference', () => {
  assert.match(main, /<MotionConfig reducedMotion="user">/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('active session layouts retain actions and cameras while reducing fixed vertical dominance', () => {
  for (const source of [preTest, postTest, drills]) {
    assert.match(source, /<CameraTrackingNotice \{\.\.\.eyeTracker\} \/>/);
    assert.match(source, /flex flex-wrap items-center justify-between/);
  }
  assert.doesNotMatch(preTest, /min-h-\[35vh\]|min-h-\[30vh\]/);
  assert.doesNotMatch(postTest, /min-h-\[38vh\]/);
  assert.doesNotMatch(drills, /min-h-\[28vh\]|h-\[44vh\]/);
  assert.match(waveform, /min-h-32/);
  assert.doesNotMatch(waveform, /min-h-56|h-28/);
});

test('mic visual authority, Post-Test gate, and completion actions remain intact', () => {
  for (const source of [preTest, postTest, drills]) {
    assert.match(source, /isListening \? <Mic className="h-5 w-5" \/> : <MicOff className="h-5 w-5" \/>/);
  }
  assert.match(postTest, /if \(!isPostTestUnlocked\(postTestAccess\)\)/);
  assert.match(postTest, /!answerBoundary\.canAcceptAnswer/);
  assert.match(preTest, /Complete Exercise/);
  assert.match(postTest, /Complete Interview/);
  assert.match(drills, /Mark Complete/);
});

test('dark system surfaces, honest unavailable affordances, and reduced motion are explicit', () => {
  assert.match(styles, /\.status-surface-dark/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(dashboard, /Attachments unavailable/);
  assert.doesNotMatch(dashboard, />Local Disk<|>Drive</);
  assert.match(auth, /Recovery unavailable/);
  assert.doesNotMatch(auth, /href="#"/);
});
