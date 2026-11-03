import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { getDrillTimerConfig } from '../src/utils/drillTimer';

import {
  CAREER_EDGE_SPEECH_LANGUAGE,
  CAREER_EDGE_SPEECH_PITCH,
  CAREER_EDGE_SPEECH_RATE,
  CAREER_EDGE_SPEECH_VOLUME,
  selectCareerEdgeVoice,
} from '../src/utils/careerEdgeVoice';

const voice = (name: string, lang: string, localService: boolean): SpeechSynthesisVoice => ({
  name, lang, localService, voiceURI: `${name}:${lang}`, default: false,
});

test('Active Listening and Drills use one natural profile without changing other TTS defaults', () => {
  assert.equal(CAREER_EDGE_SPEECH_RATE, 0.95);
  assert.equal(CAREER_EDGE_SPEECH_PITCH, 1.02);
  assert.equal(CAREER_EDGE_SPEECH_VOLUME, 1);
  assert.equal(CAREER_EDGE_SPEECH_LANGUAGE, 'en-US');

  const preTest = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const drills = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/utils/speech.ts', import.meta.url), 'utf8');
  const profile = /rate: CAREER_EDGE_SPEECH_RATE,[\s\S]*?pitch: CAREER_EDGE_SPEECH_PITCH,[\s\S]*?volume: CAREER_EDGE_SPEECH_VOLUME,[\s\S]*?language: CAREER_EDGE_SPEECH_LANGUAGE,[\s\S]*?selectVoice: selectCareerEdgeVoice/;
  assert.match(preTest, profile);
  assert.match(drills, profile);
  assert.match(preTest, /void speakBrowserText\(text, \{/);
  assert.match(drills, /void speakBrowserText\(text, \{/);
  assert.match(preTest, /speakText\(completedQuestion, !messagesRef\.current\.some\(message => message\.sender === 'user'\)\)/);
  assert.match(preTest, /message\.sender === 'user' \|\| index > 0/);
  assert.match(shared, /CLEAR_AI_SPEECH_RATE = 0\.82/);
  assert.match(shared, /CLEAR_AI_SPEECH_PITCH = 1/);
  for (const component of ['PostTestPage.tsx', 'Dashboard.tsx']) {
    const source = readFileSync(new URL(`../src/components/${component}`, import.meta.url), 'utf8');
    assert.match(source, /rate: CLEAR_AI_SPEECH_RATE/);
    assert.doesNotMatch(source, /careerEdgeVoice|selectCareerEdgeVoice/);
  }
  assert.match(drills, /speakText\(drill\.isNegotiation \? openingOffer : formattedPrompt\)/);
  assert.match(drills, /speakText\(NEGOTIATION_OPENING_PROMPT\)/);
  assert.match(drills, /speakText\(data\.response\)/);
  assert.deepEqual(getDrillTimerConfig('jam'), { durationSeconds: 30 });
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /const selectPreferredFemaleVoice = \(voices: SpeechSynthesisVoice\[], lang: string\)/);
  assert.match(dashboard, /selectVoice: selectPreferredFemaleVoice/);
  assert.equal(existsSync(new URL('../src/utils/activeListeningVoice.ts', import.meta.url)), false);
});

test('local natural, enhanced, or premium English voices outrank other local voices', () => {
  const plain = voice('Generic US', 'en-US', true);
  const family = voice('Google US English', 'en-US', true);
  const natural = voice('Natural Voice', 'en-GB', true);
  const remoteNatural = voice('Premium Remote', 'en-US', false);
  assert.equal(selectCareerEdgeVoice([plain, family, remoteNatural, natural]), natural);
  assert.equal(selectCareerEdgeVoice([natural, remoteNatural, family, plain]), natural);
  assert.equal(selectCareerEdgeVoice([voice('Enhanced US', 'en-US', true), natural])?.name, 'Enhanced US');
});

test('local family, en-US, other English, then browser default remain safe fallbacks', () => {
  const family = voice('Microsoft Desktop', 'en-GB', true);
  const us = voice('Generic US', 'en-US', true);
  const english = voice('Generic UK', 'en-GB', true);
  const remote = voice('Natural Remote', 'en-US', false);
  const nonEnglish = voice('Premium French', 'fr-FR', true);
  assert.equal(selectCareerEdgeVoice([us, family]), family);
  assert.equal(selectCareerEdgeVoice([english, us]), us);
  assert.equal(selectCareerEdgeVoice([english, remote]), english);
  assert.equal(selectCareerEdgeVoice([remote, nonEnglish]), undefined);
  assert.equal(selectCareerEdgeVoice([]), undefined);
});
