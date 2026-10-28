import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRetryRecognition,
  hasMeaningfulRecognitionProgress,
  MAX_RECOGNITION_RESTARTS,
  SpeechTranscriptAccumulator,
  type SpeechRecognitionResultLike,
  type SpeechTranscriptState,
} from '../src/hooks/useSpeechInput';

const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const recorder = readFileSync(new URL('../src/offline/offlineAudioRecorder.ts', import.meta.url), 'utf8');
const empty: SpeechTranscriptState = { finalTranscript: '', interimTranscript: '', liveTranscript: '' };
const result = (text: string, isFinal: boolean): SpeechRecognitionResultLike =>
  Object.assign([{ transcript: text }], { isFinal });

test('unexpected recognition ends restart, but four consecutive no-progress failures remain bounded', () => {
  for (let failure = 1; failure <= MAX_RECOGNITION_RESTARTS; failure += 1) {
    assert.equal(canRetryRecognition(failure, true, false), true);
  }
  assert.equal(canRetryRecognition(MAX_RECOGNITION_RESTARTS + 1, true, false), false);
  assert.match(hook, /recognition\.onend = \(\) => \{[\s\S]*?if \(listeningRef\.current && !session\.fatalError\) \{\s*scheduleRestart\(session, 250/);
  assert.match(hook, /session\.retryCount \+= 1;[\s\S]*?if \(!canRetryRecognition\([\s\S]*?finishRecognitionFailure\(session, failureMessage\)/);
});

test('new usable interim and final results reset the consecutive failure streak', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.beginRecognitionAttempt();
  const interim = accumulator.applyResults({ resultIndex: 0, results: [result('I am speaking', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(empty, interim), true);
  const final = accumulator.applyResults({ resultIndex: 0, results: [result('I am speaking', true)] });
  assert.equal(hasMeaningfulRecognitionProgress(interim, final), true);
  assert.match(hook, /hasMeaningfulRecognitionProgress\(session\.lastSpeechProgress, transcript\)\) \{\s*session\.retryCount = 0;\s*session\.lastSpeechProgress = transcript/);
});

test('speech between restarts can outlast three total recognition ends', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  let lastProgress = empty;
  let consecutiveFailures = 0;
  for (let turn = 1; turn <= 5; turn += 1) {
    accumulator.beginRecognitionAttempt();
    const transcript = accumulator.applyResults({ resultIndex: 0, results: [result(`phrase ${turn}`, true)] });
    assert.equal(hasMeaningfulRecognitionProgress(lastProgress, transcript), true);
    consecutiveFailures = 0;
    lastProgress = transcript;
    consecutiveFailures += 1;
    assert.equal(canRetryRecognition(consecutiveFailures, true, false), true);
  }
});

test('empty, whitespace, and repeated transcript events do not reset the streak', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.beginRecognitionAttempt();
  const whitespace = accumulator.applyResults({ resultIndex: 0, results: [result('   ', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(empty, whitespace), false);
  const interim = accumulator.applyResults({ resultIndex: 0, results: [result('hello', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(empty, interim), true);
  assert.equal(hasMeaningfulRecognitionProgress(interim, interim), false);
  accumulator.beginRecognitionAttempt();
  const repeated = accumulator.applyResults({ resultIndex: 0, results: [result('hello', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(interim, repeated), false);
  assert.doesNotMatch(hook.slice(hook.indexOf('recognition.onstart ='), hook.indexOf('recognition.onresult =')), /retryCount = 0/);
});

test('explicit stop, fatal errors, and active TTS never schedule an unsafe restart', () => {
  assert.equal(canRetryRecognition(1, false, false), false);
  assert.equal(canRetryRecognition(1, true, true), false);
  assert.match(hook, /const stopListening = useCallback\(\(\) => \{[\s\S]*?listeningRef\.current = false;[\s\S]*?recognition\.stop\(\)/);
  assert.match(hook, /recognition\.onend = \(\) => \{[\s\S]*?if \(listeningRef\.current && !session\.fatalError\)[\s\S]*?void deliverTranscript\(\)/);
  assert.match(hook, /const finishRecognitionFailure = \(session: RecognitionSession, message: string\) => \{[\s\S]*?session\.fatalError = true;[\s\S]*?void deliverTranscript\(\)/);
  assert.match(hook, /Boolean\(window\.speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending\)/);
});

test('recoverable restarts leave MediaRecorder and Enrollment listening UI active', () => {
  const restart = hook.slice(hook.indexOf('const scheduleRestart ='), hook.indexOf('const startRecognition ='));
  assert.doesNotMatch(restart, /stopRecording\(|cancelRecording\(|setIsListening\(false\)|releaseMicrophone\(/);
  assert.match(hook, /if \(listeningRef\.current && !session\.fatalError\) \{\s*scheduleRestart\(session, 250/);
  assert.match(dashboard, /\} = useSpeechInput\(\)/);
  assert.match(dashboard, /\{\s*resetRestartStreakOnSpeechProgress: current\.type === 'upcoming',\s*onTiming:/);
  assert.match(hook, /resetRestartStreakOnSpeechProgress: startOptions\?\.resetRestartStreakOnSpeechProgress === true/);
  assert.match(dashboard, /isListening \? 'Recording\.\.\.'/);
  assert.match(hook, /maxSizeBytes: isSpeechOnlyFallback\(offlineAudio\) \? 13 \* 1024 \* 1024/);
  assert.match(recorder, /MAX_OFFLINE_RECORDING_DURATION_MS = 5 \* 60 \* 1000/);
  assert.match(hook, /onAutoStopped: isSpeechOnlyFallback\(offlineAudio\) \? stopListening : undefined/);
});

test('Drill cumulative mode leaves other hook callers, finalization, and fallback intact', () => {
  assert.match(preTest, /\} = useSpeechInput\(\)/);
  assert.match(drills, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
  assert.match(postTest, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
  assert.match(hook, /RECOGNITION_FINALIZATION_TIMEOUT_MS = 3000/);
  assert.match(hook, /session\.accumulator\.claimCanonicalTranscript\(\)/);
  assert.match(hook, /fallbackTranscript = normalizeSpeechWhitespace\(await session\.offlineAudio\.transcribeCapture\(capture\)/);
  assert.match(hook, /session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
});
