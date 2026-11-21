import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardEvaluationSummarySection } from '../src/components/DashboardEvaluationSummary';
import { bandForPercentage, deriveDashboardEvaluationSummary } from '../src/utils/dashboardEvaluationSummary';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const intro = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1, _source: 'pre-test-intro', status: 'completed', end_time: '2026-11-01T09:00:00Z',
  score_vocabulary: 4, score_clarity: 2, score_grammar: 3, score_conciseness: 2,
  score_courtesy: 3, score_completeness: 3, score_correctness: 3,
  total_score: 13, feedback_summary: 'Introduction feedback.', ...overrides,
});
const listening = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 2, _source: 'pre-test-active-listening', status: 'completed', end_time: '2026-11-02T09:00:00Z',
  score_vocabulary: 4, score_clarity: 3, score_grammar: 4, score_conciseness: 3, score_courtesy: 4,
  total_score: 18, feedback_summary: 'Listening feedback.', ...overrides,
});
const drill = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 3, _source: 'drills', status: 'completed', end_time: '2026-11-03T09:00:00Z',
  drill_type: 'jam', score: 74, passed: true, feedback_summary: 'Drill feedback.',
  evaluation_data: JSON.stringify({ scoring: {
    authority: 'semantic_ai_with_objective_caps', criteria: {
      vocabulary: 4, clarity: 3.7, grammar: 4, conciseness: 3, task_completion: 3.5, courtesy: 4,
    },
  } }), ...overrides,
});
const post = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 4, _source: 'post-test-interview', status: 'completed', end_time: '2026-11-04T09:00:00Z',
  score_vocabulary: 4, score_clarity: 4, score_grammar: 3, score_conciseness: 4, score_courtesy: 4,
  total_score: 19, feedback_summary: 'Post-Test feedback.', ...overrides,
});
const criterion = (records: Record<string, unknown>[], key: string) =>
  deriveDashboardEvaluationSummary(records)?.criteria.find(item => item.key === key);
const render = (records: Record<string, unknown>[], state: 'ready' | 'loading' | 'error' = 'ready') =>
  renderToStaticMarkup(<DashboardEvaluationSummarySection
    summary={deriveDashboardEvaluationSummary(records)} historyState={state}
    onStartPreTest={() => {}} onRetry={() => {}}
  />);

test('only four allowlisted source tags contribute; interviews and Maxiel never enter coverage or feedback', () => {
  const excluded = ['upcoming', 'thesis', 'interview-practice', 'enrollment-interview', 'maxiel'];
  const interviews = excluded.map((source, index) => post({
    id: 100 + index, _source: source, score_clarity: 5,
    end_time: '2026-12-01T09:00:00Z', feedback_summary: `SECRET ${source} feedback`,
  }));
  assert.equal(deriveDashboardEvaluationSummary(interviews), null);
  const summary = deriveDashboardEvaluationSummary([intro(), listening(), drill(), post(), ...interviews]);
  assert.deepEqual(summary?.families, ['Pre-Test', 'Drills', 'Post-Test']);
  assert.equal(summary?.latestFeedback?.text, 'Post-Test feedback.');
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|Maxiel|Enrollment|Thesis/);
  assert.equal(criterion([intro()], 'clarity')?.percentage, 66.7);
  assert.equal(criterion([listening()], 'clarity')?.percentage, 60);
  assert.equal(criterion([drill()], 'clarity')?.percentage, 74);
  assert.equal(criterion([post()], 'clarity')?.percentage, 80);
});

test('latest valid completed subtype uses end_time then ID; invalid newer result is skipped', () => {
  const records = [
    intro({ id: 10, score_clarity: 1, end_time: '2026-11-05T09:00:00Z' }),
    intro({ id: 11, score_clarity: 3, end_time: '2026-11-05T09:00:00Z' }),
    intro({ id: 12, score_clarity: 5, score_vocabulary: 0, score_grammar: 0,
      score_conciseness: 0, score_courtesy: 0, end_time: '2026-11-06T09:00:00Z' }),
    listening({ id: 20, score_clarity: 1 }), listening({ id: 21, score_clarity: 5 }),
    drill({ id: 30, evaluation_data: '{' }), drill({ id: 31, score: 74 }),
    post({ id: 40, score_clarity: 1 }), post({ id: 41, score_clarity: 5 }),
  ];
  const summary = deriveDashboardEvaluationSummary(records);
  assert.equal(summary?.criteria.find(item => item.key === 'clarity')?.percentage, 91.3);
  assert.equal(summary?.completedAt, '2026-11-05T09:00:00Z');
});

