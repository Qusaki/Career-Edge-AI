import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PostTestPage } from '../src/components/PostTestPage';
import { isPostTestUnlocked, postTestAccessForUser, readPostTestAccess, requestPostTestNavigation, retainPostTestVerificationForUser, UNKNOWN_POST_TEST_VERIFICATION, verifyPostTestAccess, type PostTestAccess } from '../src/utils/postTestProgress';

const locked: PostTestAccess = {
  post_test_unlocked: false,
  completed_drill_count: 11,
  required_drill_count: 12,
};
const unlocked: PostTestAccess = {
  post_test_unlocked: true,
  completed_drill_count: 12,
  required_drill_count: 12,
};

const postTestProps = (access: PostTestAccess | null, progressFetchError: string | null = null) => ({
  apiUrl: 'http://localhost:8000',
  userDepartment: 'CCIT',
  effectiveOnline: true,
  sessionMode: 'online' as const,
  resumeSession: null,
  onActivityStart: async () => null,
  onActivityCheckpoint: async () => true,
  onActivityEnd: async () => true,
  onOfflineAudioCaptured: async () => true,
  postTestAccess: access,
  progressChecking: access === null,
  progressFetchError,
  onGoToDrills: () => {},
});

const renderPostTest = (access: PostTestAccess | null, progressFetchError: string | null = null) =>
  renderToStaticMarkup(<PostTestPage {...postTestProps(access, progressFetchError)} />);

test('locked direct Post-Test access renders guidance without mounting the activity', () => {
  const markup = renderPostTest(locked);
  assert.match(markup, /Post-Test Locked/);
  assert.match(markup, /Complete all Drill activities before taking your final assessment/);
  assert.match(markup, /Drills completed: 11 \/ 12/);
  assert.match(markup, /Go to Drills/);
  assert.doesNotMatch(markup, /Start Post-Test|CameraTrackingNotice|Speak Answer|Post-Test Session/);
});

test('unverified direct Post-Test access remains locked without exposing activity controls', () => {
  const markup = renderPostTest(null);
  assert.match(markup, /Checking your Drill progress/);
  assert.doesNotMatch(markup, /Start Post-Test|Speak Answer/);
});

test('authoritatively unlocked access renders the normal Post-Test start page', () => {
  const markup = renderPostTest(unlocked);
  assert.match(markup, /Final Interview Assessment/);
  assert.match(markup, /Start Post-Test/);
  assert.doesNotMatch(markup, /Post-Test Locked/);
});

test('only the authoritative backend unlock field enables Post-Test', () => {
  assert.equal(isPostTestUnlocked(null), false);
  assert.equal(isPostTestUnlocked(locked), false);
  assert.equal(isPostTestUnlocked(unlocked), true);
  assert.deepEqual(readPostTestAccess({ ...locked, completed_drill_count: 11 }), locked);
  assert.deepEqual(readPostTestAccess(unlocked), unlocked);
  assert.equal(readPostTestAccess({ ...unlocked, post_test_unlocked: 'true' }), null);
  assert.equal(readPostTestAccess({ ...unlocked, required_drill_count: 0 }), null);
});

test('Dashboard keeps locked Post-Test navigation visible but does not navigate', () => {
  const navigate = mock.fn(() => {});
  const showLockedGuidance = mock.fn(() => {});
  requestPostTestNavigation(locked, navigate, showLockedGuidance);
  requestPostTestNavigation(null, navigate, showLockedGuidance);
  assert.equal(navigate.mock.callCount(), 0);
  assert.equal(showLockedGuidance.mock.callCount(), 2);
  requestPostTestNavigation(unlocked, navigate, showLockedGuidance);
  assert.equal(navigate.mock.callCount(), 1);

  const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /requestPostTestNavigation\(\s*postTestAccess/);
  assert.match(source, /aria-disabled=\{!isPostTestUnlocked\(postTestAccess\)\}/);
  assert.match(source, /<Lock className="w-5 h-5" \/>/);
  assert.match(source, /Complete all Drills to unlock/);
  assert.match(source, /postTestAccess=\{postTestAccess\}/);
});

