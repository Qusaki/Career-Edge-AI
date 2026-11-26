import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProgressBaseline } from '../src/components/ProgressBaseline';
import { derivePreTestBaseline } from '../src/utils/preTestBaseline';

const who = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  _source: 'pre-test-intro', id: 10, status: 'completed', passed: false,
  start_time: '2026-11-01T08:00:00Z', end_time: '2026-11-01T08:20:00Z',
  score_vocabulary: 4, score_clarity: 2, score_grammar: 3,
  score_courtesy: 3, score_conciseness: 1,
  score_completeness: 2, score_correctness: 3,
  feedback_summary: 'Original Who Am I? feedback — unchanged.',
  ...overrides,
});
const listening = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  _source: 'pre-test-active-listening', id: 20, status: 'completed', passed: false,
  start_time: '2026-11-02T08:00:00Z', end_time: '2026-11-02T08:20:00Z',
  score_vocabulary: 3, score_clarity: 4, score_grammar: 4,
  score_courtesy: 5, score_conciseness: 2,
  feedback_summary: 'Original Active Listening feedback — unchanged.',
  ...overrides,
});
const render = (records: Record<string, unknown>[], userId = 7, historyOwnerId = 7) =>
  renderToStaticMarkup(<ProgressBaseline records={records} historyState="ready"
    userId={userId} historyOwnerId={historyOwnerId} />);
const criterion = (records: Record<string, unknown>[], key: string) =>
  derivePreTestBaseline(records)?.criteria.find(item => item.key === key);

test('earliest completed session of each subtype remains selected across failed starts and better retakes', () => {
  const baseline = derivePreTestBaseline([
    who({ id: 11, start_time: '2026-11-03T08:00:00Z', score_clarity: 3, passed: true }),
    listening({ id: 21, start_time: '2026-11-04T08:00:00Z', score_clarity: 5, passed: true }),
    who(), listening(),
  ]);
  assert.deepEqual(baseline?.sources.map(source => source.id), [10, 20]);
  assert.equal(baseline?.coverage, 'full');
  assert.equal(criterion([who(), listening()], 'clarity')?.percentage, 73.3);
  assert.deepEqual(derivePreTestBaseline([
    who({ id: 13, start_time: '2026-11-01T08:00:00Z' }),
    who({ id: 12, start_time: '2026-11-01T08:00:00Z' }),
  ])?.sources.map(source => source.id), [12]);
});

test('only valid completed server-recorded sessions with valid start time can establish identity', () => {
  const baseline = derivePreTestBaseline([
    who({ id: 1, status: 'active' }), who({ id: 2, status: 'completed_local' }),
    who({ id: 3, status: 'pending_sync' }), who({ id: 4, start_time: 'invalid' }),
    who({ id: 'local' }), who({ id: 5, _source: 'drills' }), who(),
  ]);
  assert.deepEqual(baseline?.sources.map(source => source.id), [10]);
  assert.equal(derivePreTestBaseline([who({ status: 'completed_local' })]), null);
});

test('empty, Who Am I? only, Active Listening only, and full coverage are distinct', () => {
  assert.equal(derivePreTestBaseline([]), null);
  assert.match(render([]), /Complete your Pre-Test to establish your baseline/);
  assert.doesNotMatch(render([]), /0%/);
  assert.equal(derivePreTestBaseline([who()])?.coverage, 'partial');
  assert.match(render([who()]), /Partial Baseline/);
  assert.match(render([who()]), /Who Am I\? only/);
  assert.match(render([listening()]), /Active Listening only/);
  assert.equal(derivePreTestBaseline([who(), listening()])?.coverage, 'full');
  assert.match(render([who(), listening()]), /Who Am I\? \+ Active Listening/);
});

