import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveSessionExecution } from '../src/utils/sessionExecution';

const offlineClientSessionId = 'a3214b60-3e63-4c27-bad5-745ff1a93373';
const activeListeningSource = readFileSync(
  new URL('../src/components/PreTestPage.tsx', import.meta.url),
  'utf8',
);
const postTestSource = readFileSync(
  new URL('../src/components/PostTestPage.tsx', import.meta.url),
  'utf8',
);

test('shared execution resolver accepts only a positive safe integer online server ID', () => {
  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'online',
    activeSessionId: 42,
    knownOfflineClientSessionId: null,
  }), { mode: 'online', serverSessionId: 42 });
});

test('shared execution resolver rejects every invalid online ID without coercion', () => {
  for (const activeSessionId of [
    '123',
    'abc',
    offlineClientSessionId,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.deepEqual(resolveSessionExecution({
      sessionMode: 'online',
      activeSessionId,
      knownOfflineClientSessionId: null,
    }), { mode: 'invalid', reason: 'unverified_session' });
  }
});

test('shared execution resolver requires both offline mode and verified client identity', () => {
  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'offline',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: offlineClientSessionId,
  }), { mode: 'offline', clientSessionId: offlineClientSessionId });

  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'offline',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });

  assert.deepEqual(resolveSessionExecution({
    sessionMode: 'online',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: offlineClientSessionId,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('Active Listening validates the start ID before detail hydration or WebSocket connection', () => {
  const startIndex = activeListeningSource.indexOf('const session: Session = await response.json()');
  const resolverIndex = activeListeningSource.indexOf('const execution = resolveSessionExecution({', startIndex);
  const detailIndex = activeListeningSource.indexOf('const sessionDetailResponse = await fetch', startIndex);
  const connectionIndex = activeListeningSource.indexOf('connectActiveListeningChat(activeListeningServerSessionId)', startIndex);

  assert.ok(startIndex >= 0);
  assert.ok(resolverIndex > startIndex);
  assert.ok(detailIndex > resolverIndex);
  assert.ok(connectionIndex > detailIndex);
  assert.match(activeListeningSource.slice(resolverIndex, detailIndex), /execution\.mode !== 'online'/);
});

test('Active Listening detail, prompt, and WebSocket paths use only the resolved numeric ID', () => {
  assert.match(activeListeningSource, /function connectActiveListeningChat\(serverSessionId: number/);
  assert.match(activeListeningSource, /pre-test-active-listening\/\$\{serverSessionId\}\/chat/);
  assert.match(activeListeningSource, /exercise\.endpoint\}\/\$\{activeListeningServerSessionId\}/);
  assert.match(activeListeningSource, /getActiveListeningPromptForServerSession\(activeListeningServerSessionId\)/);
  assert.doesNotMatch(activeListeningSource, /Number\(session\.id\)/);
  assert.doesNotMatch(activeListeningSource, /pre-test-active-listening\/\$\{session\.id\}/);
});

test('Active Listening completion rejects invalid identity before persistence, local completion, or API routing', () => {
  const completionIndex = activeListeningSource.indexOf('const completeActiveExercise = async () =>');
  const resolverIndex = activeListeningSource.indexOf('const activeListeningExecution =', completionIndex);
  const invalidIndex = activeListeningSource.indexOf("activeListeningExecution?.mode === 'invalid'", resolverIndex);
  const checkpointIndex = activeListeningSource.indexOf('const checkpointSaved = await onActivityCheckpoint', completionIndex);
  const pendingSyncIndex = activeListeningSource.indexOf("onActivityEnd('completed_local')", completionIndex);
  const requestIndex = activeListeningSource.indexOf('${serverSessionId}/complete', completionIndex);

  assert.ok(resolverIndex > completionIndex);
  assert.ok(invalidIndex > resolverIndex);
  assert.ok(checkpointIndex > invalidIndex);
  assert.ok(pendingSyncIndex > invalidIndex);
  assert.ok(requestIndex > invalidIndex);
  assert.match(activeListeningSource, /activeListeningExecution\.serverSessionId/);
});

test('Post-Test restores only authoritative offline checkpoints', () => {
  const restoreIndex = postTestSource.indexOf("resumeSession.type !== 'post_test'");
  const modeGuardIndex = postTestSource.indexOf("resumeSession.mode !== 'offline'", restoreIndex);
  const clientIdentityAssignmentIndex = postTestSource.indexOf('id: resumeSession.clientSessionId', restoreIndex);

  assert.ok(restoreIndex >= 0);
  assert.ok(modeGuardIndex > restoreIndex);
  assert.ok(clientIdentityAssignmentIndex > modeGuardIndex);
});

test('Post-Test validates the start ID before detail hydration or WebSocket connection', () => {
  const startIndex = postTestSource.indexOf('const session: Session = await response.json()');
  const resolverIndex = postTestSource.indexOf('const execution = resolveSessionExecution({', startIndex);
  const detailIndex = postTestSource.indexOf('const sessionDetailResponse = await fetch', startIndex);
  const detailFailureIndex = postTestSource.indexOf('if (!sessionDetailResponse.ok)', detailIndex);
  const connectionIndex = postTestSource.indexOf('connectPostTestChat(serverSessionId)', startIndex);

  assert.ok(resolverIndex > startIndex);
  assert.ok(detailIndex > resolverIndex);
  assert.ok(detailFailureIndex > detailIndex);
  assert.ok(connectionIndex > detailFailureIndex);
  assert.match(postTestSource.slice(resolverIndex, detailIndex), /execution\.mode !== 'online'/);
});

test('Post-Test detail and WebSocket paths use only the resolved numeric ID', () => {
  assert.match(postTestSource, /function connectPostTestChat\(serverSessionId: number/);
  assert.match(postTestSource, /post-test-interview\/\$\{serverSessionId\}\/chat/);
  assert.match(postTestSource, /post-test-interview\/\$\{serverSessionId\}`/);
  assert.doesNotMatch(postTestSource, /post-test-interview\/\$\{session\.id\}/);
});

test('Post-Test completion rejects invalid identity before answer mutation, local completion, or API routing', () => {
  const completionIndex = postTestSource.indexOf('const completePostTest = async () =>');
  const resolverIndex = postTestSource.indexOf('const execution = resolveSessionExecution({', completionIndex);
  const invalidIndex = postTestSource.indexOf("if (execution.mode === 'invalid')", resolverIndex);
  const currentMessagesIndex = postTestSource.indexOf('const currentMessages = messagesRef.current', completionIndex);
  const pendingSyncIndex = postTestSource.indexOf("onActivityEnd('completed_local')", completionIndex);
  const requestIndex = postTestSource.indexOf('${execution.serverSessionId}/complete', completionIndex);

  assert.ok(resolverIndex > completionIndex);
  assert.ok(invalidIndex > resolverIndex);
  assert.ok(currentMessagesIndex > invalidIndex);
  assert.ok(pendingSyncIndex > invalidIndex);
  assert.ok(requestIndex > invalidIndex);
  assert.doesNotMatch(postTestSource, /post-test-interview\/\$\{activeSession\.id\}\/complete/);
});

test('Post-Test online checkpoints cannot replace hydrated session state', () => {
  const restoreIndex = postTestSource.indexOf("resumeSession.type !== 'post_test'");
  const modeGuardIndex = postTestSource.indexOf("resumeSession.mode !== 'offline'", restoreIndex);
  const restoredMessagesIndex = postTestSource.indexOf('const restoredMessages = resumeSession.conversationLog', restoreIndex);
  const restoredQuestionIndex = postTestSource.indexOf('setLatestAiQuestion(currentQuestion)', restoreIndex);

  assert.ok(modeGuardIndex > restoreIndex);
  assert.ok(restoredMessagesIndex > modeGuardIndex);
  assert.ok(restoredQuestionIndex > modeGuardIndex);
});
