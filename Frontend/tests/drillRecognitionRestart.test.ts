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

const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const enrollment = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
const empty: SpeechTranscriptState = { finalTranscript: '', interimTranscript: '', liveTranscript: '' };
const result = (text: string, isFinal: boolean): SpeechRecognitionResultLike =>
  Object.assign([{ transcript: text }], { isFinal });

test('normal Drills and Salary Negotiation opt into the existing progress-reset policy', () => {
  assert.match(drills, /const DRILL_RECOGNITION_START_OPTIONS = \{ resetRestartStreakOnSpeechProgress: true \}/);
  assert.match(drills, /startListening\(commitDrillResponse,[\s\S]*?transcribeCapture: capture => processOnlineAudio\(capture, commitDrillResponse\) \},\s*undefined, DRILL_RECOGNITION_START_OPTIONS\)/);
  assert.match(drills, /startListening\(transcript => void sendNegotiationReply\(transcript\),[\s\S]*?transcribeCapture: capture => processOnlineAudio\(capture, sendNegotiationReply\) \},\s*undefined, DRILL_RECOGNITION_START_OPTIONS\)/);
  assert.equal(drills.match(/undefined, DRILL_RECOGNITION_START_OPTIONS\)/g)?.length, 2);
  assert.match(hook, /resetRestartStreakOnSpeechProgress: startOptions\?\.resetRestartStreakOnSpeechProgress === true/);
});

test('meaningful interim and final speech each reset the restart streak beyond three total ends', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  let lastProgress = empty;
  let consecutiveFailures = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    accumulator.beginRecognitionAttempt();
    const interim = accumulator.applyResults({ resultIndex: 0, results: [result(`phrase ${attempt}`, false)] });
    assert.equal(hasMeaningfulRecognitionProgress(lastProgress, interim), true);
    consecutiveFailures = 0;
    lastProgress = interim;

    const final = accumulator.applyResults({ resultIndex: 0, results: [result(`phrase ${attempt}`, true)] });
    assert.equal(hasMeaningfulRecognitionProgress(lastProgress, final), true);
    consecutiveFailures = 0;
    lastProgress = final;

    consecutiveFailures += 1; // Unexpected onend after real speech.
    assert.equal(canRetryRecognition(consecutiveFailures, true, false), true);
  }
  assert.match(hook, /hasMeaningfulRecognitionProgress\(session\.lastSpeechProgress, transcript\)\) \{\s*session\.retryCount = 0/);
});

test('empty, whitespace, and repeated output cannot reset four consecutive failures', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.beginRecognitionAttempt();
  const whitespace = accumulator.applyResults({ resultIndex: 0, results: [result('   ', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(empty, whitespace), false);
  const interim = accumulator.applyResults({ resultIndex: 0, results: [result('hello', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(empty, interim), true);
  assert.equal(hasMeaningfulRecognitionProgress(interim, interim), false);
  const repeated = accumulator.applyResults({ resultIndex: 0, results: [result('hello', false)] });
  assert.equal(hasMeaningfulRecognitionProgress(interim, repeated), false);
  for (let failure = 1; failure <= MAX_RECOGNITION_RESTARTS; failure += 1) {
    assert.equal(canRetryRecognition(failure, true, false), true);
  }
  assert.equal(canRetryRecognition(MAX_RECOGNITION_RESTARTS + 1, true, false), false);
  assert.match(hook, /recognition\.onend = \(\) => \{[\s\S]*?scheduleRestart\(session, 250/);
});

test('manual stop, delayed final, recorder, fallback, and JAM timeout retain their existing paths', () => {
  assert.equal(canRetryRecognition(1, false, false), false);
  assert.match(hook, /RECOGNITION_FINALIZATION_TIMEOUT_MS = 3000/);
  assert.match(hook, /const stopListening = useCallback\(\(\) => \{[\s\S]*?listeningRef\.current = false;[\s\S]*?recognition\.stop\(\)/);
  const restart = hook.slice(hook.indexOf('const scheduleRestart ='), hook.indexOf('const startRecognition ='));
  assert.doesNotMatch(restart, /stopRecording\(|cancelRecording\(|releaseMicrophone\(|setIsListening\(false\)/);
  assert.match(hook, /maxSizeBytes: isSpeechOnlyFallback\(offlineAudio\) \? 13 \* 1024 \* 1024/);
  assert.match(hook, /fallbackTranscript = normalizeSpeechWhitespace\(await session\.offlineAudio\.transcribeCapture\(capture\)/);
  assert.match(drills, /if \(next\.phase === 'expired'\) \{[\s\S]*?stopListening\(\)/);
});

test('other speech callers retain their options and Drill canonical answer rules remain unchanged', () => {
  assert.match(enrollment, /resetRestartStreakOnSpeechProgress: current\.type === 'upcoming'/);
  assert.match(preTest, /\} = useSpeechInput\(\)/);
  assert.match(postTest, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
  assert.match(drills, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
  assert.match(hook, /session\.accumulator\.claimCanonicalTranscript\(\)/);
  assert.match(hook, /session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
});
