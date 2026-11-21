import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIVE_LISTENING_PROMPTS,
  ACTIVE_LISTENING_PROMPTS_V1,
  ACTIVE_LISTENING_PROMPTS_V2,
  getActiveListeningPromptForServerSession,
  getQuestionPackVersion,
  PRETEST_ACTIVE_LISTENING_VERSION,
  PRETEST_ACTIVE_LISTENING_V1_VERSION,
  PRETEST_ACTIVE_LISTENING_V2_VERSION,
  PRETEST_WHO_AM_I_VERSION,
} from '../src/offline/questionPacks';

const backend = readFileSync(new URL('../../backend/routers/pre_test_active_listening.py', import.meta.url), 'utf8');

test('V1, V2, and V3 stories match their exact backend canonical packs', () => {
  const oldBlock = backend.match(/ACTIVE_LISTENING_PROMPTS_V1 = \[([\s\S]*?)\n\]/)?.[1];
  const v2Block = backend.match(/ACTIVE_LISTENING_PROMPTS_V2 = \[([\s\S]*?)\n\]/)?.[1];
  const newBlock = backend.match(/ACTIVE_LISTENING_PROMPTS = \[([\s\S]*?)\n\]/)?.[1];
  assert.ok(oldBlock);
  assert.ok(v2Block);
  assert.ok(newBlock);
  const oldBackendPrompts = [...oldBlock.matchAll(/"""([\s\S]*?)"""\.strip\(\),/g)].map(match => match[1].trim());
  const v2BackendPrompts = [...v2Block.matchAll(/^\s*"([^"]+)",\s*$/gm)].map(match => match[1]);
  const newBackendPrompts = [...newBlock.matchAll(/^\s*"([^"]+)",\s*$/gm)].map(match => match[1]);
  assert.deepEqual(ACTIVE_LISTENING_PROMPTS_V1, oldBackendPrompts);
  assert.deepEqual(ACTIVE_LISTENING_PROMPTS_V2, v2BackendPrompts);
  assert.deepEqual(ACTIVE_LISTENING_PROMPTS, newBackendPrompts);

  assert.equal(ACTIVE_LISTENING_PROMPTS.length, 3);
  const requiredFacts = [
    [/orientation kits/, /120/, /80/, /wrong library entrance/, /updates them/],
    [/leadership workshop/, /8:30/, /two copies/, /projector is broken/, /moves to Room 204/],
    [/community reading event/, /72 pupils/, /48 activity sheets/, /rain delays/, /starts a vocabulary game/],
  ];
  for (const [index, prompt] of ACTIVE_LISTENING_PROMPTS.entries()) {
    assert.equal(getActiveListeningPromptForServerSession(index), prompt);
    const words = prompt.split(/\s+/).length;
    assert.ok(words >= 45 && words <= 60);
    assert.equal(prompt.split(/(?<=[.!?])\s+(?=[A-Z])/).length, 4);
    assert.ok(words < ACTIVE_LISTENING_PROMPTS_V2[index].split(/\s+/).length);
    assert.ok(words < ACTIVE_LISTENING_PROMPTS_V1[index].split(/\s+/).length);
    for (const fact of requiredFacts[index]) assert.match(prompt, fact);
    assert.match(prompt, /^.+\. .+\. .+\. Summarize .+\.$/);
  }
});

test('new Active Listening checkpoints use V3 while V1, V2, and Who Am I keep their identities', () => {
  assert.equal(PRETEST_ACTIVE_LISTENING_V1_VERSION, 'pretest-active-listening-v1');
  assert.equal(PRETEST_ACTIVE_LISTENING_V2_VERSION, 'pretest-active-listening-v2');
  assert.equal(PRETEST_ACTIVE_LISTENING_VERSION, 'pretest-active-listening-v3');
  assert.equal(getQuestionPackVersion('pre_test_active_listening'), PRETEST_ACTIVE_LISTENING_VERSION);
  assert.equal(getActiveListeningPromptForServerSession(0, PRETEST_ACTIVE_LISTENING_V1_VERSION), ACTIVE_LISTENING_PROMPTS_V1[0]);
  assert.equal(getActiveListeningPromptForServerSession(0, PRETEST_ACTIVE_LISTENING_V2_VERSION), ACTIVE_LISTENING_PROMPTS_V2[0]);
  assert.equal(getQuestionPackVersion('pre_test_intro'), PRETEST_WHO_AM_I_VERSION);
});
