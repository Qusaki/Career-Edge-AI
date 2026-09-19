import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isPostTestCompletionDisabled } from '../src/components/PostTestPage';
import { isActiveListeningCompletionDisabled } from '../src/components/PreTestPage';

const activeListeningReady = {
  completing: false,
  isSubmittingAnswer: false,
  isAiResponding: false,
  isListening: false,
  isFinalizing: false,
  hasUserResponse: true,
};

const postTestReady = {
  completing: false,
  isSubmittingAnswer: false,
  isAiResponding: false,
  isListening: false,
  isFinalizing: false,
  canComplete: true,
};

test('Active Listening completion requires a saved response and a terminal turn state', () => {
  assert.equal(isActiveListeningCompletionDisabled(activeListeningReady), false);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, hasUserResponse: false }), true);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, completing: true }), true);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, isSubmittingAnswer: true }), true);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, isAiResponding: true }), true);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, isListening: true }), true);
  assert.equal(isActiveListeningCompletionDisabled({ ...activeListeningReady, isFinalizing: true }), true);
});

test('a resumed Active Listening session with a persisted response remains completable', () => {
  const resumedSession = { ...activeListeningReady, hasUserResponse: true };
  assert.equal(isActiveListeningCompletionDisabled(resumedSession), false);
});

test('Post-Test completion requires exactly five answers and a terminal turn state', () => {
  assert.equal(isPostTestCompletionDisabled(postTestReady), false);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, canComplete: false }), true);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, completing: true }), true);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, isSubmittingAnswer: true }), true);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, isAiResponding: true }), true);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, isListening: true }), true);
  assert.equal(isPostTestCompletionDisabled({ ...postTestReady, isFinalizing: true }), true);
});

test('Active Listening keeps an online turn locked until a terminal signal or watchdog recovery', () => {
  const source = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const sendIndex = source.indexOf('socket.send(JSON.stringify({ text }));');
  const sentIndex = source.indexOf('sentToServer = true;', sendIndex);
  const watchdogIndex = source.indexOf('armActiveListeningTurnWatchdog(socket', sentIndex);

  assert.ok(sendIndex >= 0);
  assert.ok(sentIndex > sendIndex);
  assert.ok(watchdogIndex > sentIndex);
  assert.match(source, /if \(eventType === 'turn_complete'\) \{[\s\S]*?resetActiveListeningTurnState\(\)/);
  assert.match(source, /if \(eventType === 'error'\) \{[\s\S]*?resetActiveListeningTurnState\(\)/);
  assert.match(source, /socket\.onclose = event => \{[\s\S]*?resetActiveListeningTurnState\(\)/);
  assert.match(source, /socket\.onerror = \(\) => \{[\s\S]*?resetActiveListeningTurnState\(\)/);
  assert.match(source, /if \(isOnlineSubmission && !sentToServer\) \{[\s\S]*?resetActiveListeningTurnState\(\)/);
});

test('Post-Test revalidates the intended socket after its awaited checkpoint and keeps the lock after send', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  const intendedSocketIndex = source.indexOf("const intendedSocket = sessionMode === 'offline' ? null : wsRef.current;");
  const checkpointIndex = source.indexOf('await onActivityCheckpoint', intendedSocketIndex);
  const currentSocketIndex = source.indexOf('const socket = wsRef.current;', checkpointIndex);
  const identityCheckIndex = source.indexOf('socket !== intendedSocket', currentSocketIndex);
  const sendIndex = source.indexOf('socket.send(JSON.stringify({ text }));', identityCheckIndex);
  const watchdogIndex = source.indexOf('armPostTestTurnWatchdog(socket', sendIndex);

  assert.ok(intendedSocketIndex >= 0);
  assert.ok(checkpointIndex > intendedSocketIndex);
  assert.ok(currentSocketIndex > checkpointIndex);
  assert.ok(identityCheckIndex > currentSocketIndex);
  assert.ok(sendIndex > identityCheckIndex);
  assert.ok(watchdogIndex > sendIndex);
  assert.match(source, /finally \{\s*if \(!sentToServer\) resetPostTestTurnState\(\);\s*\}/);
  assert.match(source, /if \(eventType === 'turn_complete'\) \{[\s\S]*?resetPostTestTurnState\(\)/);
  assert.match(source, /socket\.onclose = event => \{[\s\S]*?resetPostTestTurnState\(\)/);
  assert.match(source, /socket\.onerror = \(\) => \{[\s\S]*?resetPostTestTurnState\(\)/);
});

test('both completion paths expose authentication recovery and reject duplicate clicks', () => {
  const activeListeningSource = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const postTestSource = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');

  assert.match(activeListeningSource, /if \(completing \|\| completionInFlightRef\.current\) return/);
  assert.match(activeListeningSource, /PRE_TEST_AUTH_RECOVERY_ERROR/);
  assert.match(postTestSource, /completing\s*\|\| completionInFlightRef\.current/);
  assert.match(postTestSource, /POST_TEST_AUTH_RECOVERY_ERROR/);
});

test('each activity renders one authoritative completion action', () => {
  const activeListeningSource = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const postTestSource = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');

  assert.equal(activeListeningSource.match(/onClick=\{completeActiveExercise\}/g)?.length, 1);
  assert.equal(postTestSource.match(/onClick=\{completePostTest\}/g)?.length, 1);
});
