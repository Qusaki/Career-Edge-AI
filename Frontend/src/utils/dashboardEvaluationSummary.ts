import { isCanonicalDrillCriterion } from './analytics';

export const DASHBOARD_EVALUATION_SOURCES = [
  'pre-test-intro',
  'pre-test-active-listening',
  'drills',
  'post-test-interview',
] as const;

type Source = typeof DASHBOARD_EVALUATION_SOURCES[number];
export type EvaluationFamily = 'Pre-Test' | 'Drills' | 'Post-Test';
export type EvaluationCriterion =
  | 'vocabulary' | 'clarity' | 'grammar' | 'conciseness' | 'courtesy' | 'task_completion';
export type EvaluationBand = 'Strong' | 'Developing well' | 'Needs more focus' | 'Priority area';
export type EvaluationAuthority = 'semantic_ai_with_objective_caps' | 'deterministic_fallback' | null;

const SHARED_CRITERIA: readonly EvaluationCriterion[] = [
  'vocabulary', 'clarity', 'grammar', 'conciseness', 'courtesy',
];
const ALL_CRITERIA: readonly EvaluationCriterion[] = [...SHARED_CRITERIA, 'task_completion'];
const FAMILY_ORDER: readonly EvaluationFamily[] = ['Pre-Test', 'Drills', 'Post-Test'];

export const criterionLabels: Record<EvaluationCriterion, string> = {
  vocabulary: 'Vocabulary',
  clarity: 'Clarity',
  grammar: 'Grammar',
  conciseness: 'Conciseness',
  courtesy: 'Courtesy',
  task_completion: 'Task Completion',
};

const criterionFocus: Record<EvaluationCriterion, string> = {
  vocabulary: 'choose precise words that fit the task',
  clarity: 'state your main point early and organize supporting ideas',
  grammar: 'check sentence structure as you respond',
  conciseness: 'keep the response focused and remove repeated ideas',
  courtesy: 'keep a respectful, professional tone',
  task_completion: 'address every requirement of the assigned Drill',
};

export interface CurrentCriterion {
  key: EvaluationCriterion;
  label: string;
  percentage: number;
  band: EvaluationBand;
  comment: string;
  families: EvaluationFamily[];
}

export interface DashboardEvaluationSummary {
  criteria: CurrentCriterion[];
  families: EvaluationFamily[];
  completedAt: string;
  overallFeedback: string;
  latestFeedback: { text: string; family: EvaluationFamily } | null;
  drillAuthority: EvaluationAuthority;
}

