import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppUpdateNotice } from '../src/components/AppUpdateNotice';
import { isNewDeployment } from '../src/hooks/usePwaUpdate';
import { hasUnsyncedOfflineWork, isUpdateSessionActive } from '../src/offline/updateRefreshSafety';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../src/hooks/usePwaUpdate.ts', import.meta.url), 'utf8');
const pwaConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

const renderNotice = (blockedReason: 'active-session' | 'unsynced-work' | 'checking-work' | null) => (
  renderToStaticMarkup(
    <AppUpdateNotice
      available
      blockedReason={blockedReason}
      isRefreshing={false}
      error={null}
      onRefresh={() => {}}
      onCheckAgain={() => {}}
    />,
  )
);

const sessionState = (activeTab: string, activeCheckpoint: { mode: 'online' | 'offline'; status: 'in_progress' } | null = null) => ({
  activeTab,
  isModuleSessionMode: false,
  activeCheckpoint,
  isStartingInterview: false,
  thesisIsStarting: false,
});

test('new deployment identity is detected while malformed or same-build responses are ignored', () => {
  assert.equal(isNewDeployment('old-build', { buildId: 'new-build' }), true);
  assert.equal(isNewDeployment('same-build', { buildId: 'same-build' }), false);
  assert.equal(isNewDeployment('old-build', { buildId: '' }), false);
  assert.equal(isNewDeployment('old-build', null), false);
  assert.equal(isNewDeployment('old-build', { buildId: 123 }), false);
});

test('available update shows a compact notice; no update shows none', () => {
  assert.match(renderNotice(null), /A new Career Edge version is available/);
  assert.equal(renderToStaticMarkup(
    <AppUpdateNotice available={false} blockedReason={null} isRefreshing={false} error={null} onRefresh={() => {}} />,
  ), '');
});

test('an idle Dashboard, Profile, Settings, or History allows an explicit Refresh now', () => {
  for (const activeTab of ['dashboard', 'profile', 'settings', 'history']) {
    assert.equal(isUpdateSessionActive(sessionState(activeTab)), false);
  }
  assert.match(renderNotice(null), /Refresh now/);
});

test('an active interview prevents immediate refresh', () => {
  assert.equal(isUpdateSessionActive(sessionState('dashboard', { mode: 'online', status: 'in_progress' })), true);
  assert.doesNotMatch(renderNotice('active-session'), /Refresh now/);
});

test('a Drill screen prevents refresh while practice may start or remain active', () => {
  assert.equal(isUpdateSessionActive(sessionState('drills')), true);
});

test('a Pre-Test screen prevents refresh while practice may start or remain active', () => {
  assert.equal(isUpdateSessionActive(sessionState('pre-test')), true);
});

test('a Post-Test screen prevents refresh while practice may start or remain active', () => {
  assert.equal(isUpdateSessionActive(sessionState('post-test')), true);
});

test('an Enrollment session or pending start prevents refresh', () => {
  assert.equal(isUpdateSessionActive(sessionState('interview-session')), true);
  assert.equal(isUpdateSessionActive({ ...sessionState('university-setup'), isStartingInterview: true }), true);
});

test('a Thesis session or pending start prevents refresh', () => {
  assert.equal(isUpdateSessionActive(sessionState('thesis-session')), true);
  assert.equal(isUpdateSessionActive({ ...sessionState('thesis-setup'), thesisIsStarting: true }), true);
});

test('an authoritative offline in-progress session prevents refresh', () => {
  assert.equal(isUpdateSessionActive(sessionState('dashboard', { mode: 'offline', status: 'in_progress' })), true);
  assert.match(renderNotice('active-session'), /Finish your current activity/);
});

test('pending, failed, completed-local, and active offline work prevent refresh', () => {
  for (const status of ['pending_sync', 'sync_failed', 'syncing', 'completed_local', 'in_progress'] as const) {
    assert.equal(hasUnsyncedOfflineWork([{ mode: 'offline', status }]), true);
  }
  assert.equal(hasUnsyncedOfflineWork([{ mode: 'offline', status: 'synced' }]), false);
  assert.equal(hasUnsyncedOfflineWork([{ mode: 'online', status: 'in_progress' }]), false);
  assert.doesNotMatch(renderNotice('unsynced-work'), /Refresh now/);
  assert.match(renderNotice('unsynced-work'), /Finish or sync your saved offline work/);
});

test('refresh guard reads but never deletes local work', () => {
  const safetyMethods = dbSource.slice(dbSource.indexOf('async hasUnsyncedOfflineWork('), dbSource.indexOf('async getPendingOfflineSessions('));
  assert.match(safetyMethods, /\.toArray\(\)/);
  assert.doesNotMatch(safetyMethods, /\.delete\(|\.clear\(|\.put\(/);
  assert.match(dashboardSource, /await accountStorage\.hasUnsyncedOfflineWork\(userId\)/);
  assert.match(appSource, /await accountStorage\.hasAnyUnsyncedOfflineWork\(\)/);
});

test('activation is attempted only on an explicit refresh and cannot auto-reload in a loop', () => {
  assert.equal((hookSource.match(/window\.location\.reload\(\)/g) || []).length, 1);
  assert.match(hookSource, /if \(!updateAvailable \|\| refreshingRef\.current\) return/);
  assert.match(hookSource, /await waitForNewController\(original, ACTIVATION_WAIT_MS\)/);
  assert.doesNotMatch(hookSource, /updateSW\(true\)/);
});

test('old tabs detect a new version through controller change, focus, and a bounded periodic check', () => {
  assert.match(hookSource, /addEventListener\('controllerchange', onControllerChange\)/);
  assert.match(hookSource, /addEventListener\('focus', onFocus\)/);
  assert.match(hookSource, /UPDATE_CHECK_INTERVAL_MS = 5 \* 60_000/);
  assert.match(hookSource, /fetch\(`\/version\.json\?check=\$\{Date\.now\(\)\}`/);
  assert.match(pwaConfig, /'\*\*\/version\.json'/);
});

test('update notice is accessible and remains usable on mobile without trapping focus', () => {
  const markup = renderNotice(null);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /max-w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(markup, /focus-visible:outline/);
  assert.match(markup, /min-h-11/);
  assert.doesNotMatch(markup, /role="dialog"|aria-modal/);
});

test('a failed update keeps the notice and a retry action without reloading automatically', () => {
  const markup = renderToStaticMarkup(
    <AppUpdateNotice
      available
      blockedReason={null}
      isRefreshing={false}
      error="The update is not ready yet. Keep working and try again when connected."
      onRefresh={() => {}}
    />,
  );
  assert.match(markup, /The update is not ready yet/);
  assert.match(markup, /Refresh now/);
});

test('saved-work verification failure offers Check again without a refresh action', () => {
  const markup = renderToStaticMarkup(
    <AppUpdateNotice
      available
      blockedReason="checking-work"
      isRefreshing={false}
      error="Saved work could not be checked."
      onRefresh={() => {}}
      onCheckAgain={() => {}}
    />,
  );
  assert.match(markup, /Check again/);
  assert.doesNotMatch(markup, /Refresh now/);
});

test('the build marker changes the app shell without precaching the version endpoint', () => {
  assert.match(pwaConfig, /transformIndexHtml/);
  assert.match(pwaConfig, /name: 'career-edge-build'/);
  assert.match(pwaConfig, /fileName: 'version\.json'/);
  assert.match(pwaConfig, /registerType: 'autoUpdate'/);
  assert.match(pwaConfig, /'\*\*\/offline-webllm-\*\.js'/);
  assert.match(hookSource, /The update is not ready yet\. Keep working and try again when connected/);
});
