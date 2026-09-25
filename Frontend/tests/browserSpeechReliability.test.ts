import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cancelBrowserSpeech, speakBrowserText } from '../src/utils/browserSpeech';

type FakeUtterance = SpeechSynthesisUtterance;

const createSpeechHarness = () => {
  const utterances: FakeUtterance[] = [];
  const listeners = new Set<EventListener>();
  const voices: SpeechSynthesisVoice[] = [];
  let cancellations = 0;
  let resumes = 0;
  let paused = false;
  let speakBehavior: (utterance: FakeUtterance, attempt: number) => void = () => {};
  const synthesis = {
    getVoices: () => voices,
    addEventListener: (_type: string, listener: EventListener) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: EventListener) => { listeners.delete(listener); },
    cancel: () => { cancellations += 1; },
    get paused() { return paused; },
    resume: () => { resumes += 1; paused = false; },
    speak: (utterance: FakeUtterance) => {
      utterances.push(utterance);
      speakBehavior(utterance, utterances.length);
    },
  } as unknown as SpeechSynthesis;
  const createUtterance = (text: string) => ({ text, lang: '', rate: 1, pitch: 1, volume: 1 }) as SpeechSynthesisUtterance;
  return {
    synthesis,
    voices,
    utterances,
    get cancellations() { return cancellations; },
    get resumes() { return resumes; },
    setPaused: (value: boolean) => { paused = value; },
    setBehavior: (behavior: typeof speakBehavior) => { speakBehavior = behavior; },
    fireVoicesChanged: () => listeners.forEach(listener => listener(new Event('voiceschanged'))),
    createUtterance,
  };
};

const start = (utterance: FakeUtterance) => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
const end = (utterance: FakeUtterance) => utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
const fail = (utterance: FakeUtterance) => utterance.onerror?.(new Event('error') as SpeechSynthesisErrorEvent);

test('speech starts normally after voiceschanged when voices were initially empty', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior(utterance => { start(utterance); end(utterance); });
  let pending = 0;
  let started = 0;
  let finished = 0;
  const speech = speakBrowserText('Hello', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 50,
    onPending: () => { pending += 1; },
    onStart: () => { started += 1; },
    onFinish: () => { finished += 1; },
  });
  assert.equal(pending, 1);
  assert.equal(harness.utterances.length, 0);
  harness.voices.push({ lang: 'en-US', name: 'Available voice' } as SpeechSynthesisVoice);
  harness.fireVoicesChanged();
  await speech;
  assert.equal(started, 1);
  assert.equal(finished, 1);
  assert.equal(harness.utterances.length, 1);
});

test('empty voices use the default browser voice after a bounded wait', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior(utterance => { start(utterance); end(utterance); });
  await speakBrowserText('Default voice', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 1,
  });
  assert.equal(harness.utterances.length, 1);
  assert.equal(harness.utterances[0].voice, undefined);
});

test('available voices start immediately and a paused synthesis is resumed', async () => {
  const harness = createSpeechHarness();
  harness.voices.push({ lang: 'en-US', name: 'Chrome voice' } as SpeechSynthesisVoice);
  harness.setPaused(true);
  harness.setBehavior(utterance => { start(utterance); end(utterance); });
  assert.equal(await speakBrowserText('Ready', { synthesis: harness.synthesis, createUtterance: harness.createUtterance }), 'ended');
  assert.equal(harness.utterances.length, 1);
  assert.equal(harness.resumes, 1);
});

test('cancel and speak are separated by a browser task', async () => {
  let drainingCancel = false;
  const harness = createSpeechHarness();
  const originalCancel = harness.synthesis.cancel.bind(harness.synthesis);
  harness.synthesis.cancel = () => {
    drainingCancel = true;
    setTimeout(() => { drainingCancel = false; }, 0);
    originalCancel();
  };
  harness.setBehavior(utterance => {
    assert.equal(drainingCancel, false);
    start(utterance);
    end(utterance);
  });
  assert.equal(await speakBrowserText('After cancel', { synthesis: harness.synthesis, createUtterance: harness.createUtterance, voiceWaitMs: 0 }), 'ended');
});

