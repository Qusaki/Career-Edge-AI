import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateActiveListening, evaluateDrill, evaluatePostTest, evaluateWhoAmI } from '../src/offline/localEvaluation';
import { ACTIVE_LISTENING_PROMPTS } from '../src/offline/questionPacks';

test('a meaningful introduction scores above repeated speech', () => {
  const good = evaluateWhoAmI(
    'My name is Juan. I am a computer science student. I enjoy building software and helping classmates. My strength is explaining ideas clearly. I am preparing for interviews because I want a career in technology.',
  );
  const repeated = evaluateWhoAmI('hello my name is Juan '.repeat(15));
  assert.ok(good.localScore > repeated.localScore);
  assert.ok(repeated.localScore <= 5);
});

test('Active Listening uses concrete details from the actual story', () => {
  const story = ACTIVE_LISTENING_PROMPTS[1];
  const complete = 'The student leadership workshop begins at eight thirty in the multimedia hall, with arrival by eight fifteen. Each group brings a laptop, two printed action plans and a flash drive backup. Morning is for problem identification, lunch is from twelve to one, and afternoon is presentation practice. If the projector fails, they move to Room 204 while registration stays by the lobby. Leaders submit the attendance sheet and revised plan to Ms. Reyes.';
  const incomplete = 'The workshop starts at eight thirty.';
  const goodScore = evaluateActiveListening([{ sender: 'ai', text: story }, { sender: 'user', text: complete }]).localScore;
  const poorScore = evaluateActiveListening([{ sender: 'ai', text: story }, { sender: 'user', text: incomplete }]).localScore;
  assert.ok(goodScore > poorScore);
  assert.ok(poorScore <= 10);
});

test('Post-Test requires five distinct substantive answers for top provisional marks', () => {
  const goodAnswers = [
    'I improved my communication skill by explaining difficult ideas to classmates during projects.',
    'I taught a teammate a technical concept using diagrams and checked their understanding afterward.',
    'When a project failed, I isolated the cause, tested options, and documented what I learned.',
    'I would listen to my teammate, explain my evidence respectfully, and agree on a plan.',
    'I want to improve public speaking by practicing weekly and asking for specific feedback.',
  ];
  const good = evaluatePostTest(goodAnswers.map(text => ({ sender: 'user', text })));
  const repeated = evaluatePostTest(Array.from({ length: 5 }, () => ({ sender: 'user' as const, text: 'I can do it.' })));
  assert.equal(good.localScore, 20);
  assert.ok(repeated.localScore <= 10);
});

test('a repeated Drill answer loses quality and task-completion points', () => {
  const good = evaluateDrill('jam', { spokenResponse: Array.from({ length: 60 }, (_, index) => `detail${index}`).join(' '), negotiationMessages: [] });
  const repeated = evaluateDrill('jam', { spokenResponse: 'same phrase again '.repeat(20), negotiationMessages: [] });
  assert.ok(good.localScore > repeated.localScore);
  assert.equal(repeated.evaluation.scoring.criteria.task_completion, 1);
});
