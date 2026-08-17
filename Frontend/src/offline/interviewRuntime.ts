import type { MLCEngine } from '@mlc-ai/web-llm';

import type { AccountOfflineSession, ConversationTurn, OfflineActivityType } from '../db';
import {
  ENROLLMENT_INTERVIEW_VERSION,
  getEnrollmentInterviewQuestions,
  getThesisInterviewQuestions,
  THESIS_INTERVIEW_VERSION,
  type OfflineInterviewQuestion,
} from './questionPacks';

export type OfflineInterviewEngine = 'webllm' | 'fallback';
export type OfflineInterviewKind = Extract<OfflineActivityType, 'upcoming' | 'thesis'>;

export interface OfflineInterviewActivityState {
  offlineEngine: OfflineInterviewEngine;
  department: string;
  questionIds: string[];
  questionOrder: string[];
  thesisAbstractContext?: string;
  thesisAbstractSourceName?: string;
  engineTransitions: Array<{
    from: OfflineInterviewEngine;
    to: OfflineInterviewEngine;
    atResponseCount: number;
    reason: string;
    changedAt: number;
  }>;
}

export interface OfflineInterviewEvaluation {
  rubricVersion: string;
  responseCount: number;
  answeredWordCount: number;
  averageWordsPerResponse: number;
  eyeContact: { score: number | null; samples: number } | null;
  subjectiveScores: null;
}

export const OFFLINE_INTERVIEW_RESPONSE_LIMIT = 5;
export const MAX_THESIS_ABSTRACT_CONTEXT_LENGTH = 5000;
export const ENROLLMENT_OFFLINE_CLOSING =
  'Thank you for completing your Career Edge enrollment interview. Your five responses are saved locally and are ready for validation when synchronization becomes available.';
export const THESIS_OFFLINE_CLOSING =
  'Thank you for completing your Career Edge thesis defense. Your five responses are saved locally and are ready for validation when synchronization becomes available.';

const normalizeDepartment = (department: string) => {
  const normalized = department.trim().toUpperCase();
  return normalized === 'CTE' || normalized === 'CBAPA' ? normalized : 'CCIT';
};

export const getOfflineInterviewPack = (
  type: OfflineInterviewKind,
  department: string,
): readonly OfflineInterviewQuestion[] => type === 'thesis'
  ? getThesisInterviewQuestions(department)
  : getEnrollmentInterviewQuestions(department);

export const getOfflineInterviewPackVersion = (type: OfflineInterviewKind): string =>
  type === 'thesis' ? THESIS_INTERVIEW_VERSION : ENROLLMENT_INTERVIEW_VERSION;

export const createOfflineInterviewActivityState = (
  type: OfflineInterviewKind,
  department: string,
  engine: OfflineInterviewEngine,
  thesisContext?: { text: string; sourceName?: string },
): OfflineInterviewActivityState => {
  const pack = getOfflineInterviewPack(type, department);
  const questionIds = pack.map(question => question.id);
  return {
    offlineEngine: engine,
    department: normalizeDepartment(department),
    questionIds,
    questionOrder: [...questionIds],
    thesisAbstractContext: type === 'thesis'
      ? thesisContext?.text.trim().slice(0, MAX_THESIS_ABSTRACT_CONTEXT_LENGTH)
      : undefined,
    thesisAbstractSourceName: type === 'thesis' ? thesisContext?.sourceName : undefined,
    engineTransitions: [],
  };
};

export const readOfflineInterviewActivityState = (
  session: Pick<AccountOfflineSession, 'type' | 'activityState'>,
): OfflineInterviewActivityState | null => {
  if (session.type !== 'upcoming' && session.type !== 'thesis') return null;
  const state = session.activityState as Partial<OfflineInterviewActivityState>;
  if (
    (state.offlineEngine !== 'webllm' && state.offlineEngine !== 'fallback') ||
    typeof state.department !== 'string' ||
    !Array.isArray(state.questionIds) ||
    !Array.isArray(state.questionOrder) ||
    !Array.isArray(state.engineTransitions)
  ) return null;
  return {
    offlineEngine: state.offlineEngine,
    department: state.department,
    questionIds: state.questionIds.filter((id): id is string => typeof id === 'string'),
    questionOrder: state.questionOrder.filter((id): id is string => typeof id === 'string'),
    thesisAbstractContext: typeof state.thesisAbstractContext === 'string'
      ? state.thesisAbstractContext.slice(0, MAX_THESIS_ABSTRACT_CONTEXT_LENGTH)
      : undefined,
    thesisAbstractSourceName: typeof state.thesisAbstractSourceName === 'string'
      ? state.thesisAbstractSourceName
      : undefined,
    engineTransitions: state.engineTransitions,
  };
};

export const transitionOfflineInterviewToFallback = (
  state: OfflineInterviewActivityState,
  responseCount: number,
  reason: string,
  changedAt = Date.now(),
): OfflineInterviewActivityState => state.offlineEngine === 'fallback' ? state : {
  ...state,
  offlineEngine: 'fallback',
  engineTransitions: [
    ...state.engineTransitions,
    {
      from: 'webllm',
      to: 'fallback',
      atResponseCount: responseCount,
      reason,
      changedAt,
    },
  ],
};

