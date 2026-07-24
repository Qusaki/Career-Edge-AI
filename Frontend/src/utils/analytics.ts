type ScoreRecord = Record<string, unknown>;

export type ActivityComparisonStatus = 'no-data' | 'baseline' | 'improved' | 'declined' | 'steady';

export interface ActivityComparison {
  label: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  status: ActivityComparisonStatus;
  message: string;
}

const toFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const clampPercentage = (value: number) => Math.min(100, Math.max(0, value));

export const isCompletedActivity = (item: ScoreRecord): boolean => {
  if (['completed', 'pending_sync', 'synced'].includes(String(item.status || ''))) return true;
  return item.end_time != null || toFiniteNumber(item.total_score) != null || toFiniteNumber(item.score) != null;
};

export const getNormalizedActivityScore = (item: ScoreRecord): number | null => {
  const source = String(item._source || '');
  if (source === 'drills') {
    const score = toFiniteNumber(item.score);
    return score == null ? null : clampPercentage(score);
  }

  const totalScore = toFiniteNumber(item.total_score);
  if (totalScore == null) return null;

  // Historical communication records included a camera criterion in their total.
  // Current records store it as null and already use the camera-free denominator.
  const legacyEyeContact = toFiniteNumber(item.score_eye_contact) || 0;
  const cameraFreeTotal = Math.max(0, totalScore - legacyEyeContact);

  if (source === 'pre-test-intro') return clampPercentage((cameraFreeTotal / 15) * 100);
  if (source === 'pre-test-active-listening' || source === 'post-test-interview') {
    return clampPercentage((cameraFreeTotal / 25) * 100);
  }

  return clampPercentage(totalScore);
};

const activityTimestamp = (item: ScoreRecord): number => {
  const value = item.end_time || item.start_time || item.timestamp;
  const timestamp = value == null ? Number.NaN : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const roundToOneDecimal = (value: number): number => Number(value.toFixed(1));

/** Compare the two latest completed, scored records for one activity type. */
export const buildActivityComparison = (
  label: string,
  records: ScoreRecord[],
): ActivityComparison => {
  const scoredRecords = records
    .map(record => ({
      record,
      score: getNormalizedActivityScore(record),
      timestamp: activityTimestamp(record),
    }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score != null)
    .sort((a, b) => {
      const timeDifference = b.timestamp - a.timestamp;
      if (timeDifference !== 0) return timeDifference;
      return (toFiniteNumber(b.record.id) || 0) - (toFiniteNumber(a.record.id) || 0);
    });

  if (scoredRecords.length === 0) {
    return {
      label,
      previous: null,
      current: null,
      delta: null,
      status: 'no-data',
      message: `Complete a scored ${label} activity to start tracking improvement.`,
    };
  }

  const current = roundToOneDecimal(scoredRecords[0].score);
  if (scoredRecords.length === 1) {
    return {
      label,
      previous: null,
      current,
      delta: null,
      status: 'baseline',
      message: `This is your baseline score. Complete another ${label} activity to compare your progress.`,
    };
  }

  const previous = roundToOneDecimal(scoredRecords[1].score);
  const delta = roundToOneDecimal(current - previous);
  if (delta > 0) {
    return {
      label,
      previous,
      current,
      delta,
      status: 'improved',
      message: `Improved by ${delta} percentage ${delta === 1 ? 'point' : 'points'} since your previous session.`,
    };
  }
  if (delta < 0) {
    const decrease = Math.abs(delta);
    return {
      label,
      previous,
      current,
      delta,
      status: 'declined',
      message: `Decreased by ${decrease} percentage ${decrease === 1 ? 'point' : 'points'}. Review your feedback before the next attempt.`,
    };
  }

  return {
    label,
    previous,
    current,
    delta,
    status: 'steady',
    message: 'Your score is unchanged from the previous session. Keep practicing to move it forward.',
  };
};

const weightedTotal = (evaluation: ScoreRecord, fields: Array<[string, number]>): number => {
  const total = fields.reduce((sum, [field, weight]) => {
    const score = clampPercentage(toFiniteNumber(evaluation[field]) || 0);
    return sum + (score * weight);
  }, 0);
  return Number(total.toFixed(2));
};

export const getEnrollmentEvaluationTotal = (evaluation: ScoreRecord, department: string): number => {
  const dep = department.trim().toUpperCase();
  if (dep === 'CTE') {
    return weightedTotal(evaluation, [
      ['subject_matter_score', 0.25],
      ['teaching_aptitude_score', 0.20],
      ['communication_score', 0.20],
      ['motivation_score', 0.15],
      ['academic_preparedness_score', 0.10],
      ['problem_solving_score', 0.05],
      ['leadership_score', 0.05],
    ]);
  }
  if (dep === 'CBAPA') {
    return weightedTotal(evaluation, [
      ['business_fundamentals_score', 0.25],
      ['analytical_score', 0.20],
      ['communication_score', 0.15],
      ['entrepreneurial_score', 0.15],
      ['academic_preparedness_score', 0.10],
      ['leadership_score', 0.10],
      ['ethical_score', 0.05],
    ]);
  }
  return weightedTotal(evaluation, [
    ['technical_score', 0.30],
    ['problem_solving_score', 0.25],
    ['coding_score', 0.20],
    ['communication_score', 0.15],
    ['soft_skills_score', 0.10],
  ]);
};

export const getThesisEvaluationTotal = (evaluation: ScoreRecord, department: string): number => {
  const dep = department.trim().toUpperCase();
  if (dep === 'CTE') {
    return weightedTotal(evaluation, [
      ['pedagogical_innovation_score', 0.25],
      ['action_research_score', 0.20],
      ['learning_outcomes_score', 0.20],
      ['literature_alignment_score', 0.15],
      ['teaching_demo_score', 0.10],
      ['scalability_policy_score', 0.10],
    ]);
  }
  if (dep === 'CBAPA') {
    return weightedTotal(evaluation, [
      ['research_problem_score', 0.25],
      ['methodology_analysis_score', 0.25],
      ['practical_roi_score', 0.20],
      ['literature_theoretical_score', 0.15],
      ['professional_delivery_score', 0.15],
    ]);
  }
  return weightedTotal(evaluation, [
    ['technical_innovation_score', 0.30],
    ['system_implementation_score', 0.25],
    ['experimental_validation_score', 0.20],
    ['literature_review_score', 0.15],
    ['demo_quality_score', 0.10],
  ]);
};
