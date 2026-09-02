import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolvePreTestSessionExecution } from '../src/utils/preTestSessionExecution';

const offlineClientSessionId = '503a5f64-4746-4500-b646-cd7a6295de12';
const resolverSource = readFileSync(
  new URL('../src/utils/preTestSessionExecution.ts', import.meta.url),
  'utf8',
);
const preTestSource = readFileSync(
  new URL('../src/components/PreTestPage.tsx', import.meta.url),
  'utf8',
);

test('online Who Am I accepts only a positive safe integer server ID', () => {
  assert.deepEqual(resolvePreTestSessionExecution({
    sessionMode: 'online',
    activeSessionId: 42,
    knownOfflineClientSessionId: null,
  }), { mode: 'online', serverSessionId: 42 });

  for (const activeSessionId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(resolvePreTestSessionExecution({
      sessionMode: 'online',
      activeSessionId,
      knownOfflineClientSessionId: null,
    }), { mode: 'invalid', reason: 'unverified_session' });
  }
});

test('online string, malformed, and UUID IDs remain invalid and are never inferred as offline', () => {
  for (const activeSessionId of ['123', 'abc', offlineClientSessionId]) {
    assert.deepEqual(resolvePreTestSessionExecution({
      sessionMode: 'online',
      activeSessionId,
      knownOfflineClientSessionId: null,
    }), { mode: 'invalid', reason: 'unverified_session' });
  }
});

test('authoritative offline identity remains local after restore or reconnect', () => {
  for (const sessionMode of ['offline', 'online'] as const) {
    assert.deepEqual(resolvePreTestSessionExecution({
      sessionMode,
      activeSessionId: offlineClientSessionId,
      knownOfflineClientSessionId: offlineClientSessionId,
    }), { mode: 'offline', clientSessionId: offlineClientSessionId });
  }
});

test('offline mode without a verified checkpoint client identity is invalid', () => {
  assert.deepEqual(resolvePreTestSessionExecution({
    sessionMode: 'offline',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('resolver never coerces a local or malformed identity into a server ID', () => {
  assert.doesNotMatch(resolverSource, /Number\(|parseInt\(|parseFloat\(|unary/);
});

test('only offline checkpoints enter the restored Pre-Test session path', () => {
  assert.match(preTestSource, /!resumeSession \|\| resumeSession\.mode !== 'offline'/);
  assert.match(preTestSource, /activeOfflineClientSessionIdRef\.current = resumeSession\.clientSessionId/);
});

test('Who Am I persistence uses resolved server identity and retains transcript on invalid identity', () => {
  const invalidIndex = preTestSource.indexOf("if (execution.mode === 'invalid')");
  const persistenceIndex = preTestSource.indexOf('${execution.serverSessionId}/response');
  assert.ok(invalidIndex >= 0 && persistenceIndex > invalidIndex);
  assert.match(preTestSource, /introTranscriptRef\.current = nextTranscript;[\s\S]*?setIntroTranscript\(nextTranscript\);[\s\S]*?setError\(PRE_TEST_SESSION_RECOVERY_ERROR\)/);
  assert.match(preTestSource, /\$\{execution\.serverSessionId\}\/response/);
});

test('Who Am I completion resolves authority before local checkpoint or server request', () => {
  const completionStart = preTestSource.indexOf('const completeActiveExercise = async () =>');
  const invalidIndex = preTestSource.indexOf("if (introExecution?.mode === 'invalid')", completionStart);
  const localCheckpointIndex = preTestSource.indexOf('const checkpointSaved = await onActivityCheckpoint', completionStart);
  const serverRequestIndex = preTestSource.indexOf('${serverSessionId}/complete', completionStart);
  assert.ok(completionStart >= 0);
  assert.ok(invalidIndex > completionStart);
  assert.ok(localCheckpointIndex > invalidIndex);
  assert.ok(serverRequestIndex > invalidIndex);
  assert.match(preTestSource, /introExecution\?\.mode === 'online'[\s\S]*?introExecution\.serverSessionId/);
});

test('invalid online identity cannot create pending sync or clear the active session', () => {
  const completionStart = preTestSource.indexOf('const completeActiveExercise = async () =>');
  const invalidIndex = preTestSource.indexOf("if (introExecution?.mode === 'invalid')", completionStart);
  const pendingSyncIndex = preTestSource.indexOf("onActivityEnd('completed_local')", completionStart);
  const clearSessionIndex = preTestSource.indexOf('setActiveSession(null)', completionStart);
  assert.ok(invalidIndex >= 0);
  assert.ok(pendingSyncIndex > invalidIndex);
  assert.ok(clearSessionIndex > invalidIndex);
  assert.match(preTestSource.slice(invalidIndex, pendingSyncIndex), /setError\(PRE_TEST_SESSION_RECOVERY_ERROR\);\s*return;/);
});