test('an utterance error gets exactly one controlled retry of identical text', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior((utterance, attempt) => {
    if (attempt === 1) fail(utterance);
    else { start(utterance); end(utterance); }
  });
  assert.equal(await speakBrowserText('Same story', { synthesis: harness.synthesis, createUtterance: harness.createUtterance, voiceWaitMs: 0 }), 'ended');
  assert.deepEqual(harness.utterances.map(utterance => utterance.text), ['Same story', 'Same story']);
});

test('an end event without a start event never counts as delivered audio', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior(end);
  assert.equal(await speakBrowserText('Silent story', { synthesis: harness.synthesis, createUtterance: harness.createUtterance, voiceWaitMs: 0 }), 'error');
  assert.equal(harness.utterances.length, 2);
});

test('a valid delayed start beats the watchdog without retrying', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior(utterance => setTimeout(() => { start(utterance); end(utterance); }, 10));
  assert.equal(await speakBrowserText('Delayed', { synthesis: harness.synthesis, createUtterance: harness.createUtterance, voiceWaitMs: 0, startTimeoutMs: 40 }), 'ended');
  assert.equal(harness.utterances.length, 1);
});

test('speech-start timeout cancels stale audio and retries once', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior((utterance, attempt) => {
    if (attempt === 2) { start(utterance); end(utterance); }
  });
  let finished = 0;
  await speakBrowserText('Retry', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 0,
    startTimeoutMs: 5,
    maxDurationMs: 100,
    onFinish: () => { finished += 1; },
  });
  assert.equal(harness.utterances.length, 2);
  assert.ok(harness.cancellations >= 2);
  assert.equal(finished, 1);
});

test('a permanently stuck utterance releases speaking state after one retry', async () => {
  const harness = createSpeechHarness();
  let pending = false;
  await speakBrowserText('Blocked audio', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 0,
    startTimeoutMs: 5,
    maxDurationMs: 100,
    onPending: () => { pending = true; },
    onFinish: () => { pending = false; },
  });
  assert.equal(harness.utterances.length, 2);
  assert.equal(pending, false);
});

test('utterance error releases speaking state without a false successful start', async () => {
  const harness = createSpeechHarness();
  harness.setBehavior(fail);
  let started = 0;
  let finished = 0;
  await speakBrowserText('Error', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 0,
    onStart: () => { started += 1; },
    onFinish: () => { finished += 1; },
  });
  assert.equal(started, 0);
  assert.equal(finished, 1);
});

test('navigation cancellation prevents delayed voice loading from speaking later', async () => {
  const harness = createSpeechHarness();
  let pending = false;
  const speech = speakBrowserText('Stale text', {
    synthesis: harness.synthesis,
    createUtterance: harness.createUtterance,
    voiceWaitMs: 5,
    onPending: () => { pending = true; },
    onFinish: () => { pending = false; },
  });
  cancelBrowserSpeech(harness.synthesis);
  await speech;
  assert.equal(harness.utterances.length, 0);
  assert.equal(pending, false);
});

test('all activity TTS paths keep the AI text independent of browser audio success', () => {
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /setAiResponseText\(prev => prev \+ delta\)/);
  assert.match(preTest, /setMessages\(nextMessages\)/);
  assert.match(postTest, /setMessages\(checkpointMessages\)/);
  assert.match(drills, /setNegotiationMessages\(nextMessages\)/);
  assert.match(preTest, /result === 'ended'[\s\S]*?else if \(result !== 'cancelled'\)[\s\S]*?setSpeechFallbackPrompt\(text\)/);
  assert.match(preTest, /speechPlaybackFailed \? 'Audio playback is unavailable\.' : 'Play the listening story before answering\.'/);
  assert.match(preTest, /onClick=\{\(\) => speakText\(speechFallbackPrompt, !messages\.some\(message => message\.sender === 'user'\)\)\}/);
  assert.match(preTest, /result === 'ended'[\s\S]*?setInitialStoryAudioDelivered\(true\)/);
  assert.match(preTest, /!initialStoryAudioDelivered[\s\S]*?Play the listening story before answering/);
});
