import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SpeechTranscriptAccumulator, type SpeechRecognitionResultLike } from '../src/hooks/useSpeechInput';

const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const enrollment = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');

const result = (text: string, isFinal: boolean): SpeechRecognitionResultLike =>
  Object.assign([{ transcript: text }], { isFinal });

test('Drill cumulative finals extend the committed prefix within one recognition attempt', () => {
  const transcript = new SpeechTranscriptAccumulator(true);
  transcript.beginRecognitionAttempt();
  transcript.applyResults({ resultIndex: 0, results: [result('hello', true)] });
  const state = transcript.applyResults({ resultIndex: 1, results: [result('hello', true), result('hello my name', true)] });
  assert.equal(state.finalTranscript, 'hello my name');
  assert.equal(transcript.claimCanonicalTranscript(), 'hello my name');
});

test('Drill cumulative finals revise across a recognizer restart, while incremental finals append', () => {
  const cumulative = new SpeechTranscriptAccumulator(true);
  cumulative.beginRecognitionAttempt();
  cumulative.applyResults({ resultIndex: 0, results: [result('hello', true)] });
  cumulative.beginRecognitionAttempt();
  assert.equal(cumulative.applyResults({ resultIndex: 0, results: [result('hello my name', true)] }).finalTranscript, 'hello my name');

  const incremental = new SpeechTranscriptAccumulator(true);
  incremental.beginRecognitionAttempt();
  incremental.applyResults({ resultIndex: 0, results: [result('hello', true)] });
  incremental.beginRecognitionAttempt();
  assert.equal(incremental.applyResults({ resultIndex: 0, results: [result('my name', true)] }).finalTranscript, 'hello my name');
});

test('legitimate repetitions and correction-style speech are not stripped', () => {
  const withinPhrase = new SpeechTranscriptAccumulator(true);
  withinPhrase.applyResults({ resultIndex: 0, results: [result('I really really want this role. No no, I mean the next role.', true)] });
  assert.equal(withinPhrase.claimCanonicalTranscript(), 'I really really want this role. No no, I mean the next role.');

  const acrossFragments = new SpeechTranscriptAccumulator(true);
  acrossFragments.applyResults({ resultIndex: 0, results: [result('I really', true)] });
  assert.equal(acrossFragments.applyResults({ resultIndex: 1, results: [result('I really', true), result('really want this role', true)] }).finalTranscript,
    'I really really want this role');
});

test('interim revisions stay display-only and final speech remains canonical', () => {
  const transcript = new SpeechTranscriptAccumulator(true);
  transcript.beginRecognitionAttempt();
  assert.equal(transcript.applyResults({ resultIndex: 0, results: [result('hello my', false)] }).liveTranscript, 'hello my');
  assert.equal(transcript.applyResults({ resultIndex: 0, results: [result('hello my name', false)] }).finalTranscript, '');
  assert.equal(transcript.applyResults({ resultIndex: 0, results: [result('hello my name', true)] }).finalTranscript, 'hello my name');
  assert.equal(transcript.claimCanonicalTranscript(), 'hello my name');
  assert.equal(transcript.claimCanonicalTranscript(), null);
});

test('normal and negotiation Drills share the opted-in hook and retain restart and fallback authority', () => {
  assert.match(drills, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
  assert.match(drills, /startListening\(commitDrillResponse,[\s\S]*?DRILL_RECOGNITION_START_OPTIONS\)/);
  assert.match(drills, /startListening\(transcript => void sendNegotiationReply\(transcript\),[\s\S]*?DRILL_RECOGNITION_START_OPTIONS\)/);
  assert.equal(drills.match(/undefined, DRILL_RECOGNITION_START_OPTIONS\)/g)?.length, 2);
  assert.match(hook, /session\.accumulator\.claimCanonicalTranscript\(\)/);
  assert.match(hook, /else if \(!canonicalTranscript\) \{[\s\S]*?transcribeCapture\(capture\)/);
  assert.match(hook, /RECOGNITION_FINALIZATION_TIMEOUT_MS = 3000/);
  assert.match(hook, /listeningRef\.current = false;[\s\S]*?recognition\.stop\(\)/);
  assert.match(enrollment, /\} = useSpeechInput\(\)/);
  assert.match(preTest, /\} = useSpeechInput\(\)/);
  assert.match(postTest, /\} = useSpeechInput\(\{ cumulativeResultProtection: true \}\)/);
});
