import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SpeechTranscriptAccumulator, type SpeechRecognitionResultLike } from '../src/hooks/useSpeechInput';

const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');

const result = (transcript: string, isFinal: boolean): SpeechRecognitionResultLike =>
  Object.assign([{ transcript }], { isFinal });

test('Who Am I displays live speech in its primary response area before stop', () => {
  assert.match(preTest, /min-h-36 rounded-lg[^\n]*aria-live="polite"[\s\S]*?isListening \|\| isFinalizing \? mergeSpeechFragments\(introTranscript, liveTranscript\)/);
  assert.match(preTest, /hasUnfinalizedTranscript && !isListening && !isFinalizing/);
});

test('Active Listening displays live speech in the visible message area without committing a message', () => {
  assert.match(preTest, /max-h-52 overflow-y-auto[^\n]*\n\s*\{\(isListening \|\| isFinalizing\) && liveTranscript && \(/);
  assert.match(preTest, /aria-live="polite"[\s\S]*?\{liveTranscript\}/);
  assert.match(preTest, /startListening\(transcript => void sendReply\(transcript\)/);
  assert.doesNotMatch(preTest, /sendReply\(liveTranscript\)|setMessages\([^\n]*liveTranscript/);
});

test('Easy Drills display live speech in their primary response area before stop', () => {
  assert.match(drills, /aria-live=\{activeSession\.drill_level === 'easy' \? 'polite' : undefined\}/);
  assert.match(drills, /activeSession\.drill_level === 'easy' && \(isListening \|\| isFinalizing\)[\s\S]*?mergeSpeechFragments\(spokenResponse, liveTranscript\)/);
  assert.match(drills, /hasUnfinalizedTranscript && !isListening && !isFinalizing/);
});

test('Medium Drills retain their existing live transcript panel and final-only answer path', () => {
  assert.match(drills, /activeSession\.drill_level !== 'easy' && \(isListening \|\| isFinalizing\)/);
  assert.match(drills, /\{liveTranscript \|\| <span className="text-muted">Start speaking when you are ready\.<\/span>\}/);
  assert.match(drills, /startListening\(commitDrillResponse/);
  assert.doesNotMatch(drills, /commitDrillResponse\(liveTranscript\)|spokenResponse:\s*liveTranscript/);
});

test('interim revisions replace earlier words and remain display-only', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  for (const phrase of ['My', 'My name', 'My name is', 'My name is John']) {
    const state = accumulator.applyResults({ resultIndex: 0, results: [result(phrase, false)] });
    assert.equal(state.liveTranscript, phrase);
    assert.equal(state.finalTranscript, '');
  }
  assert.equal(accumulator.claimCanonicalTranscript(), '');
});

test('final speech replaces interim, commits once, and preserves genuine repetition', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults({ resultIndex: 0, results: [result('very', false)] });
  const final = accumulator.applyResults({ resultIndex: 0, results: [result('very very important', true)] });
  assert.equal(final.liveTranscript, 'very very important');
  assert.equal(final.finalTranscript, 'very very important');
  assert.equal(accumulator.claimCanonicalTranscript(), 'very very important');
  assert.equal(accumulator.claimCanonicalTranscript(), null);
});

test('stop can receive a late final and submit that final only once', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults({ resultIndex: 0, results: [result('unfinished', false)] });
  accumulator.applyResults({ resultIndex: 0, results: [result('finished answer', true)] });
  assert.equal(accumulator.snapshot().liveTranscript, 'finished answer');
  assert.equal(accumulator.claimCanonicalTranscript(), 'finished answer');
  assert.equal(accumulator.claimCanonicalTranscript(), null);
  assert.match(hook, /recognition\.stop\(\)[\s\S]*?RECOGNITION_FINALIZATION_TIMEOUT_MS/);
});

test('shared recognition result index, stale-instance guard, and bounded retry stay intact', () => {
  assert.match(hook, /event\.resultIndex/);
  assert.match(hook, /recognition\.onresult = event => \{\s*if \(session\.cancelled \|\| recognitionRef\.current !== recognition\) return/);
  assert.match(hook, /MAX_RECOGNITION_RESTARTS = 3/);
  assert.match(hook, /session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
  assert.doesNotMatch(hook, /session\.onTranscript\(.*interimTranscript/);
});
