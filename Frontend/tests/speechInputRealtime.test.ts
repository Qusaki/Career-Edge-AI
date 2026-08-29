import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeSpeechFragments,
  SpeechTranscriptAccumulator,
  type SpeechRecognitionResultEventLike,
  type SpeechRecognitionResultLike,
} from '../src/hooks/useSpeechInput';

const recognitionResult = (transcript: string, isFinal: boolean): SpeechRecognitionResultLike => Object.assign(
  [{ transcript, confidence: 0.75 }],
  { isFinal },
);

const recognitionEvent = (
  resultIndex: number,
  ...results: SpeechRecognitionResultLike[]
): SpeechRecognitionResultEventLike => ({ resultIndex, results });

test('interim-only speech is visible but is not canonical', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  const state = accumulator.applyResults(recognitionEvent(0, recognitionResult('  hello   there ', false)));
  assert.equal(state.finalTranscript, '');
  assert.equal(state.interimTranscript, 'hello there');
  assert.equal(state.liveTranscript, 'hello there');
  assert.equal(accumulator.claimCanonicalTranscript(), '');
});

test('committed final and current interim form one explicitly spaced live transcript', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(0, recognitionResult('hello', true)));
  const state = accumulator.applyResults(recognitionEvent(
    1,
    recognitionResult('hello', true),
    recognitionResult('world', false),
  ));
  assert.deepEqual(state, {
    finalTranscript: 'hello',
    interimTranscript: 'world',
    liveTranscript: 'hello world',
  });
  assert.equal(mergeSpeechFragments('hello', 'world'), 'hello world');
});

test('interim revisions replace the previous hypothesis instead of appending it', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  assert.equal(
    accumulator.applyResults(recognitionEvent(0, recognitionResult('I like', false))).liveTranscript,
    'I like',
  );
  assert.equal(
    accumulator.applyResults(recognitionEvent(0, recognitionResult('I like programming', false))).liveTranscript,
    'I like programming',
  );
});

test('a final segment commits once while the following interim remains revisable', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  const state = accumulator.applyResults(recognitionEvent(
    0,
    recognitionResult('I like', true),
    recognitionResult('programming', false),
  ));
  assert.equal(state.finalTranscript, 'I like');
  assert.equal(state.liveTranscript, 'I like programming');
});

test('multiple final fragments preserve explicit spacing', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  const state = accumulator.applyResults(recognitionEvent(
    0,
    recognitionResult('hello', true),
    recognitionResult('world', true),
  ));
  assert.equal(state.finalTranscript, 'hello world');
});

test('resultIndex prevents an older final result from being committed twice', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(0, recognitionResult('hello', true)));
  const state = accumulator.applyResults(recognitionEvent(
    1,
    recognitionResult('hello', true),
    recognitionResult('world', true),
  ));
  assert.equal(state.finalTranscript, 'hello world');
});

test('a new recording window clears prior final, interim, and delivery state', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(0, recognitionResult('old answer', true)));
  assert.equal(accumulator.claimCanonicalTranscript(), 'old answer');
  accumulator.resetWindow();
  assert.deepEqual(accumulator.snapshot(), {
    finalTranscript: '',
    interimTranscript: '',
    liveTranscript: '',
  });
  assert.equal(accumulator.claimCanonicalTranscript(), '');
});

test('a no-speech recognition restart retains committed text but clears stale interim text', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(
    0,
    recognitionResult('committed', true),
    recognitionResult('stale guess', false),
  ));
  accumulator.beginRecognitionAttempt();
  assert.deepEqual(accumulator.snapshot(), {
    finalTranscript: 'committed',
    interimTranscript: '',
    liveTranscript: 'committed',
  });
});

test('canonical delivery excludes a remaining interim hypothesis', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(
    0,
    recognitionResult('stable words', true),
    recognitionResult('unfinished guess', false),
  ));
  assert.equal(accumulator.claimCanonicalTranscript(), 'stable words');
});

test('duplicate onend-style delivery claims can return the canonical answer only once', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults(recognitionEvent(0, recognitionResult('one answer', true)));
  assert.equal(accumulator.claimCanonicalTranscript(), 'one answer');
  assert.equal(accumulator.claimCanonicalTranscript(), null);
});

test('a mocked recognizer stop can flush a final result before one onend delivery', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  let delivered = '';
  const recognition = {
    onresult: (event: SpeechRecognitionResultEventLike) => accumulator.applyResults(event),
    onend: () => { delivered = accumulator.claimCanonicalTranscript() ?? delivered; },
    stop() {
      this.onresult(recognitionEvent(0, recognitionResult('last phrase', true)));
      this.onend();
      this.onend();
    },
  };
  recognition.stop();
  assert.equal(delivered, 'last phrase');
});
