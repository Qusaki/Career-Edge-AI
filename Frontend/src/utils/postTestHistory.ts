import type { PostTestCompletionResult, PostTestEvaluationData } from '../components/PostTestEvaluationResult';

const criteriaKeys = ['vocabulary', 'clarity', 'grammar', 'courtesy', 'conciseness'] as const;
type Criterion = typeof criteriaKeys[number];
type StoredCriteria = Record<Criterion, number | null>;
type StoredResult = Omit<PostTestCompletionResult, 'total_score' | 'passed' | 'feedback_summary'> & {
  total_score: number | null;
  passed: boolean | null;
  feedback_summary: string | null;
};

export type PostTestHistoryPair = { question: string; answer: string };
export type PostTestHistoryDisplay = {
  result: StoredResult;
  aggregateCriteria: StoredCriteria;
  completedAt: string | null;
  pairs: PostTestHistoryPair[];
  detailNotice: string | null;
};

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const isScore = (value: unknown): value is number => Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 5;
const isAuthority = (value: unknown): value is PostTestEvaluationData['scoring_authority'] =>
  value === 'semantic_ai_with_objective_caps' || value === 'deterministic_fallback';

const readCriteria = (value: unknown): Record<Criterion, number> | null => {
  if (!isRecord(value) || !criteriaKeys.every(key => isScore(value[key]))) return null;
  return Object.fromEntries(criteriaKeys.map(key => [key, value[key]])) as Record<Criterion, number>;
};

export function extractPostTestHistoryPairs(messages: unknown): PostTestHistoryPair[] | null {
  if (!Array.isArray(messages) || messages.length < 10 || messages.length > 11) return null;
  if (!messages.every(message => isRecord(message)
    && Number.isInteger(message.id) && typeof message.id === 'number'
    && typeof message.timestamp === 'string' && Number.isFinite(Date.parse(message.timestamp)))) return null;
  const ordered = [...messages].sort((a, b) =>
    Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id);
  const pairs: PostTestHistoryPair[] = [];
  for (let index = 0; index < 5; index += 1) {
    const question = ordered[index * 2];
    const answer = ordered[index * 2 + 1];
    if (question.role !== 'ai' || answer.role !== 'user'
      || typeof question.content !== 'string' || !question.content.trim()
      || typeof answer.content !== 'string' || !answer.content.trim()) return null;
    pairs.push({ question: question.content, answer: answer.content });
  }
  // Completed sessions can contain one final AI completion notice, not a sixth answer.
  if (ordered.length === 11 && (ordered[10].role !== 'ai' || typeof ordered[10].content !== 'string')) return null;
  return pairs;
}

export function readPostTestV2Evaluation(value: unknown): PostTestEvaluationData | null {
  if (!isRecord(value) || value.schema_version !== 'post-test-evaluation-v2'
    || !isAuthority(value.scoring_authority) || typeof value.question_pack_version !== 'string'
    || !readCriteria(value.aggregate_criteria)
    || !Number.isInteger(value.total_score) || typeof value.total_score !== 'number'
    || value.total_score < 0 || value.total_score > 25 || typeof value.passed !== 'boolean'
    || typeof value.overall_feedback !== 'string'
    || !Array.isArray(value.recommendations) || !value.recommendations.every(item => typeof item === 'string')
    || !Array.isArray(value.question_evaluations) || value.question_evaluations.length !== 5) return null;
  const indices = new Set<number>();
  for (const entry of value.question_evaluations) {
    if (!isRecord(entry) || !Number.isInteger(entry.question_index)
      || typeof entry.question_index !== 'number' || entry.question_index < 1 || entry.question_index > 5
      || indices.has(entry.question_index) || !readCriteria(entry.criteria)
      || !isScore(entry.answer_relevance) || !isScore(entry.learning_evidence)
      || (entry.feedback !== null && typeof entry.feedback !== 'string')
      || !isAuthority(entry.scoring_authority)) return null;
    indices.add(entry.question_index);
  }
  return value as PostTestEvaluationData;
}

export function readPostTestHistoryDisplay(raw: unknown, expectedId: number | string): PostTestHistoryDisplay | null {
  if (!isRecord(raw) || String(raw.id) !== String(expectedId) || raw.status !== 'completed') return null;
  const aggregateCriteria = Object.fromEntries(criteriaKeys.map(key => {
    const score = raw[`score_${key}`];
    return [key, isScore(score) ? score : null];
  })) as StoredCriteria;
  const result: StoredResult = {
    total_score: typeof raw.total_score === 'number' && Number.isFinite(raw.total_score)
      && raw.total_score >= 0 && raw.total_score <= 25 ? raw.total_score : null,
    passed: typeof raw.passed === 'boolean' ? raw.passed : null,
    feedback_summary: typeof raw.feedback_summary === 'string' ? raw.feedback_summary : null,
    evaluation_data: null,
  };
  const completedAt = typeof raw.end_time === 'string' && Number.isFinite(Date.parse(raw.end_time)) ? raw.end_time : null;
  if (raw.evaluation_data === null) {
    return { result, aggregateCriteria, completedAt, pairs: [],
      detailNotice: 'Detailed per-question evaluation is not available for this earlier Post-Test.' };
  }
  if (!isRecord(raw.evaluation_data) || raw.evaluation_data.schema_version !== 'post-test-evaluation-v2') {
    return { result, aggregateCriteria, completedAt, pairs: [],
      detailNotice: 'Detailed evaluation for this Post-Test version cannot be displayed.' };
  }
  const evaluation = readPostTestV2Evaluation(raw.evaluation_data);
  const pairs = extractPostTestHistoryPairs(raw.messages);
  const hasValidStoredSummary = result.total_score !== null && Number.isInteger(result.total_score)
    && result.passed !== null && criteriaKeys.every(key => aggregateCriteria[key] !== null);
  if (!evaluation || !pairs || !hasValidStoredSummary) {
    return { result, aggregateCriteria, completedAt, pairs: [],
      detailNotice: 'Detailed question evaluation is incomplete for this session.' };
  }
  return { result: { ...result, evaluation_data: evaluation }, aggregateCriteria, completedAt, pairs, detailNotice: null };
}

export class PostTestHistoryFetchError extends Error {
  constructor(readonly status: number) {
    super('Unable to load this Post-Test evaluation.');
  }
}

export async function fetchPostTestHistoryDetail(
  apiUrl: string, id: number | string, token: string, signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(`${apiUrl}/post-test-interview/${encodeURIComponent(String(id))}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  if (!response.ok) throw new PostTestHistoryFetchError(response.status);
  return response.json() as Promise<unknown>;
}