export const getFallbackProfessorTurn = (
  type: OfflineInterviewKind,
  department: string,
  responseCount: number,
): string => {
  if (responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT) {
    return type === 'thesis' ? THESIS_OFFLINE_CLOSING : ENROLLMENT_OFFLINE_CLOSING;
  }
  const question = getOfflineInterviewPack(type, department)[responseCount];
  if (!question) throw new Error('The offline interview question pack is incomplete.');
  return question.text;
};

export const appendOfflineInterviewAnswer = (
  conversationLog: ConversationTurn[],
  answer: string,
): { conversationLog: ConversationTurn[]; responseCount: number } => {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('An interview answer is required.');
  const responseCount = conversationLog.filter(turn => turn.sender === 'user').length;
  if (responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT) {
    throw new Error('All five interview responses have already been recorded.');
  }
  return {
    conversationLog: [...conversationLog, { sender: 'user', text }],
    responseCount: responseCount + 1,
  };
};

const getEnrollmentSystemPrompt = (department: string) => {
  const normalized = normalizeDepartment(department);
  if (normalized === 'CTE') return 'You are Professor Maxiel, a warm but challenging College of Teacher Education enrollment interviewer. Evaluate subject knowledge, teaching aptitude, communication, motivation, academic preparedness, problem solving, and leadership.';
  if (normalized === 'CBAPA') return 'You are Professor Maxiel, a warm but challenging CBAPA enrollment interviewer. Evaluate business fundamentals, analysis, communication, entrepreneurial thinking, academic preparedness, leadership, and ethics.';
  return 'You are Professor Maxiel, a warm but challenging Computer Science enrollment interviewer. Evaluate technical fundamentals, problem solving, coding basics, communication, enthusiasm, and soft skills.';
};

const getThesisSystemPrompt = (department: string) => {
  const normalized = normalizeDepartment(department);
  if (normalized === 'CTE') return 'You are Professor Maxiel, a strict but constructive CTE thesis panel member. Probe pedagogical innovation, action research, learning outcomes, literature and DepEd alignment, teaching demonstration, scalability, and policy.';
  if (normalized === 'CBAPA') return 'You are Professor Maxiel, a strict but constructive CBAPA thesis panel member. Probe the research problem, methodology and data analysis, practical recommendations and ROI, literature and theory, and professional delivery.';
  return 'You are Professor Maxiel, a strict but constructive Computer Science thesis panel member. Probe technical innovation, system implementation and performance, experimental validation, related work, and demo quality.';
};

const validateGeneratedProfessorTurn = (text: string, finalTurn: boolean): string => {
  const normalized = text.replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!normalized) throw new Error('The local model returned an empty response.');
  if (finalTurn && normalized.includes('?')) throw new Error('The local model asked a sixth question.');
  if (!finalTurn && !normalized.includes('?')) throw new Error('The local model did not return an interview question.');
  return normalized;
};

export const generateWebLLMProfessorTurn = async (
  engine: MLCEngine,
  input: {
    type: OfflineInterviewKind;
    department: string;
    conversationLog: ConversationTurn[];
    responseCount: number;
    thesisAbstractContext?: string;
  },
): Promise<string> => {
  const finalTurn = input.responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT;
  const systemPrompt = input.type === 'thesis'
    ? getThesisSystemPrompt(input.department)
    : getEnrollmentSystemPrompt(input.department);
  const context = input.type === 'thesis' && input.thesisAbstractContext
    ? `\nUse this bounded thesis abstract context when forming questions:\n${input.thesisAbstractContext}`
    : '';
  const instruction = finalTurn
    ? 'The student has submitted response 5 of 5. Give one brief constructive closing statement. Do not ask a question.'
    : `Ask exactly one concise follow-up question for response ${input.responseCount + 1} of 5. Do not narrate or provide analysis.`;
  const messages = [
    { role: 'system' as const, content: `${systemPrompt}${context}\n${instruction}` },
    ...input.conversationLog.map(turn => ({
      role: turn.sender === 'ai' ? 'assistant' as const : 'user' as const,
      content: turn.text,
    })),
    ...(input.conversationLog.length === 0
      ? [{ role: 'user' as const, content: input.type === 'thesis' ? 'Begin the thesis defense now.' : 'Begin the enrollment interview now.' }]
      : []),
  ];
  const response = await engine.chat.completions.create({
    messages,
    stream: false,
    temperature: 0.35,
    max_tokens: finalTurn ? 100 : 180,
  });
  return validateGeneratedProfessorTurn(response.choices[0]?.message?.content || '', finalTurn);
};

export const evaluateOfflineInterview = (
  type: OfflineInterviewKind,
  conversationLog: ConversationTurn[],
  eyeContact: { score: number | null; samples: number } | null,
): { evaluation: OfflineInterviewEvaluation; pendingEvaluation: Record<string, unknown> } => {
  const answers = conversationLog.filter(turn => turn.sender === 'user' && turn.text.trim());
  const answeredWordCount = answers.reduce(
    (total, turn) => total + (turn.text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?/g) || []).length,
    0,
  );
  const evaluation: OfflineInterviewEvaluation = {
    rubricVersion: getOfflineInterviewPackVersion(type),
    responseCount: answers.length,
    answeredWordCount,
    averageWordsPerResponse: answers.length ? Math.round((answeredWordCount / answers.length) * 10) / 10 : 0,
    eyeContact,
    subjectiveScores: null,
  };
  return {
    evaluation,
    pendingEvaluation: {
      cloudAuthoritativeEvaluation: true,
      subjectiveRubricScores: true,
      finalScore: true,
    },
  };
};
