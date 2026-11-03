import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIVE_LISTENING_PROMPTS,
  ACTIVE_LISTENING_PROMPTS_V1,
  getActiveListeningPromptForServerSession,
  getQuestionPackVersion,
  PRETEST_ACTIVE_LISTENING_VERSION,
  PRETEST_ACTIVE_LISTENING_V1_VERSION,
  PRETEST_WHO_AM_I_VERSION,
} from '../src/offline/questionPacks';

const backend = readFileSync(new URL('../../backend/routers/pre_test_active_listening.py', import.meta.url), 'utf8');

test('v1 and approved v2 stories match their exact backend canonical packs', () => {
  const oldBlock = backend.match(/ACTIVE_LISTENING_PROMPTS_V1 = \[([\s\S]*?)\n\]/)?.[1];
  const newBlock = backend.match(/ACTIVE_LISTENING_PROMPTS = \[([\s\S]*?)\n\]/)?.[1];
  assert.ok(oldBlock);
  assert.ok(newBlock);
  const oldBackendPrompts = [...oldBlock.matchAll(/"""([\s\S]*?)"""\.strip\(\),/g)].map(match => match[1].trim());
  const newBackendPrompts = [...newBlock.matchAll(/^\s*"([^"]+)",\s*$/gm)].map(match => match[1]);
  assert.deepEqual(ACTIVE_LISTENING_PROMPTS_V1, oldBackendPrompts);
  assert.deepEqual(ACTIVE_LISTENING_PROMPTS, newBackendPrompts);

  const questions = [
    'Can you summarize the main numbers, timing, and decisions?',
    'Can you summarize the schedule, materials, backup room, and final tasks?',
    'Can you summarize the main events, numbers, problems, and solutions?',
  ];
  for (const [index, prompt] of ACTIVE_LISTENING_PROMPTS.entries()) {
    assert.ok(prompt.endsWith(questions[index]));
    assert.equal(getActiveListeningPromptForServerSession(index), prompt);
    assert.ok(prompt.split(/\s+/).length < ACTIVE_LISTENING_PROMPTS_V1[index].split(/\s+/).length);
  }
});

test('new Active Listening checkpoints use v2 while v1 and Who Am I keep their identities', () => {
  assert.equal(PRETEST_ACTIVE_LISTENING_V1_VERSION, 'pretest-active-listening-v1');
  assert.equal(PRETEST_ACTIVE_LISTENING_VERSION, 'pretest-active-listening-v2');
  assert.equal(getQuestionPackVersion('pre_test_active_listening'), PRETEST_ACTIVE_LISTENING_VERSION);
  assert.equal(getActiveListeningPromptForServerSession(0, PRETEST_ACTIVE_LISTENING_V1_VERSION), ACTIVE_LISTENING_PROMPTS_V1[0]);
  assert.equal(getQuestionPackVersion('pre_test_intro'), PRETEST_WHO_AM_I_VERSION);
});
