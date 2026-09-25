import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createActivityCheckpoint, createCompletedLocalCheckpoint, createPendingSyncCheckpoint } from '../src/offline/sessionFoundation';
import { buildOfflineSyncPayload, syncOfflineSession } from '../src/offline/offlineSyncClient';
import { resolvePreTestSessionExecution } from '../src/utils/preTestSessionExecution';
import { resolveSessionExecution } from '../src/utils/sessionExecution';
import { hasRestorableOfflineIdentity, isOfflineClientSessionId, isPositiveServerSessionId } from '../src/utils/sessionIdentity';
import { normalizePreTestApiError, PRE_TEST_SESSION_RECOVERY_MESSAGE } from '../src/utils/preTestApiError';

const source = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
const preTestSource = source('PreTestPage.tsx');
const dashboardSource = source('Dashboard.tsx');
const uuid = '503a5f64-4746-4500-b646-cd7a6295de12';

test('online server identity accepts only an existing positive safe number', () => {
  assert.equal(isPositiveServerSessionId(42), true);
  for (const value of [uuid, '42', '', 'undefined', 'null', 'NaN', null, undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isPositiveServerSessionId(value), false, String(value));
  }
});

test('Who Am I and Active Listening reject malformed online IDs without turning them into client IDs', () => {
  for (const activeSessionId of [uuid, '42', 0, 1.5, null, undefined]) {
    for (const resolve of [resolvePreTestSessionExecution, resolveSessionExecution]) {
      assert.deepEqual(resolve({
        sessionMode: 'online', activeSessionId: activeSessionId as number | string,
        knownOfflineClientSessionId: null,
      }), { mode: 'invalid', reason: 'unverified_session' });
    }
  }
  assert.deepEqual(resolvePreTestSessionExecution({
    sessionMode: 'online', activeSessionId: 9, knownOfflineClientSessionId: null,
  }), { mode: 'online', serverSessionId: 9 });
  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'online', activeSessionId: 10, knownOfflineClientSessionId: null,
  }), { mode: 'online', serverSessionId: 10 });
});

test('saved offline identity requires its own matching string ID and a valid optional server ID', () => {
  const base = { mode: 'offline' as const, localId: uuid, clientSessionId: uuid, serverSessionId: null };
  assert.equal(hasRestorableOfflineIdentity(base), true);
  assert.equal(hasRestorableOfflineIdentity({ ...base, serverSessionId: 17 }), true);
  for (const changed of [
    { mode: 'online' as const }, { localId: 'other' }, { clientSessionId: '' },
    { clientSessionId: 17 as unknown as string }, { serverSessionId: uuid as unknown as number },
    { serverSessionId: '17' as unknown as number }, { serverSessionId: 0 }, { serverSessionId: 1.5 },
  ]) {
    assert.equal(hasRestorableOfflineIdentity({ ...base, ...changed }), false);
  }
});

