import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateActiveListening, evaluateDrill, evaluatePostTest, evaluateWhoAmI } from '../src/offline/localEvaluation';
import { ACTIVE_LISTENING_PROMPTS, ACTIVE_LISTENING_PROMPTS_V1, ACTIVE_LISTENING_PROMPTS_V2 } from '../src/offline/questionPacks';

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
  const complete = 'The student leadership workshop begins at eight thirty in the multimedia hall. Each group brings one laptop and two copies of its action plan. Because the projector is broken, the workshop moves to Room 204, but registration remains in the lobby. The important change is the new room while the materials and schedule stay the same.';
  const incomplete = 'The workshop starts at eight thirty.';
  const goodScore = evaluateActiveListening([{ sender: 'ai', text: story }, { sender: 'user', text: complete }]).localScore;
  const poorScore = evaluateActiveListening([{ sender: 'ai', text: story }, { sender: 'user', text: incomplete }]).localScore;
  assert.ok(goodScore > poorScore);
  assert.ok(poorScore <= 10);

  const v2Story = ACTIVE_LISTENING_PROMPTS_V2[1];
  const v2Complete = 'The workshop starts at eight thirty in the multimedia hall. Groups arrive by eight fifteen with a laptop, two action-plan copies, and a flash-drive backup. Morning covers problems, afternoon covers presentations, and lunch runs from noon to one. If the projector fails, they move to Room 204 but register at the lobby. Leaders give Ms. Reyes the attendance sheet and revised plan.';
  assert.ok(evaluateActiveListening([{ sender: 'ai', text: v2Story }, { sender: 'user', text: v2Complete }]).localScore
    > evaluateActiveListening([{ sender: 'ai', text: v2Story }, { sender: 'user', text: incomplete }]).localScore);

  const oldStory = ACTIVE_LISTENING_PROMPTS_V1[1];
  const oldComplete = 'The workshop begins at eight thirty in the multimedia hall, with arrival by eight fifteen. Each group brings a laptop, two printed action plans and a flash drive backup. Morning is for problem identification, lunch is from twelve to one, and afternoon is presentation practice. If the projector fails, they move to Room 204 while registration stays by the lobby. Leaders submit the attendance sheet and revised plan to Ms. Reyes.';
  const oldGoodScore = evaluateActiveListening([{ sender: 'ai', text: oldStory }, { sender: 'user', text: oldComplete }]).localScore;
  const oldPoorScore = evaluateActiveListening([{ sender: 'ai', text: oldStory }, { sender: 'user', text: incomplete }]).localScore;
  assert.ok(oldGoodScore > oldPoorScore);
});

test('all V3 stories keep strong provisional summaries above irrelevant or sparse answers', () => {
  const summaries = [
    'Mara and Luis prepared 120 orientation kits for new students. Luis updated campus maps showing the wrong library entrance before packing. Only 80 water bottles arrived, so Mara decided the remaining students would collect theirs tomorrow.',
    'The student leadership workshop begins at eight thirty in the multimedia hall. Each group brings one laptop and two copies of its action plan. Because the projector is broken, the workshop moves to Room 204, but registration stays in the lobby.',
    'Jonah and Aira helped at a community reading event for 72 pupils. They had enough books but only 48 activity sheets, so Jonah made extra copies. Heavy rain delayed the guest reader, and Aira started a vocabulary game while they waited.',
  ];
  for (const [index, story] of ACTIVE_LISTENING_PROMPTS.entries()) {
    const score = (answer: string) => evaluateActiveListening([
      { sender: 'ai', text: story }, { sender: 'user', text: answer },
    ]).localScore;
    assert.ok(score(summaries[index]) > score('Unrelated banana clouds float past the moon every afternoon.'));
    assert.ok(score(summaries[index]) > score('Too short.'));
    assert.ok(score('Too short.') <= 10);
  }
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
