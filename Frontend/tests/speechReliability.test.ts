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

test('resultIndex and recognition epochs preserve finals without replaying historical results', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  const firstEpoch = accumulator.beginRecognitionAttempt();
  const first = result('very very important', true);
  assert.equal(accumulator.applyResults({ resultIndex: 0, results: [first] }, firstEpoch).finalTranscript, 'very very important');
  assert.equal(accumulator.applyResults({ resultIndex: 0, results: [first] }, firstEpoch).finalTranscript, 'very very important');
  const second = result('final phrase', true);
  assert.equal(accumulator.applyResults({ resultIndex: 1, results: [first, second] }, firstEpoch).finalTranscript, 'very very important final phrase');
  const nextEpoch = accumulator.beginRecognitionAttempt();
  assert.equal(accumulator.applyResults({ resultIndex: 0, results: [first] }, firstEpoch).finalTranscript, 'very very important final phrase');
  assert.equal(accumulator.applyResults({ resultIndex: 0, results: [result('new phrase', true)] }, nextEpoch).finalTranscript, 'very very important final phrase new phrase');
  assert.equal(accumulator.claimCanonicalTranscript(), 'very very important final phrase new phrase');
  assert.match(hookSource, /recognition\.onresult = event => \{\s*if \(session\.cancelled \|\| recognitionRef\.current !== recognition\) return/);
});

test('interim speech remains visible but never becomes a canonical answer', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  const epoch = accumulator.beginRecognitionAttempt();
  assert.equal(accumulator.applyResults({ resultIndex: 0, results: [result('in progress', false)] }, epoch).liveTranscript, 'in progress');
  assert.equal(accumulator.claimCanonicalTranscript(), '');
});

test('No speech detected is reserved for a started recognition session with no final or failure', () => {
  assert.match(hookSource, /else if \(session\.failureMessage\)/);
  assert.match(hookSource, /else if \(!session\.recognitionReadyEver\)/);
  assert.match(hookSource, /else session\.onError\?\.\('No speech was detected/);
  assert.match(hookSource, /Speech recognition is unavailable in this browser/);
});

test('Pre-Test and Drills use speech-only input while other flows retain their scoped typed fallback', () => {
  assert.doesNotMatch(preTestSource, /<textarea|saveTypedIntro|Or type your summary if the microphone is unavailable/);
  assert.doesNotMatch(drillsSource, /<textarea|saveTypedDrillResponse|negotiationReply/);
  assert.doesNotMatch(preTestSource, /Save Typed Answer|onClick=\{\(\) => void sendReply\(\)\}/);
  assert.doesNotMatch(drillsSource, /onClick=\{\(\) => void sendNegotiationReply\(\)\}|onClick=\{\(\) => void saveTypedDrillResponse\(\)\}/);
  assert.match(postTestSource, /Or type your answer if the microphone is unavailable/);
  assert.match(dashboardSource, /Typed answer fallback/);
  assert.match(dashboardSource, /renderOfflineInterviewInput\('thesis'\)/);
  assert.match(dashboardSource, /renderOfflineInterviewInput\('upcoming'\)/);
});

test('Who Am I, Active Listening, normal Drills, and negotiation retain their microphone controls', () => {
  assert.match(preTestSource, /onClick=\{isListening \? stopListening : recordIntro\}/);
  assert.match(preTestSource, /onClick=\{isListening \? stopListening : recordAndSendReply\}/);
  assert.match(drillsSource, /onClick=\{isListening \? stopListening : recordNegotiationReply\}/);
  assert.match(drillsSource, /onClick=\{isListening \? stopDrillResponse : recordDrillResponse\}/);
  assert.equal(preTestSource.match(/isListening \? <Mic className="h-5 w-5" \/> : <MicOff className="h-5 w-5" \/>/g)?.length, 2);
  assert.equal(drillsSource.match(/isListening \? <Mic className="h-5 w-5" \/> : <MicOff className="h-5 w-5" \/>/g)?.length, 2);
});

test('only final recognized or validated transcribed speech reaches answer paths and completion gates', () => {
  assert.match(preTestSource, /const commitIntroTranscript = async \(transcript: string\) => \{[\s\S]*?const nextTranscript = \[introTranscriptRef\.current, transcript\]/);
  assert.match(preTestSource, /startListening\(transcript => void sendReply\(transcript\)/);
  assert.match(drillsSource, /const commitDrillResponse = async \(transcript: string\) => \{[\s\S]*?const nextResponse = \[spokenResponse, transcript\]/);
  assert.match(drillsSource, /startListening\(transcript => void sendNegotiationReply\(transcript\)/);
  assert.match(preTestSource, /!introTranscript\.trim\(\)/);
  assert.match(preTestSource, /!messages\.some\(message => message\.sender === 'user'\)/);
  assert.match(drillsSource, /!spokenResponse\.trim\(\)/);
  assert.match(drillsSource, /!negotiationMessages\.some\(message => message\.sender === 'user'\)/);
  assert.match(drillsSource, /if \(isProcessingAudio \|\| pendingOnlineAudio\) return/);
  assert.match(drillsSource, /if \(!activeSession \|\| isListening \|\| isFinalizing \|\| savingSpokenResponseRef\.current \|\| negotiationLoading\) return/);
});

test('speech errors in speech-only activities do not direct users to removed typing controls', () => {
  for (const source of [preTestSource, drillsSource]) {
    assert.match(source, /const speechOnlyErrorMessage = \(message: string\)/);
    assert.equal(source.match(/message => setError\(speechOnlyErrorMessage\(message\)\)/g)?.length, 2);
  }
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
