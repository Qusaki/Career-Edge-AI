import type { ConversationTurn } from '../db';

export interface PostTestOfflineTurn {
  conversationLog: ConversationTurn[];
  answerCount: number;
  nextQuestion: string;
  currentQuestion: string;
}

export const appendOfflinePostTestAnswer = (
  conversationLog: ConversationTurn[],
  answer: string,
  questions: readonly string[],
): PostTestOfflineTurn => {
  const text = answer.trim();
  if (!text) throw new Error('A Post-Test answer is required.');
  const withAnswer = [...conversationLog, { sender: 'user' as const, text }];
  const answerCount = withAnswer.filter(message => message.sender === 'user').length;
  const nextQuestion = answerCount < questions.length ? questions[answerCount] : '';
  return {
    conversationLog: nextQuestion
      ? [...withAnswer, { sender: 'ai', text: nextQuestion }]
      : withAnswer,
    answerCount,
    nextQuestion,
    currentQuestion: nextQuestion || questions[Math.min(answerCount - 1, questions.length - 1)] || '',
  };
};
