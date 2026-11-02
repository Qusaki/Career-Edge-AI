import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { JsxEmit, transpileModule } from 'typescript';

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

test('profile password visibility toggles locally without changing its value or save behavior', () => {
  const profilePassword = dashboard.slice(
    dashboard.indexOf('<label htmlFor="profile-password"'),
    dashboard.indexOf('{/* Department */}', dashboard.indexOf('<label htmlFor="profile-password"')),
  );

  assert.match(dashboard, /const \[showProfilePass, setShowProfilePass\] = useState\(false\)/);
  assert.match(profilePassword, /type=\{showProfilePass \? 'text' : 'password'\}/);
  assert.match(profilePassword, /value=\{profile\.password \|\| ''\}/);
  assert.match(profilePassword, /onChange=\{\(e\) => \{ setProfile\(\{ \.\.\.profile, password: e\.target\.value \}\); setProfilePasswordError\(null\); \}\}/);
  assert.match(profilePassword, /<button\s+type="button"\s+onClick=\{\(\) => setShowProfilePass\(!showProfilePass\)\}/);
  assert.match(profilePassword, /aria-label=\{showProfilePass \? 'Hide password' : 'Show password'\}/);
  assert.match(profilePassword, /aria-pressed=\{showProfilePass\}/);
  assert.match(profilePassword, /program-accent-focus-ring/);
  assert.match(profilePassword, /showProfilePass \? <EyeOff[^>]+\/> : <Eye[^>]+\/>/);
  assert.doesNotMatch(profilePassword, /handleSave|formData\.append|console\./);
  assert.match(dashboard, /if \(profile\.password\) formData\.append\('password', profile\.password\)/);
  assert.match(auth, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(auth, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/);
});

test('profile visibility button switches the rendered input in both directions without editing its value', () => {
  const start = dashboard.indexOf('<label htmlFor="profile-password"');
  const end = dashboard.indexOf('{/* Department */}', start);
  const markup = dashboard.slice(start, end).match(/<div className="relative">[\s\S]*?<\/div>/)?.[0];
  assert.ok(markup);

  const code = transpileModule(
    `const render = (showProfilePass, setShowProfilePass, profile, setProfile, profilePasswordError, setProfilePasswordError) => (${markup}); render;`,
    { compilerOptions: { jsx: JsxEmit.React } },
  ).outputText;
  const React = {
    createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({
      type,
      props: { ...props, children },
    }),
  };
  const render = runInNewContext(`${code}\nrender;`, { React, Eye: 'Eye', EyeOff: 'EyeOff' }) as (
    visible: boolean,
    setVisible: (next: boolean) => void,
    profile: { password: string },
    setProfile: () => void,
    profilePasswordError: string | null,
    setProfilePasswordError: () => void,
  ) => { props: { children: Array<{ type: string; props: Record<string, unknown> }> } };

  let visible = false;
  let profileUpdates = 0;
  const readControl = () => {
    const wrapper = render(visible, next => { visible = next; }, { password: 'new-password' }, () => { profileUpdates += 1; }, null, () => {});
    return {
      input: wrapper.props.children.find(child => child.type === 'input'),
      button: wrapper.props.children.find(child => child.type === 'button'),
    };
  };

  let { input, button } = readControl();
  assert.equal(input?.props.type, 'password');
  assert.equal(button?.props.type, 'button');
  assert.equal(button?.props['aria-label'], 'Show password');
  assert.equal(button?.props['aria-pressed'], false);
  (button?.props.onClick as () => void)();

  ({ input, button } = readControl());
  assert.equal(input?.props.type, 'text');
  assert.equal(input?.props.value, 'new-password');
  assert.equal(button?.props['aria-label'], 'Hide password');
  assert.equal(button?.props['aria-pressed'], true);
  (button?.props.onClick as () => void)();

  ({ input, button } = readControl());
  assert.equal(input?.props.type, 'password');
  assert.equal(input?.props.value, 'new-password');
  assert.equal(button?.props['aria-label'], 'Show password');
  assert.equal(button?.props['aria-pressed'], false);
  assert.equal(profileUpdates, 0);
});

test('shared Sign Out menu item has a visible themed card and opens an accessible confirmation', () => {
  const menu = dashboard.slice(dashboard.indexOf('id="sidebar-account-menu"'), dashboard.indexOf('ref={accountTriggerRef}'));
  const signOutCard = menu.slice(menu.indexOf('<div className="my-1 border-t border-line" />'));
  const dialog = dashboard.slice(dashboard.indexOf('{isSignOutDialogOpen && ('), dashboard.indexOf('\n      </div>\n    </>\n  );', dashboard.indexOf('{isSignOutDialogOpen && (')));

  assert.match(menu, /openAuthenticatedTab\('profile'\)/);
  assert.match(menu, /openAuthenticatedTab\('settings'\)/);
  assert.match(signOutCard, /<button\s+type="button"\s+role="menuitem"\s+onClick=\{openSignOutDialog\}/);
  assert.match(signOutCard, /flex w-full[^`]*rounded-md border/);
  assert.match(signOutCard, /appTheme === 'dark'[\s\S]*?border-rose-500\/30 bg-rose-500\/10[\s\S]*?border-rose-200 bg-rose-50/);
  assert.match(signOutCard, /program-accent-focus-ring/);
  assert.doesNotMatch(signOutCard, /onLogout\(\)/);
  assert.match(dashboard, /useDialogFocus\(isSignOutDialogOpen, closeSignOutDialog\)/);
  assert.match(dialog, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="sign-out-dialog-title"/);
  assert.match(dialog, /aria-describedby=\{syncQueueSessions\.length > 0 \? 'sign-out-dialog-description sign-out-pending-warning' : 'sign-out-dialog-description'\}/);
  assert.match(dialog, /<h2 id="sign-out-dialog-title"[^>]*>Sign out\?<\/h2>/);
  assert.match(dialog, /Are you sure you want to sign out\?/);
  assert.match(dialog, /onClick=\{closeSignOutDialog\}[\s\S]*?Cancel/);
  assert.match(dialog, /onClick=\{confirmSignOut\}[\s\S]*?Sign Out/);
  assert.match(dialog, /syncQueueSessions\.length > 0 && \([\s\S]*?activity data waiting to sync/);
  assert.match(dashboard, /event\.key === 'Escape'[\s\S]*?closeRef\.current\(\)/);
});

test('Sign Out warning renders only for existing queued synchronization work', () => {
  const condition = dashboard.match(/\{syncQueueSessions\.length > 0 && \(\s*<p id="sign-out-pending-warning"[\s\S]*?<\/p>\s*\)\}/)?.[0];
  assert.ok(condition);
  const code = transpileModule(
    `const render = (syncQueueSessions) => (${condition.slice(1, -1)}); render;`,
    { compilerOptions: { jsx: JsxEmit.React } },
  ).outputText;
  const render = runInNewContext(`${code}\nrender;`, {
    React: { createElement: (_type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ props, children }) },
  }) as (sessions: unknown[]) => false | { props: Record<string, unknown>; children: unknown[] };

  assert.equal(render([]), false);
  const warning = render([{}]);
  if (warning === false) assert.fail('Pending work must display the warning.');
  assert.equal(warning.props.id, 'sign-out-pending-warning');
  assert.match(String(warning.children[0]), /Signing out will pause synchronization/);
});

test('Sign Out intent and Cancel preserve login; double confirmation calls logout once on desktop and mobile', () => {
  const start = dashboard.indexOf('function closeSignOutDialog()');
  const end = dashboard.indexOf('\n  return (', start);
  assert.ok(start > 0 && end > start);
  const handlersSource = `${dashboard.slice(start, end)}\n({ openSignOutDialog, closeSignOutDialog, confirmSignOut });`;

  for (const mobile of [false, true]) {
    let menuOpen = true;
    let drawerOpen = mobile;
    let dialogOpen = false;
    let logoutCalls = 0;
    let accountFocused = 0;
    let mobileFocused = 0;
    const signOutConfirmedRef = { current: false };
    const signOutReturnFocusRef = { current: null };
    const accountTrigger = { focus: () => { accountFocused += 1; } };
    const mobileTrigger = { focus: () => { mobileFocused += 1; } };
    const handlers = runInNewContext(handlersSource, {
      isMobileNavOpen: mobile,
      signOutConfirmedRef,
      signOutReturnFocusRef,
      accountTriggerRef: { current: accountTrigger },
      mobileNavTriggerRef: { current: mobileTrigger },
      setIsAccountMenuOpen: (next: boolean) => { menuOpen = next; },
      setIsMobileNavOpen: (next: boolean) => { drawerOpen = next; },
      setIsSignOutDialogOpen: (next: boolean) => { dialogOpen = next; },
      onLogout: () => { logoutCalls += 1; },
      window: { requestAnimationFrame: (callback: () => void) => callback() },
    }) as { openSignOutDialog: () => void; closeSignOutDialog: () => void; confirmSignOut: () => void };

    handlers.openSignOutDialog();
    assert.equal(menuOpen, false);
    assert.equal(drawerOpen, false);
    assert.equal(dialogOpen, true);
    assert.equal(logoutCalls, 0);
    handlers.closeSignOutDialog();
    assert.equal(dialogOpen, false);
    assert.equal(logoutCalls, 0);
    assert.equal(mobile ? mobileFocused : accountFocused, 1);

    handlers.openSignOutDialog();
    handlers.confirmSignOut();
    handlers.confirmSignOut();
    assert.equal(logoutCalls, 1);
  }
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

test('offline Post-Test keeps its speech-only control centered on narrow screens', () => {
  assert.match(postTest, /mt-4 flex flex-col items-center gap-2/);
  assert.match(postTest, /flex min-h-12 items-center gap-2 rounded-full px-6 py-3/);
  assert.doesNotMatch(postTest, /<textarea\b/);
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
  assert.match(auth, /Forgot password\?/);
  assert.doesNotMatch(auth, /Recovery unavailable/);
  assert.doesNotMatch(auth, /href="#"/);
});
