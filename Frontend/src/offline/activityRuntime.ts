import type { ConversationTurn } from '../db';

export const POST_TEST_ANSWER_LIMIT = 5;

export interface PostTestAnswerBoundary {
  answerCount: number;
  canAcceptAnswer: boolean;
  canComplete: boolean;
  hasTooManyAnswers: boolean;
}

export interface PostTestUserAnswer {
  conversationLog: ConversationTurn[];
  answerCount: number;
}

export interface PostTestOfflineTurn {
  conversationLog: ConversationTurn[];
  answerCount: number;
  nextQuestion: string;
  currentQuestion: string;
}

export const getPostTestAnswerBoundary = (
  conversationLog: readonly ConversationTurn[],
): PostTestAnswerBoundary => {
  const answerCount = conversationLog.filter(message => message.sender === 'user').length;
  return {
    answerCount,
    canAcceptAnswer: answerCount < POST_TEST_ANSWER_LIMIT,
    canComplete: answerCount === POST_TEST_ANSWER_LIMIT,
    hasTooManyAnswers: answerCount > POST_TEST_ANSWER_LIMIT,
  };
};

export const appendPostTestUserAnswer = (
  conversationLog: readonly ConversationTurn[],
  answer: string,
): PostTestUserAnswer => {
  const text = answer.trim();
  if (!text) throw new Error('A Post-Test answer is required.');
  const boundary = getPostTestAnswerBoundary(conversationLog);
  if (!boundary.canAcceptAnswer) {
    throw new Error('All five Post-Test answers have already been recorded.');
  }
  return {
    conversationLog: [...conversationLog, { sender: 'user', text }],
    answerCount: boundary.answerCount + 1,
  };
};

export const requireExactPostTestAnswerCount = (
  conversationLog: readonly ConversationTurn[],
): PostTestAnswerBoundary => {
  const boundary = getPostTestAnswerBoundary(conversationLog);
  if (boundary.answerCount < POST_TEST_ANSWER_LIMIT) {
    throw new Error('Complete all five Post-Test questions before finishing this session.');
  }
  if (boundary.hasTooManyAnswers) {
    throw new Error('This saved Post-Test contains more than five answers. It was preserved and requires manual recovery.');
  }
  return boundary;
};

export const getPostTestQuestionForProgress = (
  questions: readonly string[],
  answerCount: number,
): string => questions[Math.min(answerCount, POST_TEST_ANSWER_LIMIT - 1)] || '';

export const appendOfflinePostTestAnswer = (
  conversationLog: ConversationTurn[],
  answer: string,
  questions: readonly string[],
): PostTestOfflineTurn => {
  const accepted = appendPostTestUserAnswer(conversationLog, answer);
  const withAnswer = accepted.conversationLog;
  const answerCount = accepted.answerCount;
  const nextQuestion = answerCount < questions.length ? questions[answerCount] : '';
  return {
    conversationLog: nextQuestion
      ? [...withAnswer, { sender: 'ai', text: nextQuestion }]
      : withAnswer,
    answerCount,
    nextQuestion,
    currentQuestion: nextQuestion || questions[Math.min(answerCount - 1, POST_TEST_ANSWER_LIMIT - 1)] || '',
  };
};
