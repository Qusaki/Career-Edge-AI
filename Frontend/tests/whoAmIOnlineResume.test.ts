import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isWhoAmICompletionDisabled } from '../src/components/PreTestPage';

const preTestSource = readFileSync(
  new URL('../src/components/PreTestPage.tsx', import.meta.url),
  'utf8',
);
const speechSource = readFileSync(
  new URL('../src/hooks/useSpeechInput.ts', import.meta.url),
  'utf8',
);

test('fresh online Who Am I starts without fabricating a transcript', () => {
  assert.match(preTestSource, /const restoredIntroTranscript = exercise\.kind === 'intro'[\s\S]*?session\.transcript\?\.trim\(\) \|\| ''/);
  assert.match(preTestSource, /setNotice\('Who Am I\? started\. Use the mic to introduce yourself\.'\)/);
  assert.match(preTestSource, /Press the mic and speak your self-introduction\./);
  assert.match(preTestSource, /introTranscript\.trim\(\) \|\| hasPendingOfflineAudio \? 'Re-record Answer' : 'Speak Answer'/);
});

test('first and repeated Who Am I recordings send only the finalized candidate', () => {
  const commit = preTestSource.slice(
    preTestSource.indexOf('const commitIntroTranscript = async (transcript: string) => {'),
    preTestSource.indexOf('const recordAndSendReply = () =>'),
  );
  assert.match(commit, /const nextTranscript = transcript\.trim\(\)/);
  assert.match(commit, /body: JSON\.stringify\(\{ transcript: nextTranscript \}\)/);
  assert.doesNotMatch(commit, /\[introTranscriptRef\.current, transcript\]|mergeSpeechFragments/);
  assert.match(commit, /introTranscriptRef\.current = canonicalTranscript;\s*setIntroTranscript\(canonicalTranscript\)/);
});

test('a final online Who Am I response is persisted before frontend checkpoint state advances', () => {
  const persistenceRequest = preTestSource.indexOf("method: 'PUT'");
  const canonicalStateUpdate = preTestSource.indexOf('setIntroTranscript(canonicalTranscript)');
  const checkpointUpdate = preTestSource.indexOf('answers: [{ step: 1, text: canonicalTranscript');

  assert.match(preTestSource, /\$\{activeExercise\.endpoint\}\/\$\{execution\.serverSessionId\}\/response/);
  assert.ok(persistenceRequest >= 0);
  assert.ok(canonicalStateUpdate > persistenceRequest);
  assert.ok(checkpointUpdate > canonicalStateUpdate);
  assert.match(preTestSource, /normalizePreTestApiError\(body, 'Unable to save your Who Am I\? response\.'/);
});

test('online resume hydrates the canonical transcript into completion-ready state', () => {
  assert.match(preTestSource, /introTranscriptRef\.current = restoredIntroTranscript;[\s\S]*?setIntroTranscript\(restoredIntroTranscript\)/);
  assert.match(preTestSource, /responseCount: restoredIntroTranscript \? 1 : 0/);
  assert.match(preTestSource, /Your saved Who Am I\? response was restored\. You can complete the exercise when ready\./);
});

test('accepted response persistence and speech delivery both guard duplicate finalization', () => {
  assert.match(preTestSource, /if \(introPersistenceInFlightRef\.current\) return;[\s\S]*?introPersistenceInFlightRef\.current = true/);
  assert.match(speechSource, /if \(this\.deliveryClaimed\) return null/);
  assert.match(speechSource, /this\.deliveryClaimed = true/);
});

test('failed online replacement leaves the accepted answer intact and can be retried', () => {
  const onlineSave = preTestSource.slice(
    preTestSource.indexOf("if (execution.mode === 'online') {", preTestSource.indexOf('const commitIntroTranscript')),
    preTestSource.indexOf('const saved = await onActivityCheckpoint', preTestSource.indexOf('const commitIntroTranscript')),
  );
  const rejection = onlineSave.indexOf('if (!response.ok)');
  const accepted = onlineSave.indexOf('introTranscriptRef.current = canonicalTranscript');
  assert.ok(rejection >= 0 && accepted > rejection);
  assert.doesNotMatch(onlineSave.slice(0, accepted), /introTranscriptRef\.current = nextTranscript|setIntroTranscript\(nextTranscript\)/);
  assert.match(preTestSource, /if \(!nextTranscript\) return;/);
  assert.match(preTestSource, /if \(lifecycleGenerationRef\.current !== lifecycleGeneration\) return;\s*setError\(persistenceError/);
});

test('completion remains explicit and sends the hydrated response only once', () => {
  assert.match(preTestSource, /introRecordingStartingRef\.current \|\| isListening \|\| isFinalizing \|\| introPersistenceInFlightRef\.current/);
  assert.match(preTestSource, /\$\{activeExercise\.endpoint\}\/\$\{serverSessionId\}\/complete/);
  assert.match(preTestSource, /transcript: introTranscript/);
  assert.doesNotMatch(preTestSource, /automatically complete/i);
});

test('Who Am I completion is gated through every retake phase, then uses the saved answer', () => {
  const ready = {
    completing: false, isRecordingStarting: false, isListening: false, isFinalizing: false,
    isProcessingAudio: false, hasPendingOnlineAudio: false, isPersistingIntro: false,
    hasSavedAnswer: true, hasPendingOfflineAudio: false,
  };
  assert.equal(isWhoAmICompletionDisabled({ ...ready, hasSavedAnswer: false }), true);
  assert.equal(isWhoAmICompletionDisabled(ready), false);
  for (const flag of ['completing', 'isRecordingStarting', 'isListening', 'isFinalizing',
    'isProcessingAudio', 'hasPendingOnlineAudio', 'isPersistingIntro'] as const) {
    assert.equal(isWhoAmICompletionDisabled({ ...ready, [flag]: true }), true, flag);
  }
  assert.equal(isWhoAmICompletionDisabled({ ...ready, hasSavedAnswer: false, hasPendingOfflineAudio: true }), false);
  assert.match(preTestSource, /disabled=\{activeExercise\.kind === 'intro' \? introCompletionDisabled/);
  assert.match(preTestSource, /if \(isProcessingAudio \|\| pendingOnlineAudio\) return;/);
});

test('offline Who Am I keeps its local checkpoint, audio, and cumulative eye-contact path', () => {
  assert.match(preTestSource, /if \(execution\.mode === 'online'\)[\s\S]*?method: 'PUT'[\s\S]*?return;[\s\S]*?const saved = await onActivityCheckpoint/);
  assert.match(preTestSource, /sessionMode === 'offline' && activeSession \? \{/);
  assert.match(preTestSource, /activityType: activeExercise\.kind === 'intro' \? 'pre_test_intro'/);
  assert.match(preTestSource, /eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
  assert.match(preTestSource, /if \(saved && lifecycleGenerationRef\.current === lifecycleGeneration\) \{\s*introTranscriptRef\.current = nextTranscript;\s*setIntroTranscript\(nextTranscript\)/);
  assert.match(preTestSource, /else if \(!saved && lifecycleGenerationRef\.current === lifecycleGeneration\) \{\s*setError\('Unable to save your Who Am I\? response\. Please retry\.'/);
});