test('native /3 and /5 scores normalize without changing stored records or inventing missing zeros', () => {
  const original = who();
  const copy = structuredClone(original);
  assert.equal(criterion([original], 'clarity')?.percentage, 66.7);
  assert.equal(criterion([original], 'courtesy')?.percentage, 100);
  assert.equal(criterion([original], 'conciseness')?.percentage, 33.3);
  assert.equal(criterion([original], 'vocabulary')?.percentage, 80);
  assert.equal(criterion([original], 'grammar')?.percentage, 60);
  assert.equal(criterion([listening()], 'clarity')?.percentage, 80);
  assert.equal(criterion([original, listening()], 'clarity')?.percentage, 73.3);
  assert.deepEqual(original, copy);
  assert.equal(criterion([who({ score_vocabulary: null }), listening()], 'vocabulary')?.percentage, 60);
  assert.equal(criterion([who({ score_vocabulary: null })], 'vocabulary'), undefined);
});

test('main Baseline has only five shared criteria and never aliases completeness or correctness', () => {
  const baseline = derivePreTestBaseline([who(), listening()]);
  assert.deepEqual(baseline?.criteria.map(item => item.key), ['vocabulary', 'clarity', 'grammar', 'courtesy', 'conciseness']);
  assert.deepEqual(baseline?.additionalWhoAmI, { completeness: 2, correctness: 3 });
  assert.doesNotMatch(render([who(), listening()]).split('progress-baseline-feedback')[0], /Task Completion/);
});

test('Visual Engagement uses only sampled initial sessions with sample-weighted mean', () => {
  const initial = [who({ score_eye_contact: 50, eye_contact_samples: 2 }),
    listening({ score_eye_contact: 80, eye_contact_samples: 3 })];
  assert.equal(derivePreTestBaseline(initial)?.visualEngagement, 68);
  assert.equal(derivePreTestBaseline([initial[0]])?.visualEngagement, 50);
  assert.equal(derivePreTestBaseline([initial[1]])?.visualEngagement, 80);
  assert.equal(derivePreTestBaseline([who(), listening()])?.visualEngagement, null);
  assert.doesNotMatch(render([who(), listening()]), /Initial Pre-Test Visual Engagement/);
  assert.equal(derivePreTestBaseline([...initial,
    who({ id: 30, start_time: '2026-11-05T08:00:00Z', score_eye_contact: 100, eye_contact_samples: 900 }),
    { _source: 'drills', score_eye_contact: 100, eye_contact_samples: 900 },
    { _source: 'post-test-interview', score_eye_contact: 100, eye_contact_samples: 900 },
    { _source: 'upcoming', score_eye_contact: 100, eye_contact_samples: 900 },
    { _source: 'thesis', score_eye_contact: 100, eye_contact_samples: 900 },
  ])?.visualEngagement, 68);
  assert.equal(derivePreTestBaseline([who({ score_eye_contact: 0, eye_contact_samples: 2 })])?.visualEngagement, 0);
});

test('later activity results and retakes cannot move an established Baseline', () => {
  const initial = [who(), listening()];
  const baseline = derivePreTestBaseline(initial);
  const withLater = derivePreTestBaseline([...initial,
    who({ id: 30, start_time: '2026-11-10T08:00:00Z', score_clarity: 3 }),
    listening({ id: 31, start_time: '2026-11-11T08:00:00Z', score_clarity: 5 }),
    { _source: 'drills', status: 'completed', score_clarity: 5 },
    { _source: 'post-test-interview', status: 'completed', score_clarity: 5 },
    { _source: 'upcoming', status: 'completed', score_clarity: 5 },
  ]);
  assert.deepEqual(withLater, baseline);
  assert.equal(derivePreTestBaseline([who()])?.coverage, 'partial');
  assert.equal(derivePreTestBaseline(initial)?.coverage, 'full');
});

test('Baseline established date is the later completion of its two selected initial sessions', () => {
  assert.equal(derivePreTestBaseline([who(), listening()])?.establishedAt, '2026-11-02T08:20:00Z');
  assert.equal(derivePreTestBaseline([who()])?.establishedAt, '2026-11-01T08:20:00Z');
  assert.equal(derivePreTestBaseline([who({ end_time: null }), listening()])?.establishedAt, null);
});

