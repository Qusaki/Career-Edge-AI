export interface EnrollmentConversationTurn {
  sender: 'user' | 'ai';
  text: string;
}

export interface RestoredEnrollmentPrompt {
  identity: string;
  text: string;
}

export const selectRestoredEnrollmentPrompt = (
  sessionKey: string,
  turns: EnrollmentConversationTurn[],
  responseCount: number,
  currentQuestion?: string,
): RestoredEnrollmentPrompt | null => {
  if (!sessionKey || responseCount >= 5 || turns.filter(turn => turn.sender === 'user').length !== responseCount) return null;
  const lastTurn = turns.at(-1);
  if (lastTurn?.sender !== 'ai') return null;
  const text = lastTurn.text.trim();
  if (!text || (currentQuestion !== undefined && currentQuestion.trim() !== text)) return null;
  return { identity: `${sessionKey}:ai:${turns.length - 1}`, text };
};