test('native scales normalize independently and do not mutate records', () => {
  const records = [intro(), listening(), drill(), post()];
  const before = JSON.stringify(records);
  assert.equal(criterion([intro()], 'vocabulary')?.percentage, 80);
  assert.equal(criterion([intro()], 'clarity')?.percentage, 66.7);
  assert.equal(criterion([drill()], 'clarity')?.percentage, 74);
  assert.equal(criterion([post()], 'clarity')?.percentage, 80);
  assert.equal(criterion(records, 'clarity')?.percentage, 72.5);
  assert.equal(JSON.stringify(records), before);
});

test('Pre-Test subtypes combine within one family, then three available families have equal weight', () => {
  const manyOldDrills = Array.from({ length: 20 }, (_, index) => drill({
    id: 100 + index, end_time: '2026-10-01T09:00:00Z',
    evaluation_data: drill({}).evaluation_data,
  }));
  const records = [intro(), listening(), drill(), post(), ...manyOldDrills];
  const clarity = criterion(records, 'clarity');
  assert.deepEqual(clarity?.families, ['Pre-Test', 'Drills', 'Post-Test']);
  assert.equal(clarity?.percentage, 72.5);
  assert.equal(criterion([intro(), drill()], 'clarity')?.percentage, 70.4);
  assert.deepEqual(criterion([intro(), drill()], 'clarity')?.families, ['Pre-Test', 'Drills']);
});

test('five shared criteria are present; Task Completion comes only from a valid Drill', () => {
  const summary = deriveDashboardEvaluationSummary([intro(), listening(), drill(), post()]);
  assert.deepEqual(summary?.criteria.map(item => item.key), [
    'vocabulary', 'clarity', 'grammar', 'conciseness', 'courtesy', 'task_completion',
  ]);
  const task = criterion([intro(), listening(), drill(), post()], 'task_completion');
  assert.equal(task?.percentage, 70);
  assert.deepEqual(task?.families, ['Drills']);
  assert.equal(criterion([intro({ score_completeness: 3, score_correctness: 1 }), post()], 'task_completion'), undefined);
});

test('deterministic score bands give restrained guidance and overall strongest/lowest feedback', () => {
  assert.equal(bandForPercentage(80), 'Strong');
  assert.equal(bandForPercentage(65), 'Developing well');
  assert.equal(bandForPercentage(50), 'Needs more focus');
  assert.equal(bandForPercentage(49.9), 'Priority area');
  const summary = deriveDashboardEvaluationSummary([intro(), listening(), drill(), post()]);
  assert.match(summary?.overallFeedback ?? '', /stronger supported area.*needs the most attention/);
  for (const item of summary?.criteria ?? []) {
    assert.match(item.comment, /Your recent results suggest/);
    assert.doesNotMatch(item.comment, /you said|your transcript|specific phrase/i);
  }
});

test('loading and fetch errors never masquerade as Get Started; genuinely empty history does', () => {
  assert.match(render([]), /Get Started/);
  assert.match(render([]), /Start Pre-Test/);
  assert.match(render([post({ _source: 'thesis' })]), /Get Started/);
  assert.doesNotMatch(render([], 'loading'), /Get Started/);
  assert.match(render([], 'loading'), /Loading your current evaluation/);
  assert.doesNotMatch(render([], 'error'), /Get Started/);
  assert.match(render([], 'error'), /evaluation is unavailable/);
  assert.match(render([intro()], 'error'), /Showing the last loaded evaluation/);
  assert.equal(deriveDashboardEvaluationSummary([intro({ total_score: null })]), null);
});