test('client identity remains string-only and is never substituted from a server number', () => {
  assert.equal(isOfflineClientSessionId(uuid), true);
  for (const value of [null, undefined, 17, '', '   ']) {
    assert.equal(isOfflineClientSessionId(value), false);
  }
  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'offline', activeSessionId: 17, knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('Pre-Test restoration rejects malformed checkpoints before installing an active session', () => {
  const guard = preTestSource.indexOf('if (!hasRestorableOfflineIdentity(resumeSession))');
  const active = preTestSource.indexOf('setActiveSession({', guard);
  assert.ok(guard >= 0 && active > guard);
  assert.match(preTestSource.slice(guard, active), /setError\('This saved Pre-Test has an invalid session identity/);
  assert.match(preTestSource, /isPositiveServerSessionId\(resumeSession\.serverSessionId\)/);
});

test('Pre-Test start validates Who Am I and Active Listening before state, detail, or WebSocket', () => {
  const start = preTestSource.indexOf('const session: Session = await response.json()');
  const intro = preTestSource.indexOf('resolvePreTestSessionExecution({', start);
  const listening = preTestSource.indexOf('resolveSessionExecution({', start);
  const detail = preTestSource.indexOf('const sessionDetailResponse = await fetch', start);
  const active = preTestSource.indexOf('setActiveSession(', start);
  const socket = preTestSource.indexOf('connectActiveListeningChat(activeListeningServerSessionId)', start);
  assert.ok(start >= 0 && intro > start && listening > intro && detail > listening && active > detail && socket > active);
});

test('Pre-Test response save and completion use only resolved server IDs', () => {
  assert.match(preTestSource, /\$\{execution\.serverSessionId\}\/response/);
  assert.match(preTestSource, /\$\{serverSessionId\}\/complete/);
  assert.doesNotMatch(preTestSource, /\$\{activeSession\.id\}\/(?:response|complete)/);
  assert.match(preTestSource, /if \(introExecution\?\.mode === 'invalid'\)/);
  assert.match(preTestSource, /if \(activeListeningExecution\?\.mode === 'invalid'\)/);
});

test('Pre-Test integer parse errors are product-level while unrelated errors are preserved', () => {
  const parseError = { detail: [{ loc: ['path', 'session_id'], msg: 'Input should be a valid integer, unable to parse string as an integer', type: 'int_parsing' }] };
  assert.equal(normalizePreTestApiError(parseError, 'Fallback'), PRE_TEST_SESSION_RECOVERY_MESSAGE);
  assert.equal(normalizePreTestApiError({ detail: 'The server is busy.' }, 'Fallback'), 'The server is busy.');
  assert.equal(normalizePreTestApiError({ detail: [{ msg: 'Answer is required' }] }, 'Fallback'), 'Answer is required');
  assert.equal(normalizePreTestApiError(null, 'Fallback'), 'Fallback');
  assert.match(preTestSource, /normalizePreTestApiError\(body, `Unable to complete/);
});

test('Enrollment and Thesis start responses are validated before session state or socket creation', () => {
  for (const endpoint of ['upcoming-student-interview/start', 'thesis-interview/start']) {
    const start = dashboardSource.indexOf(endpoint);
    const guard = dashboardSource.indexOf('if (!isPositiveServerSessionId(serverSessionId))', start);
    const assign = dashboardSource.indexOf('sid = serverSessionId', start);
    const socket = dashboardSource.indexOf("connectOnlineInterview(", assign);
    assert.ok(start >= 0 && guard > start && assign > guard && socket > assign, endpoint);
  }
  const socketFunction = dashboardSource.indexOf('const connectOnlineInterview = (');
  const socketCreation = dashboardSource.indexOf('new WebSocket(', socketFunction);
  assert.match(dashboardSource.slice(socketFunction, socketCreation), /isPositiveServerSessionId\(interviewSessionId\)/);
});

test('offline sync rejects malformed restored server IDs without sending or deleting local work', async () => {
  const pending = createPendingSyncCheckpoint(createCompletedLocalCheckpoint(createActivityCheckpoint(7, {
    type: 'pre_test_intro', mode: 'offline', questionPackVersion: 'pretest-who-am-i-v1',
  }, 'offline', uuid)));
  assert.equal(buildOfflineSyncPayload(pending).server_session_id, null);
  assert.equal(buildOfflineSyncPayload({ ...pending, serverSessionId: 5 }).server_session_id, 5);
  for (const invalidId of [uuid, '5', 0, 1.5]) {
    assert.throws(() => buildOfflineSyncPayload({ ...pending, serverSessionId: invalidId as number }), { code: 'invalid_server_session_id' });
  }
  assert.throws(() => buildOfflineSyncPayload({ ...pending, clientSessionId: 5 as unknown as string }), { code: 'invalid_client_session_id' });
  assert.throws(() => buildOfflineSyncPayload({ ...pending, localId: 'different' }), { code: 'invalid_client_session_id' });
  let stored = { ...pending, serverSessionId: uuid as unknown as number };
  let fetchCount = 0;
  await assert.rejects(() => syncOfflineSession(stored, {
    apiUrl: 'https://api.example', token: 'redacted', userId: 7,
    fetchImpl: async () => { fetchCount += 1; throw new Error('Must not send'); },
    storage: {
      getPendingOfflineSessions: async () => [stored],
      updateOfflineSession: async (_userId, _type, _localId, update) => {
        stored = { ...stored, ...update };
        return stored;
      },
    },
  }), { code: 'invalid_server_session_id' });
  assert.equal(fetchCount, 0);
  assert.equal(stored.status, 'sync_failed');
  assert.equal(stored.retryDisposition, 'manual_attention');
  assert.equal(stored.clientSessionId, uuid);
});

test('Drill and Post-Test restored checkpoints reject identity mismatches before active state', () => {
  for (const component of ['DrillsPage.tsx', 'PostTestPage.tsx']) {
    const componentSource = source(component);
    const guard = componentSource.indexOf('if (!hasRestorableOfflineIdentity(resumeSession))');
    const active = componentSource.indexOf('setActiveSession({', guard);
    assert.ok(guard >= 0 && active > guard, component);
  }
});
