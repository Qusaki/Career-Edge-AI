import { isCanonicalDrillCriterion } from './analytics';

export type DrillRemediationCriterion = 'vocabulary' | 'clarity' | 'grammar' | 'conciseness' | 'task_completion' | 'courtesy';
export type DrillRemediationType = 'jam' | 'fast_word' | 'emotion' | 'synonym' | 'fake_profile' | 'emoji_story'
  | 'positive_framing' | 'taboo' | 'elevator_pitch' | 'rephrase' | 'negotiation' | 'crisis';
export type DrillRemediationLevel = 'easy' | 'medium' | 'hard';

const weaknessPriority: readonly DrillRemediationCriterion[] = [
  'task_completion', 'clarity', 'vocabulary', 'grammar', 'conciseness', 'courtesy',
];

const candidateTypes: Record<DrillRemediationCriterion, readonly DrillRemediationType[]> = {
  vocabulary: ['synonym', 'fast_word', 'taboo'],
  clarity: ['rephrase', 'fast_word'],
  grammar: ['rephrase', 'fake_profile'],
  conciseness: ['elevator_pitch', 'rephrase', 'jam'],
  task_completion: ['fast_word', 'fake_profile'],
  courtesy: ['positive_framing', 'negotiation', 'crisis'],
};

export const drillRemediationLabels: Record<DrillRemediationCriterion, string> = {
  vocabulary: 'Vocabulary', clarity: 'Clarity', grammar: 'Grammar', conciseness: 'Conciseness',
  task_completion: 'Task completion', courtesy: 'Courtesy',
};

export interface DrillRemediationAvailability {
  drillType: DrillRemediationType;
  level: DrillRemediationLevel;
  unlocked: boolean;
  completed: boolean;
}

export interface DrillRemediationRecommendation {
  criterion: DrillRemediationCriterion;
  drillType: DrillRemediationType;
  level: DrillRemediationLevel;
}

export function getDrillRemediationRecommendation({ kind, authority, passed, criteria, currentDrillType, available } : {
  kind: string;
  authority: string | null;
  passed: boolean | null;
  criteria: unknown;
  currentDrillType: string;
  available: readonly DrillRemediationAvailability[];
}): DrillRemediationRecommendation | null {
  if (kind !== 'online' || authority !== 'semantic_ai_with_objective_caps' || passed !== false
    || typeof criteria !== 'object' || criteria === null) return null;
  const scores = criteria as Record<string, unknown>;
  if (!weaknessPriority.every(key => isCanonicalDrillCriterion(scores[key]))) return null;
  const lowest = Math.min(...weaknessPriority.map(key => scores[key] as number));
  if (lowest >= 3) return null;
  const criterion = weaknessPriority.find(key => scores[key] === lowest);
  if (!criterion) return null;
  const candidates = candidateTypes[criterion]
    .filter(type => type !== currentDrillType)
    .map(type => available.find(item => item.drillType === type && item.unlocked))
    .filter((item): item is DrillRemediationAvailability => item !== undefined);
  const chosen = candidates.find(item => !item.completed) ?? candidates[0];
  return chosen ? { criterion, drillType: chosen.drillType, level: chosen.level } : null;
}
