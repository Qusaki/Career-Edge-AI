import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIVE_LISTENING_SPEECH_LANGUAGE,
  ACTIVE_LISTENING_SPEECH_PITCH,
  ACTIVE_LISTENING_SPEECH_RATE,
  ACTIVE_LISTENING_SPEECH_VOLUME,
  selectActiveListeningVoice,
} from '../src/utils/activeListeningVoice';

const voice = (name: string, lang: string, localService: boolean): SpeechSynthesisVoice => ({
  name, lang, localService, voiceURI: `${name}:${lang}`, default: false,
});

test('Active Listening uses its own conversational settings without changing shared TTS defaults', () => {
  assert.equal(ACTIVE_LISTENING_SPEECH_RATE, 0.95);
  assert.equal(ACTIVE_LISTENING_SPEECH_PITCH, 1.02);
  assert.equal(ACTIVE_LISTENING_SPEECH_VOLUME, 1);
  assert.equal(ACTIVE_LISTENING_SPEECH_LANGUAGE, 'en-US');

  const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/utils/speech.ts', import.meta.url), 'utf8');
  assert.match(preTest, /rate: ACTIVE_LISTENING_SPEECH_RATE,[\s\S]*?pitch: ACTIVE_LISTENING_SPEECH_PITCH,[\s\S]*?volume: ACTIVE_LISTENING_SPEECH_VOLUME,[\s\S]*?language: ACTIVE_LISTENING_SPEECH_LANGUAGE,[\s\S]*?selectVoice: selectActiveListeningVoice/);
  assert.match(preTest, /void speakBrowserText\(text, \{/);
  assert.match(preTest, /speakText\(completedQuestion, !messagesRef\.current\.some\(message => message\.sender === 'user'\)\)/);
  assert.match(preTest, /message\.sender === 'user' \|\| index > 0/);
  assert.match(shared, /CLEAR_AI_SPEECH_RATE = 0\.82/);
  assert.match(shared, /CLEAR_AI_SPEECH_PITCH = 1/);
  for (const component of ['DrillsPage.tsx', 'PostTestPage.tsx', 'Dashboard.tsx']) {
    const source = readFileSync(new URL(`../src/components/${component}`, import.meta.url), 'utf8');
    assert.match(source, /rate: CLEAR_AI_SPEECH_RATE/);
    assert.doesNotMatch(source, /activeListeningVoice|selectActiveListeningVoice/);
  }
});

test('local natural, enhanced, or premium English voices outrank other local voices', () => {
  const plain = voice('Generic US', 'en-US', true);
  const family = voice('Google US English', 'en-US', true);
  const natural = voice('Natural Voice', 'en-GB', true);
  const remoteNatural = voice('Premium Remote', 'en-US', false);
  assert.equal(selectActiveListeningVoice([plain, family, remoteNatural, natural]), natural);
  assert.equal(selectActiveListeningVoice([natural, remoteNatural, family, plain]), natural);
  assert.equal(selectActiveListeningVoice([voice('Enhanced US', 'en-US', true), natural])?.name, 'Enhanced US');
});

test('local family, en-US, other English, then browser default remain safe fallbacks', () => {
  const family = voice('Microsoft Desktop', 'en-GB', true);
  const us = voice('Generic US', 'en-US', true);
  const english = voice('Generic UK', 'en-GB', true);
  const remote = voice('Natural Remote', 'en-US', false);
  const nonEnglish = voice('Premium French', 'fr-FR', true);
  assert.equal(selectActiveListeningVoice([us, family]), family);
  assert.equal(selectActiveListeningVoice([english, us]), us);
  assert.equal(selectActiveListeningVoice([english, remote]), english);
  assert.equal(selectActiveListeningVoice([remote, nonEnglish]), undefined);
  assert.equal(selectActiveListeningVoice([]), undefined);
});
