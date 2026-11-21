import assert from 'node:assert/strict';
import test from 'node:test';
import { getDrillRemediationRecommendation, type DrillRemediationAvailability } from '../src/utils/drillRemediation';

const available: DrillRemediationAvailability[] = [
  { drillType: 'jam', level: 'easy', unlocked: true, completed: true },
  { drillType: 'fast_word', level: 'easy', unlocked: true, completed: false },
  { drillType: 'synonym', level: 'medium', unlocked: true, completed: false },
  { drillType: 'taboo', level: 'hard', unlocked: true, completed: false },
  { drillType: 'rephrase', level: 'hard', unlocked: true, completed: false },
  { drillType: 'fake_profile', level: 'medium', unlocked: true, completed: false },
  { drillType: 'elevator_pitch', level: 'hard', unlocked: true, completed: false },
  { drillType: 'positive_framing', level: 'medium', unlocked: true, completed: false },
  { drillType: 'negotiation', level: 'hard', unlocked: true, completed: false },
  { drillType: 'crisis', level: 'hard', unlocked: true, completed: false },
];

const base = {
  kind: 'online', authority: 'semantic_ai_with_objective_caps', passed: false,
  currentDrillType: 'jam', available,
  criteria: { vocabulary: 2.5, clarity: 3.4, grammar: 3.5, conciseness: 3.6, task_completion: 3.4, courtesy: 3.7 },
};

test('failed AI-assisted result recommends one available Drill for a sub-3.0 weakness', () => {
  assert.deepEqual(getDrillRemediationRecommendation(base), { criterion: 'vocabulary', drillType: 'synonym', level: 'medium' });
  assert.equal(getDrillRemediationRecommendation({ ...base, criteria: { ...base.criteria, vocabulary: 2.9 } })?.drillType, 'synonym');
  assert.equal(getDrillRemediationRecommendation({ ...base, criteria: { ...base.criteria, vocabulary: 3.0 } }), null);
});

test('only failed online AI-assisted results with a valid complete rubric qualify', () => {
  for (const update of [
    { passed: true }, { passed: null }, { kind: 'provisional' }, { kind: 'pending-transcription' },
    { authority: 'deterministic_fallback' }, { authority: null },
    { criteria: null }, { criteria: { ...base.criteria, vocabulary: 2.55 } },
    { criteria: { ...base.criteria, grammar: Number.NaN } },
    { criteria: { vocabulary: 2.5 } },
  ]) assert.equal(getDrillRemediationRecommendation({ ...base, ...update }), null);
});

test('ties follow task completion, clarity, vocabulary, grammar, conciseness, courtesy', () => {
  const scores = { ...base.criteria, vocabulary: 2.5, clarity: 2.5, task_completion: 2.5 };
  assert.equal(getDrillRemediationRecommendation({ ...base, criteria: scores })?.criterion, 'task_completion');
  assert.equal(getDrillRemediationRecommendation({ ...base, criteria: { ...scores, task_completion: 3.5 } })?.criterion, 'clarity');
  assert.equal(getDrillRemediationRecommendation({ ...base, criteria: { ...scores, task_completion: 3.5, clarity: 3.5 } })?.criterion, 'vocabulary');
});

test('each criterion maps to the audited first suitable Drill', () => {
  for (const [criterion, drillType] of [
    ['vocabulary', 'synonym'], ['clarity', 'rephrase'], ['grammar', 'rephrase'],
    ['conciseness', 'elevator_pitch'], ['task_completion', 'fast_word'], ['courtesy', 'positive_framing'],
  ] as const) {
    const criteria = Object.fromEntries(Object.keys(base.criteria).map(key => [key, key === criterion ? 2.5 : 3.5]));
    assert.equal(getDrillRemediationRecommendation({ ...base, criteria })?.drillType, drillType, criterion);
  }
});

test('locked and same-Drill candidates are skipped; incomplete precedes completed', () => {
  const candidates = available.map(item => ({ ...item }));
  candidates.find(item => item.drillType === 'synonym')!.unlocked = false;
  assert.equal(getDrillRemediationRecommendation({ ...base, available: candidates })?.drillType, 'fast_word');
  candidates.find(item => item.drillType === 'synonym')!.unlocked = true;
  candidates.find(item => item.drillType === 'synonym')!.completed = true;
  assert.equal(getDrillRemediationRecommendation({ ...base, available: candidates })?.drillType, 'fast_word');
  candidates.find(item => item.drillType === 'fast_word')!.completed = true;
  assert.equal(getDrillRemediationRecommendation({ ...base, available: candidates })?.drillType, 'taboo');
  candidates.find(item => item.drillType === 'taboo')!.unlocked = false;
  assert.equal(getDrillRemediationRecommendation({ ...base, available: candidates })?.drillType, 'synonym');
  assert.equal(getDrillRemediationRecommendation({ ...base, currentDrillType: 'synonym', available: candidates })?.drillType, 'fast_word');
});

test('no unlocked suitable alternative means no recommendation', () => {
  assert.equal(getDrillRemediationRecommendation({ ...base, available: [] }), null);
  assert.equal(getDrillRemediationRecommendation({ ...base, currentDrillType: 'synonym',
    available: available.filter(item => item.drillType === 'synonym') }), null);
});
