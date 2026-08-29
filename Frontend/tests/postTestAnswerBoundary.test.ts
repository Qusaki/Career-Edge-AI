import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConversationTurn } from '../src/db';
import {
  appendOfflinePostTestAnswer,
  appendPostTestUserAnswer,
  getPostTestAnswerBoundary,
  getPostTestQuestionForProgress,
  POST_TEST_ANSWER_LIMIT,
  requireExactPostTestAnswerCount,
} from '../src/offline/activityRuntime';
import { getPostTestQuestions } from '../src/offline/questionPacks';

const questions = getPostTestQuestions('CCIT');

const buildOfflineAnswers = (answerTotal: number): ConversationTurn[] => {
  let conversation: ConversationTurn[] = [{ sender: 'ai', text: questions[0] }];
  for (let answerNumber = 1; answerNumber <= answerTotal; answerNumber += 1) {
    conversation = appendOfflinePostTestAnswer(
      conversation,
      `Offline answer ${answerNumber}`,
      questions,
    ).conversationLog;
  }
  return conversation;
};

const buildOnlineAnswers = (answerTotal: number): ConversationTurn[] => {
  let conversation: ConversationTurn[] = [{ sender: 'ai', text: questions[0] }];
  for (let answerNumber = 1; answerNumber <= answerTotal; answerNumber += 1) {
    conversation = appendPostTestUserAnswer(
      conversation,
      `Online answer ${answerNumber}`,
    ).conversationLog;
  }
  return conversation;
};

test('A: offline answers one through five are accepted', () => {
  const conversation = buildOfflineAnswers(POST_TEST_ANSWER_LIMIT);
  const boundary = getPostTestAnswerBoundary(conversation);
  assert.equal(boundary.answerCount, 5);
  assert.equal(boundary.canAcceptAnswer, false);
  assert.equal(boundary.canComplete, true);
});

test('B: offline answer six is rejected without mutating the five saved answers', () => {
  const conversation = buildOfflineAnswers(POST_TEST_ANSWER_LIMIT);
  const snapshot = structuredClone(conversation);
  assert.throws(
    () => appendOfflinePostTestAnswer(conversation, 'Offline answer six', questions),
    /five Post-Test answers have already been recorded/,
  );
  assert.deepEqual(conversation, snapshot);
  assert.equal(getPostTestAnswerBoundary(conversation).answerCount, 5);
});

test('C and D: completion accepts exactly five and rejects four answers', () => {
  const fiveAnswers = buildOfflineAnswers(5);
  assert.equal(requireExactPostTestAnswerCount(fiveAnswers).canComplete, true);
  assert.throws(
    () => requireExactPostTestAnswerCount(buildOfflineAnswers(4)),
    /Complete all five Post-Test questions/,
  );
});

test('E: a historical record over five remains unchanged and cannot become a valid completion', () => {
  const historical: ConversationTurn[] = Array.from({ length: 6 }, (_, index) => ({
    sender: 'user' as const,
    text: `Historical answer ${index + 1}`,
  }));
  const snapshot = structuredClone(historical);
  assert.throws(
    () => requireExactPostTestAnswerCount(historical),
    /preserved and requires manual recovery/,
  );
  assert.deepEqual(historical, snapshot);
  assert.equal(getPostTestAnswerBoundary(historical).hasTooManyAnswers, true);
});

test('F and G: online answers one through five are accepted and answer six is rejected', () => {
  const conversation = buildOnlineAnswers(5);
  assert.equal(getPostTestAnswerBoundary(conversation).answerCount, 5);
  assert.throws(
    () => appendPostTestUserAnswer(conversation, 'Online answer six'),
    /five Post-Test answers have already been recorded/,
  );
  assert.equal(getPostTestAnswerBoundary(conversation).answerCount, 5);
});

test('H: duplicate finalization after answer five cannot create another answer', () => {
  const afterFive = buildOnlineAnswers(5);
  for (let duplicate = 0; duplicate < 2; duplicate += 1) {
    assert.throws(() => appendPostTestUserAnswer(afterFive, 'Duplicate final transcript'));
  }
  assert.equal(getPostTestAnswerBoundary(afterFive).answerCount, 5);
});

test('I and J: resume at five is completion-ready while resume at four selects question five', () => {
  const completeBoundary = getPostTestAnswerBoundary(buildOfflineAnswers(5));
  assert.equal(completeBoundary.canComplete, true);
  assert.equal(completeBoundary.canAcceptAnswer, false);

  const fourAnswerBoundary = getPostTestAnswerBoundary(buildOfflineAnswers(4));
  assert.equal(fourAnswerBoundary.canAcceptAnswer, true);
  assert.equal(getPostTestQuestionForProgress(questions, fourAnswerBoundary.answerCount), questions[4]);
});

test('K: every canonical department pack still contains exactly five questions', () => {
  for (const department of ['CCIT', 'CTE', 'CBAPA']) {
    assert.equal(getPostTestQuestions(department).length, POST_TEST_ANSWER_LIMIT);
  }
});

test('PostTestPage applies the answer boundary before microphone, checkpoint, completion, and WebSocket actions', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /answerSubmissionInFlightRef\.current/);
  assert.match(source, /if \(!currentBoundary\.canAcceptAnswer\)/);
  assert.match(source, /appendPostTestUserAnswer\(currentMessages, text\)/);
  assert.match(source, /requireExactPostTestAnswerCount\(currentMessages\)/);
  assert.match(source, /!answerBoundary\.canAcceptAnswer/);
  assert.match(source, /wsRef\.current\?\.send\(JSON\.stringify\(\{ text \}\)\)/);
});
