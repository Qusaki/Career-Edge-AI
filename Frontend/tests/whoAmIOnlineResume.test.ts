import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
});

test('a final online Who Am I response is persisted before frontend checkpoint state advances', () => {
  const persistenceRequest = preTestSource.indexOf("method: 'PUT'");
  const canonicalStateUpdate = preTestSource.indexOf('setIntroTranscript(canonicalTranscript)');
  const checkpointUpdate = preTestSource.indexOf('answers: [{ step: 1, text: canonicalTranscript');

  assert.match(preTestSource, /\$\{activeExercise\.endpoint\}\/\$\{execution\.serverSessionId\}\/response/);
  assert.ok(persistenceRequest >= 0);
  assert.ok(canonicalStateUpdate > persistenceRequest);
  assert.ok(checkpointUpdate > canonicalStateUpdate);
  assert.match(preTestSource, /normalizeApiError\(body, 'Unable to save your Who Am I\? response\.'/);
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

test('completion remains explicit and sends the hydrated response only once', () => {
  assert.match(preTestSource, /if \(activeExercise\.kind === 'intro' && introPersistenceInFlightRef\.current\) return/);
  assert.match(preTestSource, /\$\{activeExercise\.endpoint\}\/\$\{serverSessionId\}\/complete/);
  assert.match(preTestSource, /transcript: introTranscript/);
  assert.doesNotMatch(preTestSource, /automatically complete/i);
});

test('offline Who Am I keeps its local checkpoint, audio, and cumulative eye-contact path', () => {
  assert.match(preTestSource, /if \(execution\.mode === 'online'\)[\s\S]*?method: 'PUT'[\s\S]*?return;[\s\S]*?const saved = await onActivityCheckpoint/);
  assert.match(preTestSource, /sessionMode === 'offline' && activeSession \? \{/);
  assert.match(preTestSource, /activityType: activeExercise\.kind === 'intro' \? 'pre_test_intro'/);
  assert.match(preTestSource, /eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
});