test('final Drill completion and accepted offline sync refresh backend-authoritative access', () => {
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
  assert.match(drills, /setProgress\(progressData\);\s*onProgressChange\?\.\(postTestAccess\)/);
  assert.match(drills, /setNotice\('Drill was marked complete\.'\)[\s\S]*?await loadSessions\(\)/);
  assert.match(dashboard, /onProgressChange=\{handleDrillProgressChange\}/);
  assert.match(dashboard, /if \(synchronized <= 0\) return;[\s\S]*?refreshPostTestProgress\(authenticatedUserId\)/);
  assert.match(dashboard, /retryOfflineSessionManually\([\s\S]*?refreshPostTestProgress\(authenticatedUserId\)/);
  assert.doesNotMatch(dashboard, /localStorage\.(?:getItem|setItem)\(['"]postTestUnlocked/);
});

test('Post-Test start, WebSocket, and camera hooks live only in the gated activity component', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  const gateIndex = source.indexOf('export function PostTestPage(');
  const childIndex = source.indexOf('function PostTestActivity(');
  const socketIndex = source.indexOf('new WebSocket(');
  const cameraIndex = source.indexOf('useEyeContactTracker(');
  const startIndex = source.indexOf('/post-test-interview/start');
  assert.ok(gateIndex >= 0 && childIndex > gateIndex);
  assert.ok(socketIndex > childIndex && cameraIndex > childIndex && startIndex > childIndex);
  assert.match(source.slice(gateIndex, childIndex), /if \(!isPostTestUnlocked\(postTestAccess\)\) \{[\s\S]*?return \(/);
});

test('never-verified progress failure stays inaccessible and explains verification failure', () => {
  const state = retainPostTestVerificationForUser(UNKNOWN_POST_TEST_VERIFICATION, 1);
  assert.equal(state.status, 'unknown');
  assert.equal(postTestAccessForUser(state, 1), null);
  const markup = renderPostTest(null, 'Unable to refresh Drill progress.');
  assert.match(markup, /Post-Test Access Unverified/);
  assert.match(markup, /Unable to refresh Drill progress/);
  assert.doesNotMatch(markup, /Post-Test Locked|Start Post-Test/);
});

test('failed recheck preserves a same-user verified locked result', () => {
  const verified = verifyPostTestAccess(1, locked);
  assert.equal(verified.status, 'verified_locked');
  const afterFailure = retainPostTestVerificationForUser(verified, 1);
  assert.strictEqual(afterFailure, verified);
  assert.strictEqual(postTestAccessForUser(afterFailure, 1), locked);
  assert.match(renderPostTest(postTestAccessForUser(afterFailure, 1), 'Unable to refresh Drill progress.'), /Post-Test Locked/);
});

test('failed recheck preserves unlocked activity identity without triggering its unmount path', () => {
  const verified = verifyPostTestAccess(1, unlocked);
  assert.equal(verified.status, 'verified_unlocked');
  const before = PostTestPage(postTestProps(postTestAccessForUser(verified, 1)));
  const afterFailure = retainPostTestVerificationForUser(verified, 1);
  const after = PostTestPage(postTestProps(postTestAccessForUser(afterFailure, 1), 'Unable to refresh Drill progress.'));
  assert.strictEqual(afterFailure, verified);
  assert.strictEqual(postTestAccessForUser(afterFailure, 1), unlocked);
  assert.strictEqual(after.type, before.type);
  assert.strictEqual(after.key, before.key);
  assert.match(renderPostTest(postTestAccessForUser(afterFailure, 1)), /Start Post-Test/);
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('function PostTestActivity(') < source.indexOf("socket.close(1000, 'Exercise closed.')"));
  assert.ok(source.indexOf('function PostTestActivity(') < source.indexOf('cancelListening();'));
});

test('successful authoritative rechecks update locked and unlocked states in either direction', () => {
  const initiallyLocked = verifyPostTestAccess(1, locked);
  const unlockedAfterSync = verifyPostTestAccess(1, unlocked);
  assert.equal(initiallyLocked.status, 'verified_locked');
  assert.equal(unlockedAfterSync.status, 'verified_unlocked');
  assert.equal(isPostTestUnlocked(postTestAccessForUser(unlockedAfterSync, 1)), true);
  assert.equal(verifyPostTestAccess(1, unlocked).status, 'verified_unlocked');
  const relockedByServer = verifyPostTestAccess(1, locked);
  assert.equal(relockedByServer.status, 'verified_locked');
  assert.equal(isPostTestUnlocked(postTestAccessForUser(relockedByServer, 1)), false);
});

test('logout and account switch cannot transfer a verified unlock', () => {
  const userA = verifyPostTestAccess(1, unlocked);
  assert.equal(postTestAccessForUser(userA, 2), null);
  const userB = retainPostTestVerificationForUser(userA, 2);
  assert.equal(userB.status, 'unknown');
  assert.equal(postTestAccessForUser(retainPostTestVerificationForUser(userB, 2), 2), null);
  assert.equal(postTestAccessForUser(UNKNOWN_POST_TEST_VERIFICATION, null), null);
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /if \(!authenticatedUserId\) \{[\s\S]*?setPostTestVerification\(UNKNOWN_POST_TEST_VERIFICATION\)/);
  assert.match(dashboard, /setPostTestVerification\(current => retainPostTestVerificationForUser\(current, authenticatedUserId\)\)/);
});

test('pending final offline Drill cannot unlock; only a successful server response can', () => {
  const elevenVerified = verifyPostTestAccess(1, locked);
  assert.equal(retainPostTestVerificationForUser(elevenVerified, 1).status, 'verified_locked');
  assert.equal(isPostTestUnlocked(postTestAccessForUser(elevenVerified, 1)), false);
  const failedRefreshAfterSync = retainPostTestVerificationForUser(elevenVerified, 1);
  assert.equal(isPostTestUnlocked(postTestAccessForUser(failedRefreshAfterSync, 1)), false);
  const authoritativeRefresh = verifyPostTestAccess(1, unlocked);
  assert.equal(isPostTestUnlocked(postTestAccessForUser(authoritativeRefresh, 1)), true);
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /setPostTestVerification\(current => retainPostTestVerificationForUser\(current, userId\)\)/);
  assert.match(dashboard, /setPostTestVerification\(verifyPostTestAccess\(userId, access\)\)/);
});
