export const BASELINE_CRITERIA = ['vocabulary', 'clarity', 'grammar', 'courtesy', 'conciseness'] as const;
export type BaselineCriterionKey = typeof BASELINE_CRITERIA[number];
export type BaselineSourceKind = 'who-am-i' | 'active-listening';

export const BASELINE_LABELS: Record<BaselineCriterionKey, string> = {
  vocabulary: 'Vocabulary', clarity: 'Clarity', grammar: 'Grammar',
  courtesy: 'Courtesy', conciseness: 'Conciseness',
};

const TIE_PRIORITY: readonly BaselineCriterionKey[] = [
  'clarity', 'conciseness', 'vocabulary', 'grammar', 'courtesy',
];
const NEXT_STEPS: Record<BaselineCriterionKey, string> = {
  clarity: 'Practice organizing your main idea before adding supporting details.',
  conciseness: 'Practice stating the main point earlier and removing repeated details.',
  vocabulary: 'Practice choosing precise words for different communication situations.',
  grammar: 'Practice clear sentence structure and consistent grammar.',
  courtesy: 'Practice respectful, audience-aware phrasing.',
};

type HistoryRecord = Record<string, unknown>;
export type BaselineCriterion = {
  key: BaselineCriterionKey;
  label: string;
  percentage: number;
  sources: BaselineSourceKind[];
};
export type BaselineSource = {
  kind: BaselineSourceKind;
  id: number;
  completedAt: string | null;
  feedback: string | null;
};
export type BaselineGuidance = {
  criterion: BaselineCriterion;
  note: string;
};
export type PreTestBaseline = {
  sources: BaselineSource[];
  coverage: 'partial' | 'full';
  establishedAt: string | null;
  criteria: BaselineCriterion[];
  visualEngagement: number | null;
  additionalWhoAmI: { completeness: number | null; correctness: number | null } | null;
  strengths: BaselineGuidance[];
  priorities: BaselineGuidance[];
};

const validDate = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const nativeScore = (value: unknown, maximum: 3 | 5): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maximum ? value : null;
const percentage = (score: number, maximum: 3 | 5): number => score / maximum * 100;
const roundOne = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10;

const initialRecord = (records: readonly HistoryRecord[], source: string): HistoryRecord | null => {
  const eligible = records.filter(record => record._source === source && record.status === 'completed'
    && typeof record.id === 'number' && Number.isSafeInteger(record.id) && record.id > 0
    && validDate(record.start_time) !== null);
  eligible.sort((a, b) => Date.parse(a.start_time as string) - Date.parse(b.start_time as string)
    || (a.id as number) - (b.id as number));
  return eligible[0] ?? null;
};

const scoreFor = (record: HistoryRecord, key: BaselineCriterionKey, kind: BaselineSourceKind): number | null => {
  const maximum: 3 | 5 = kind === 'who-am-i' && ['clarity', 'courtesy', 'conciseness'].includes(key) ? 3 : 5;
  const score = nativeScore(record[`score_${key}`], maximum);
  return score === null ? null : percentage(score, maximum);
};

const initialCamera = (record: HistoryRecord): { score: number; samples: number } | null => {
  const score = record.score_eye_contact;
  const samples = record.eye_contact_samples;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100
    || typeof samples !== 'number' || !Number.isSafeInteger(samples) || samples <= 0) return null;
  return { score, samples };
};

/** The approved rule is earliest completed *server-recorded* session per subtype. */
export function derivePreTestBaseline(records: readonly HistoryRecord[]): PreTestBaseline | null {
  const who = initialRecord(records, 'pre-test-intro');
  const listening = initialRecord(records, 'pre-test-active-listening');
  if (!who && !listening) return null;

  const selected = [
    who && { kind: 'who-am-i' as const, record: who },
    listening && { kind: 'active-listening' as const, record: listening },
  ].filter((item): item is { kind: BaselineSourceKind; record: HistoryRecord } => item !== null);
  const sources = selected.map(({ kind, record }): BaselineSource => ({
    kind, id: record.id as number, completedAt: validDate(record.end_time),
    feedback: typeof record.feedback_summary === 'string' && record.feedback_summary.trim()
      ? record.feedback_summary : null,
  }));
  const completionTimes = sources.map(source => source.completedAt).filter((value): value is string => value !== null);
  const establishedAt = completionTimes.length === sources.length
    ? completionTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;

  const criteria = BASELINE_CRITERIA.flatMap(key => {
    const contributions = selected.flatMap(({ kind, record }) => {
      const value = scoreFor(record, key, kind);
      return value === null ? [] : [{ kind, value }];
    });
    if (contributions.length === 0) return [];
    return [{ key, label: BASELINE_LABELS[key],
      percentage: roundOne(contributions.reduce((sum, item) => sum + item.value, 0) / contributions.length),
      sources: contributions.map(item => item.kind),
    }];
  });

  const camera = selected.flatMap(({ record }) => {
    const value = initialCamera(record);
    return value ? [value] : [];
  });
  const cameraSamples = camera.reduce((sum, item) => sum + item.samples, 0);
  const visualEngagement = cameraSamples > 0
    ? roundOne(camera.reduce((sum, item) => sum + item.score * item.samples, 0) / cameraSamples) : null;

  const ranked = [...criteria].sort((a, b) => b.percentage - a.percentage
    || TIE_PRIORITY.indexOf(a.key) - TIE_PRIORITY.indexOf(b.key));
  const strengthCount = Math.min(2, Math.ceil(ranked.length / 2));
  const strengths = ranked.slice(0, strengthCount).map(criterion => ({
    criterion, note: `${criterion.label} was one of your highest-scoring initial Pre-Test areas.`,
  }));
  const chosenStrengths = new Set(strengths.map(item => item.criterion.key));
  const priorities = [...criteria]
    .filter(item => !chosenStrengths.has(item.key))
    .sort((a, b) => a.percentage - b.percentage
      || TIE_PRIORITY.indexOf(a.key) - TIE_PRIORITY.indexOf(b.key))
    .slice(0, 2).map(criterion => ({ criterion, note: NEXT_STEPS[criterion.key] }));

  const additionalWhoAmI = who ? {
    completeness: nativeScore(who.score_completeness, 3),
    correctness: nativeScore(who.score_correctness, 3),
  } : null;
  return {
    sources, coverage: who && listening ? 'full' : 'partial', establishedAt,
    criteria, visualEngagement, additionalWhoAmI, strengths, priorities,
  };
}