test('stronger and priority areas are deterministic, disjoint, and cautious on ties', () => {
  const baseline = derivePreTestBaseline([who(), listening()]);
  assert.deepEqual(baseline?.strengths.map(item => item.criterion.key), ['courtesy', 'clarity']);
  assert.deepEqual(baseline?.priorities.map(item => item.criterion.key), ['conciseness', 'vocabulary']);
  assert.ok(baseline?.strengths.every(item => /highest-scoring initial Pre-Test areas/.test(item.note)));
  assert.ok(baseline?.priorities.every(item => item.note.startsWith('Practice')));
  const tied = who({ score_vocabulary: 3, score_clarity: 2, score_grammar: 3, score_courtesy: 2, score_conciseness: 2 });
  assert.deepEqual(derivePreTestBaseline([tied])?.strengths.map(item => item.criterion.key), ['clarity', 'conciseness']);
  assert.deepEqual(derivePreTestBaseline([tied])?.priorities.map(item => item.criterion.key), ['vocabulary', 'grammar']);
  const one = derivePreTestBaseline([who({ score_vocabulary: null, score_clarity: 2, score_grammar: null,
    score_courtesy: null, score_conciseness: null })]);
  assert.deepEqual(one?.strengths.map(item => item.criterion.key), ['clarity']);
  assert.deepEqual(one?.priorities, []);
});

test('feedback remains verbatim and optional subtype-specific indicators validate independently', () => {
  const html = render([who(), listening()]);
  assert.equal((html.match(/Original Who Am I\? feedback — unchanged/g) || []).length, 1);
  assert.equal((html.match(/Original Active Listening feedback — unchanged/g) || []).length, 1);
  assert.match(html, /Baseline Feedback/);
  assert.doesNotMatch(html, /AI Feedback/);
  assert.match(html, /Completeness · 2\/3/);
  assert.match(html, /Correctness · 3\/3/);
  const malformed = render([who({ feedback_summary: null, score_completeness: 7, score_correctness: null })]);
  assert.doesNotMatch(malformed, /Who Am I\? Feedback|Completeness ·|Correctness ·/);
});

test('malformed first score stays missing rather than selecting a better later retake', () => {
  const initial = who({ score_clarity: Infinity, score_vocabulary: '5', score_conciseness: null });
  const later = who({ id: 30, start_time: '2026-11-10T08:00:00Z', score_clarity: 3 });
  const baseline = derivePreTestBaseline([initial, later]);
  assert.equal(baseline?.sources[0].id, 10);
  assert.equal(baseline?.criteria.find(item => item.key === 'clarity'), undefined);
  const html = render([initial, later]);
  assert.doesNotMatch(html, /NaN|Infinity|>0\.0%</);
});

test('account mismatch never displays previous-user Baseline; disclosure is an inline accessible toggle', () => {
  const html = render([who(), listening()], 8, 7);
  assert.match(html, /Loading Pre-Test history/);
  assert.doesNotMatch(html, /Original Who Am I|73\.3%/);
  const own = render([who(), listening()]);
  assert.match(own, /aria-expanded="false"/);
  assert.match(own, /aria-controls="progress-baseline-feedback"/);
  assert.match(own, /id="progress-baseline-feedback" hidden=""/);
  assert.match(own, /View Strengths &amp; Improvements/);
  const source = readFileSync(new URL('../src/components/ProgressBaseline.tsx', import.meta.url), 'utf8');
  assert.match(source, /onClick=\{\(\) => setExpanded\(current => !current\)\}/);
  assert.match(source, /useEffect\(\(\) => \{ setExpanded\(false\); \}, \[userId\]\)/);
});

test('Dashboard replaces only Progress Skill Breakdown and reuses account-scoped history', () => {
  const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /<ProgressBaseline[\s\S]*?records=\{communicationHistory\}[\s\S]*?historyOwnerId=\{communicationHistoryUserId\}/);
  assert.doesNotMatch(source, /Skill Breakdown|stats\.skillBreakdown/);
  assert.match(source, /stats\.activityGroups\.map/);
  assert.match(source, /stats\.comparisonInsights\.map/);
  assert.match(source, /<ProgressDrillEvaluationSection records=\{communicationHistory\} \/>/);
  assert.match(source, /<ProgressPostTestEvaluationSection/);
});