test('completed failures and later remediation Drills contribute; provisional statuses do not', () => {
  const failed = drill({ id: 9, passed: false, score: 40, end_time: '2026-11-09T09:00:00Z',
    evaluation_data: JSON.stringify({ scoring: { authority: 'semantic_ai_with_objective_caps', criteria: {
      vocabulary: 2, clarity: 2, grammar: 2, conciseness: 2, task_completion: 2, courtesy: 2,
    } } }),
  });
  assert.equal(criterion([failed], 'clarity')?.percentage, 40);
  const later = drill({ id: 10, end_time: '2026-11-10T09:00:00Z', evaluation_data: JSON.stringify({
    scoring: { criteria: { clarity: 5 }, authority: 'semantic_ai_with_objective_caps' },
  }) });
  assert.equal(criterion([failed, later], 'clarity')?.percentage, 100);
  for (const status of ['completed_local', 'pending_sync', 'pending_transcription', 'syncing', 'sync_failed']) {
    assert.equal(deriveDashboardEvaluationSummary([drill({ status })]), null);
  }
  assert.equal(deriveDashboardEvaluationSummary([drill({ evaluation_data: null })]), null);
  assert.equal(deriveDashboardEvaluationSummary([drill()])?.families[0], 'Drills');
});

test('Drill authority labels fallback; valid integer legacy rubrics and malformed fields are safe', () => {
  const fallback = drill({ evaluation_data: JSON.stringify({ scoring: {
    authority: 'deterministic_fallback', criteria: {
      vocabulary: 2, clarity: 2, grammar: 2, conciseness: 2, task_completion: 1, courtesy: 4,
    },
  } }) });
  assert.equal(deriveDashboardEvaluationSummary([fallback])?.drillAuthority, 'deterministic_fallback');
  assert.match(render([fallback]), /limited deterministic fallback scoring/);
  assert.equal(deriveDashboardEvaluationSummary([drill()])?.drillAuthority, 'semantic_ai_with_objective_caps');
  const malformed = drill({ evaluation_data: JSON.stringify({ scoring: {
    criteria: { vocabulary: '5', clarity: 3.75, grammar: 4, conciseness: 3, task_completion: 2, courtesy: 3 },
  } }) });
  assert.equal(criterion([malformed], 'vocabulary'), undefined);
  assert.equal(criterion([malformed], 'clarity'), undefined);
  assert.equal(criterion([malformed], 'grammar')?.percentage, 80);
});

test('rendered section shows coverage, as-of, criterion guidance and feedback without fixed horizontal layout', () => {
  const html = render([intro(), listening(), drill(), post()]);
  assert.match(html, /Current Evaluation/);
  assert.match(html, /Based on: Pre-Test \+ Drills \+ Post-Test/);
  assert.match(html, /Updated/);
  assert.match(html, /Overall Feedback/);
  assert.match(html, /Latest Evaluation Feedback/);
  assert.match(html, /Post-Test feedback/);
  assert.match(html, /Task Completion/);
  assert.match(html, /Task Completion[\s\S]*?Based on: Drills/);
  assert.match(html, /grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(render([intro()]), /Task Completion/);
});

test('Dashboard keeps original cards and onboarding anchor, and refreshes on completed online return', () => {
  const cards = dashboard.indexOf('{renderStatCards()}');
  const section = dashboard.indexOf('<DashboardEvaluationSummarySection', cards);
  const history = dashboard.indexOf('{/* History List */}', cards);
  assert.ok(cards >= 0 && section > cards && history > section);
  assert.match(dashboard, /<div data-onboarding="summary" className="grid w-full grid-cols-1 md:grid-cols-3 gap-2\.5"/);
  assert.match(dashboard, /if \(outcome === 'cloud_completed'\) assessmentHistoryNeedsRefreshRef\.current = true/);
  assert.match(dashboard, /if \(activeTab !== 'dashboard' \|\| !authenticatedUserId \|\| !assessmentHistoryNeedsRefreshRef\.current\) return/);
  assert.match(dashboard, /void fetchCommunicationHistory\(authenticatedUserId\)/);
  assert.match(dashboard, /if \(synchronized <= 0\) return;[\s\S]*?fetchCommunicationHistory\(authenticatedUserId\)/);
  assert.match(dashboard, /summary=\{currentEvaluation\}/);
  assert.doesNotMatch(dashboard.slice(cards, history), /interviewHistory|thesisHistory/);
});
