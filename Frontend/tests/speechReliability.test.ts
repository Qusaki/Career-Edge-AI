import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRetryRecognition,
  getMicrophoneFailureMessage,
  getSpeechSupportMessage,
  MAX_RECOGNITION_RESTARTS,
  selectSpeechRecognition,
  SpeechTranscriptAccumulator,
  type SpeechRecognitionResultLike,
} from '../src/hooks/useSpeechInput';

const hookSource = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const preTestSource = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const postTestSource = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
const drillsSource = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

const capabilities = { browser: true, secureContext: true, microphone: true, recognition: true };
const result = (text: string, isFinal: boolean): SpeechRecognitionResultLike => Object.assign(
  [{ transcript: text }], { isFinal },
);

test('secure microphone and recognition capabilities are accepted; insecure and missing hardware are distinct', () => {
  assert.equal(getSpeechSupportMessage(capabilities), null);
  assert.match(getSpeechSupportMessage({ ...capabilities, secureContext: false }) ?? '', /HTTPS or localhost/);
  assert.match(getSpeechSupportMessage({ ...capabilities, microphone: false }) ?? '', /cannot access the microphone/);
  assert.match(getSpeechSupportMessage({ ...capabilities, recognition: false }) ?? '', /not supported/);
});

test('standard and webkit recognizers are selected without user-agent detection', () => {
  class Recognition {}
  const constructor = Recognition as unknown as NonNullable<Window['SpeechRecognition']>;
  assert.equal(selectSpeechRecognition({ SpeechRecognition: constructor }), constructor);
  assert.equal(selectSpeechRecognition({ webkitSpeechRecognition: constructor }), constructor);
  assert.equal(selectSpeechRecognition({}), null);
});

test('permission dismissal, denial, and missing microphone report specific messages', () => {
  const denied = new DOMException('denied', 'NotAllowedError');
  assert.match(getMicrophoneFailureMessage(denied, 'prompt'), /dismissed/);
  assert.match(getMicrophoneFailureMessage(denied, 'denied'), /blocked/);
  assert.match(getMicrophoneFailureMessage(new DOMException('missing', 'NotFoundError')), /No microphone/);
  assert.match(getMicrophoneFailureMessage(new DOMException('busy', 'NotReadableError')), /busy or unavailable/);
});

test('unexpected recognition end can only restart while listening, without TTS overlap, and at most three times', () => {
  assert.equal(canRetryRecognition(1, true, false), true);
  assert.equal(canRetryRecognition(MAX_RECOGNITION_RESTARTS, true, false), true);
  assert.equal(canRetryRecognition(MAX_RECOGNITION_RESTARTS + 1, true, false), false);
  assert.equal(canRetryRecognition(1, false, false), false);
  assert.equal(canRetryRecognition(1, true, true), false);
  assert.match(hookSource, /RECOGNITION_START_TIMEOUT_MS/);
  assert.match(hookSource, /RECOGNITION_FINALIZATION_TIMEOUT_MS = 3000/);
});

test('a late final result remains canonical while interim-only speech cannot silently advance', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults({ resultIndex: 0, results: [result('maybe', false)] });
  assert.equal(accumulator.claimCanonicalTranscript(), '');
  accumulator.resetWindow();
  accumulator.applyResults({ resultIndex: 0, results: [result('final answer', true)] });
  assert.equal(accumulator.claimCanonicalTranscript(), 'final answer');
  assert.equal(accumulator.claimCanonicalTranscript(), null);
});

test('No speech detected is reserved for a started recognition session with no final or failure', () => {
  assert.match(hookSource, /else if \(session\.failureMessage\)/);
  assert.match(hookSource, /else if \(!session\.recognitionReadyEver\)/);
  assert.match(hookSource, /else session\.onError\?\.\('No speech was detected/);
  assert.match(hookSource, /Speech recognition is unavailable in this browser/);
});

test('typed fallback remains available online across all six activity flows', () => {
  assert.match(preTestSource, /const saveTypedIntro = async \(\) => \{[\s\S]*?sessionMode !== 'offline'[\s\S]*?method: 'PUT'/);
  assert.match(preTestSource, /Or type your summary if the microphone is unavailable/);
  assert.match(postTestSource, /Or type your answer if the microphone is unavailable/);
  assert.match(drillsSource, /Or type your negotiation reply if the microphone is unavailable/);
  assert.match(drillsSource, /Or type your Drill response if the microphone is unavailable/);
  assert.match(dashboardSource, /Typed answer fallback/);
  assert.match(dashboardSource, /renderOfflineInterviewInput\('thesis'\)/);
  assert.match(dashboardSource, /renderOfflineInterviewInput\('upcoming'\)/);
});

test('speech and TTS exclusion remains enforced at the shared hook and activity handlers', () => {
  assert.match(hookSource, /if \(window\.speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending\)/);
  for (const source of [preTestSource, postTestSource, drillsSource, dashboardSource]) {
    assert.match(source, /speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
  }
});

test('online recognition avoids a second microphone stream while offline recording and Enrollment waveform keep theirs', () => {
  assert.match(hookSource, /if \(offlineAudio\?\.enabled \|\| streamHandlers\?\.onStreamReady\) \{[\s\S]*?navigator\.mediaDevices\.getUserMedia/);
  assert.match(dashboardSource, /onStreamReady: attachInterviewWaveform/);
  assert.match(hookSource, /if \(offlineAudio\?\.enabled\) \{[\s\S]*?createOfflineAudioRecorder/);
});