interface AdaptedEvaluation {
  source: Source;
  family: EvaluationFamily;
  id: number;
  completedAt: string;
  timestamp: number;
  criteria: Partial<Record<EvaluationCriterion, number>>;
  feedback: string | null;
  authority: EvaluationAuthority;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSource = (value: unknown): value is Source =>
  typeof value === 'string' && DASHBOARD_EVALUATION_SOURCES.some(source => source === value);

const nativeScore = (value: unknown, maximum: 3 | 5): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maximum
    ? Number(((value / maximum) * 100).toFixed(1)) : null;

const adaptedScores = (
  record: Record<string, unknown>,
  fields: Partial<Record<EvaluationCriterion, 3 | 5>>,
): Partial<Record<EvaluationCriterion, number>> => {
  const scores: Partial<Record<EvaluationCriterion, number>> = {};
  for (const key of ALL_CRITERIA) {
    const maximum = fields[key];
    if (!maximum) continue;
    const score = nativeScore(record[`score_${key}`], maximum);
    if (score !== null) scores[key] = score;
  }
  return scores;
};

const parseDrillScoring = (value: unknown): Record<string, unknown> | null => {
  try {
    const evaluation: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return isRecord(evaluation) && isRecord(evaluation.scoring) ? evaluation.scoring : null;
  } catch {
    return null;
  }
};

const adaptEvaluation = (record: Record<string, unknown>): AdaptedEvaluation | null => {
  if (!isSource(record._source) || record.status !== 'completed'
    || typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id <= 0
    || typeof record.end_time !== 'string') return null;
  const timestamp = Date.parse(record.end_time);
  if (!Number.isFinite(timestamp)) return null;

  const source = record._source;
  const family: EvaluationFamily = source.startsWith('pre-test-') ? 'Pre-Test'
    : source === 'drills' ? 'Drills' : 'Post-Test';
  if (source !== 'drills') {
    const total = record.total_score;
    const maximum = source === 'pre-test-intro' ? 15 : 25;
    if (typeof total !== 'number' || !Number.isFinite(total)
      || total < 5 || total > maximum) return null;
  }
  let criteria: Partial<Record<EvaluationCriterion, number>> = {};
  let authority: EvaluationAuthority = null;

  if (source === 'pre-test-intro') {
    criteria = adaptedScores(record, {
      vocabulary: 5, clarity: 3, grammar: 5, conciseness: 3, courtesy: 3,
    });
  } else if (source === 'pre-test-active-listening' || source === 'post-test-interview') {
    criteria = adaptedScores(record, {
      vocabulary: 5, clarity: 5, grammar: 5, conciseness: 5, courtesy: 5,
    });
  } else {
    // Only completed server history can reach this adapter. Never use a local
    // provisional result as a substitute for persisted evaluation_data.
    if (typeof record.score !== 'number' || !Number.isFinite(record.score)
      || record.score < 0 || record.score > 100) return null;
    const scoring = parseDrillScoring(record.evaluation_data);
    if (!scoring || !isRecord(scoring.criteria)) return null;
    for (const key of ALL_CRITERIA) {
      const value = scoring.criteria[key];
      if (isCanonicalDrillCriterion(value)) {
        criteria[key] = Number(((value / 5) * 100).toFixed(1));
      }
    }
    if (scoring.authority === 'semantic_ai_with_objective_caps'
      || scoring.authority === 'deterministic_fallback') authority = scoring.authority;
  }

  if (Object.keys(criteria).length === 0) return null;
  return {
    source, family, id: record.id, completedAt: record.end_time, timestamp, criteria, authority,
    feedback: typeof record.feedback_summary === 'string' && record.feedback_summary.trim()
      ? record.feedback_summary.trim() : null,
  };
};

export const bandForPercentage = (percentage: number): EvaluationBand =>
  percentage >= 80 ? 'Strong'
    : percentage >= 65 ? 'Developing well'
      : percentage >= 50 ? 'Needs more focus' : 'Priority area';

export const criterionComment = (key: EvaluationCriterion, band: EvaluationBand): string => {
  const focus = criterionFocus[key];
  if (band === 'Strong') return `Your recent results suggest a strength in ${criterionLabels[key].toLowerCase()}. Keep practicing to maintain it.`;
  if (band === 'Developing well') return `Your recent results suggest progress in ${criterionLabels[key].toLowerCase()}. Continue to ${focus}.`;
  if (band === 'Needs more focus') return `Your recent results suggest ${criterionLabels[key].toLowerCase()} needs more focus. Practice to ${focus}.`;
  return `Your recent results suggest ${criterionLabels[key].toLowerCase()} is a priority area. Start by working to ${focus}.`;
};

const latestFirst = (a: AdaptedEvaluation, b: AdaptedEvaluation): number =>
  b.timestamp - a.timestamp || b.id - a.id;

const average = (values: number[]): number =>
  Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

/** Pure current-state selector: four assessment sources only, one result per subtype. */
export const deriveDashboardEvaluationSummary = (
  records: readonly Record<string, unknown>[],
): DashboardEvaluationSummary | null => {
  const latest = new Map<Source, AdaptedEvaluation>();
  for (const record of records) {
    const adapted = adaptEvaluation(record);
    if (!adapted) continue;
    const previous = latest.get(adapted.source);
    if (!previous || latestFirst(adapted, previous) < 0) latest.set(adapted.source, adapted);
  }
  if (latest.size === 0) return null;

  const selected = [...latest.values()].sort(latestFirst);
  const families = FAMILY_ORDER.filter(family => selected.some(item => item.family === family));
  const criteria: CurrentCriterion[] = [];

  for (const key of ALL_CRITERIA) {
    const familyValues: Array<{ family: EvaluationFamily; value: number }> = [];
    for (const family of families) {
      const values = selected.filter(item => item.family === family)
        .map(item => item.criteria[key]).filter((value): value is number => value !== undefined);
      if (values.length) familyValues.push({ family, value: average(values) });
    }
    if (!familyValues.length) continue;
    const percentage = average(familyValues.map(item => item.value));
    const band = bandForPercentage(percentage);
    criteria.push({
      key, label: criterionLabels[key], percentage, band,
      comment: criterionComment(key, band), families: familyValues.map(item => item.family),
    });
  }

  const comparable = criteria.filter(item => item.key !== 'task_completion');
  const strongest = [...comparable].sort((a, b) => b.percentage - a.percentage)[0];
  const lowest = [...comparable].sort((a, b) => a.percentage - b.percentage)[0];
  const coverage = families.join(', ');
  const overallFeedback = strongest && lowest && strongest.key !== lowest.key
    && strongest.percentage !== lowest.percentage
    ? `Across your latest ${coverage} evaluation${families.length === 1 ? '' : 's'}, ${strongest.label} is a stronger supported area, while ${lowest.label} needs the most attention. Next, ${criterionFocus[lowest.key]}.`
    : `Your latest ${coverage} evaluation${families.length === 1 ? '' : 's'} provide a current communication snapshot. Keep practicing the supported criteria and review your latest feedback for a practical next step.`;
  const feedbackSource = selected.find(item => item.feedback);

  return {
    criteria, families, completedAt: selected[0].completedAt, overallFeedback,
    latestFeedback: feedbackSource?.feedback
      ? { text: feedbackSource.feedback, family: feedbackSource.family } : null,
    drillAuthority: latest.get('drills')?.authority ?? null,
  };
};
