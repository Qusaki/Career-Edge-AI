import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProgressPostTestEvaluationSection, getProgressPostTestSessions } from '../src/components/ProgressPostTestEvaluation';
import { PostTestEvaluationResult } from '../src/components/PostTestEvaluationResult';
import { readPostTestHistoryDisplay } from '../src/utils/postTestHistory';

const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const sectionSource = readFileSync(new URL('../src/components/ProgressPostTestEvaluation.tsx', import.meta.url), 'utf8');
const resultSource = readFileSync(new URL('../src/components/PostTestEvaluationResult.tsx', import.meta.url), 'utf8');

const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  _source: 'post-test-interview', id: 12, status: 'completed',
  end_time: '2026-11-10T08:00:00Z', passed: true, total_score: 17,
  ...overrides,
});
const renderSection = (records: Record<string, unknown>[], historyState: 'idle' | 'loading' | 'ready' | 'error' = 'ready') =>
  renderToStaticMarkup(<ProgressPostTestEvaluationSection records={records} historyState={historyState}
    historyOwnerId={7} userId={7} apiUrl="https://example.test" effectiveOnline />);

const criteria = () => ({ vocabulary: 4, clarity: 3, grammar: 4, courtesy: 3, conciseness: 3 });
const storedDetail = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 12, status: 'completed', end_time: '2026-11-10T08:00:00Z',
  total_score: 17, passed: true, feedback_summary: 'Stored overall feedback',
  score_vocabulary: 4, score_clarity: 3, score_grammar: 4, score_courtesy: 3, score_conciseness: 3,
  messages: Array.from({ length: 10 }, (_, index) => ({
    id: index + 1, role: index % 2 === 0 ? 'ai' : 'user',
    content: index % 2 === 0 ? `Stored historical question ${Math.floor(index / 2) + 1}` : `Exact committed answer ${Math.floor(index / 2) + 1}`,
    timestamp: new Date(Date.UTC(2026, 10, 10, 8, 0, index)).toISOString(),
  })),
  evaluation_data: {
    schema_version: 'post-test-evaluation-v2', question_pack_version: 'stored-pack',
    scoring_authority: 'semantic_ai_with_objective_caps',
    question_evaluations: Array.from({ length: 5 }, (_, index) => ({
      question_index: index + 1, criteria: criteria(), answer_relevance: 4,
      learning_evidence: 3, feedback: `Stored question feedback ${index + 1}`,
      scoring_authority: 'semantic_ai_with_objective_caps',
    })),
    aggregate_criteria: criteria(), total_score: 17, passed: true,
    overall_feedback: 'Stored overall feedback', recommendations: ['Stored recommendation'],
  },
  ...overrides,
});
const renderEmbedded = (raw: Record<string, unknown>) => {
  const display = readPostTestHistoryDisplay(raw, 12);
  assert.ok(display);
  return renderToStaticMarkup(<PostTestEvaluationResult embedded result={display.result}
    questions={display.pairs.map(pair => pair.question)} answers={display.pairs.map(pair => pair.answer)}
    aggregateCriteria={display.aggregateCriteria} completedAt={display.completedAt}
    detailNotice={display.detailNotice} />);
};

test('Progress places a separate Post-Test Evaluation after unchanged Drill Evaluation', () => {
  assert.ok(dashboardSource.indexOf('<ProgressDrillEvaluationSection records={communicationHistory} />')
    < dashboardSource.indexOf('<ProgressPostTestEvaluationSection'));
  assert.ok(dashboardSource.indexOf('<ProgressPostTestEvaluationSection') < dashboardSource.indexOf('Skill Breakdown'));
  assert.match(dashboardSource, /records=\{communicationHistory\}[\s\S]*?historyOwnerId=\{communicationHistoryUserId\}/);
  assert.match(dashboardSource, /fetch\(`\$\{API_URL\}\/post-test-interview\/`,/);
  assert.doesNotMatch(sectionSource, /post-test-interview\/`|post-test-interview\/\$/);
  assert.match(renderSection([]), /Post-Test Evaluation/);
});

test('only completed server Post-Tests, including failed and legacy, enter the selector', () => {
  const eligible = getProgressPostTestSessions([
    record({ id: 1, passed: true }), record({ id: 2, passed: false, evaluation_data: null }),
    record({ id: 3, status: 'active' }), record({ id: 4, status: 'in_progress' }),
    record({ id: 5, status: 'completed_local' }), record({ id: 6, status: 'pending_sync' }),
    record({ id: 7, _source: 'drills' }), record({ id: 'local-id' }),
  ]);
  assert.deepEqual(eligible.map(item => item.id), [2, 1]);
  assert.equal(eligible[0].passed, false);
});

test('completed sessions sort by valid completion time, ID tie-break, then cap at eight', () => {
  const records = Array.from({ length: 12 }, (_, index) => record({ id: index + 1,
    end_time: index === 0 ? 'invalid' : index <= 2 ? '2026-11-11T08:00:00Z' : `2026-11-${String(index + 11).padStart(2, '0')}T08:00:00Z`,
  }));
  const sessions = getProgressPostTestSessions(records);
  assert.equal(sessions.length, 8);
  assert.deepEqual(sessions.slice(0, 3).map(item => item.id), [12, 11, 10]);
  assert.deepEqual(getProgressPostTestSessions([
    record({ id: 2, end_time: '2026-11-11T08:00:00Z' }),
    record({ id: 3, end_time: '2026-11-11T08:00:00Z' }),
  ]).map(item => item.id), [3, 2]);
  assert.equal(getProgressPostTestSessions([record({ id: 3 }), record({ id: 4 })])[0].id, 4);
});

test('latest completed is the default selected session; selector is labeled and narrow-screen friendly', () => {
  const html = renderSection([
    record({ id: 4, end_time: '2026-11-09T08:00:00Z', passed: false }),
    record({ id: 8, end_time: '2026-11-11T08:00:00Z' }),
  ]);
  assert.match(html, /Post-Test Session/);
  assert.match(html, /<option value="8" selected=""/);
  assert.match(html, /min-w-0 sm:max-w-xs/);
  assert.match(html, /Needs more practice/);
  assert.match(html, /Passed/);
});

test('empty, loading, and list failure remain scoped to the Post-Test section', () => {
  assert.match(renderSection([]), /No completed Post-Test evaluation is available yet/);
  assert.match(renderSection([], 'loading'), /Loading Post-Test history/);
  assert.match(renderSection([], 'error'), /Post-Test history could not be loaded/);
  assert.doesNotMatch(renderSection([]), /Get Started|0\/25/);
});

test('embedded V2 reuses stored five-card result without a second page heading or Back action', () => {
  const html = renderEmbedded(storedDetail());
  assert.equal((html.match(/<article /g) || []).length, 5);
  assert.match(html, /Stored historical question 1/);
  assert.match(html, /Exact committed answer 5/);
  assert.match(html, /Stored question feedback 1/);
  for (const label of ['Vocabulary', 'Clarity', 'Grammar', 'Courtesy', 'Conciseness', 'Answer Relevance', 'Learning Evidence']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /17\/25/);
  assert.match(html, /Passed/);
  assert.match(html, /Completed/);
  assert.match(html, /Stored recommendation/);
  assert.match(html, /AI-assisted evaluation/);
  assert.equal((html.match(/Stored overall feedback/g) || []).length, 1);
  assert.doesNotMatch(html, /Back to Post-Test|<h1/);
  assert.match(html, /<h4[^>]*>Question 1<\/h4>/);
  assert.match(html, /whitespace-pre-wrap break-words/);
});

test('Progress shows stored total, pass, and aggregate exactly, not recomputed question values', () => {
  const raw = storedDetail({ total_score: 12, passed: false, score_vocabulary: 2 });
  const html = renderEmbedded(raw);
  assert.match(html, /12\/25/);
  assert.match(html, /Needs more practice/);
  assert.match(html, /Vocabulary<\/span> <strong>2\/5/);
  assert.match(html, /Stored recommendation/);
});

test('legacy, malformed, unsupported, and fallback detail use shared safe presentation', () => {
  const legacy = renderEmbedded(storedDetail({ evaluation_data: null }));
  assert.match(legacy, /Detailed per-question evaluation is not available/);
  assert.match(legacy, /17\/25/);
  assert.doesNotMatch(legacy, /<article /);
  const malformed = storedDetail({ messages: [] });
  assert.match(renderEmbedded(malformed), /incomplete for this session/);
  assert.doesNotMatch(renderEmbedded(malformed), /<article /);
  const unsupported = storedDetail({ evaluation_data: { schema_version: 'future-v3' } });
  assert.match(renderEmbedded(unsupported), /cannot be displayed/);
  const fallback = storedDetail();
  const evaluation = fallback.evaluation_data as Record<string, unknown>;
  evaluation.scoring_authority = 'deterministic_fallback';
  evaluation.question_evaluations = (evaluation.question_evaluations as Array<Record<string, unknown>>).map(item => ({
    ...item, scoring_authority: 'deterministic_fallback', feedback: null,
  }));
  const fallbackHtml = renderEmbedded(fallback);
  assert.match(fallbackHtml, /Detailed AI feedback was unavailable/);
  assert.match(fallbackHtml, /Limited objective evaluation/);
  assert.doesNotMatch(fallbackHtml, /Stored question feedback 1/);
});

test('detail uses authenticated owned endpoint with scoped state and stale-request guards', () => {
  assert.match(sectionSource, /fetchPostTestHistoryDetail\(apiUrl, selected\.id, token, controller\.signal\)/);
  assert.match(sectionSource, /readPostTestHistoryDisplay\(raw, selected\.id\)/);
  assert.match(sectionSource, /controller\.signal\.aborted \|\| generation !== requestGenerationRef\.current/);
  assert.match(sectionSource, /return \(\) => \{ controller\.abort\(\); requestGenerationRef\.current \+= 1; \}/);
  assert.match(sectionSource, /historyOwnerId === userId \? records : \[\]/);
  assert.match(sectionSource, /setSelectedId\(null\);[\s\S]*?detailRef\.current = null/);
  assert.match(sectionSource, /details are unavailable while offline/);
  assert.match(sectionSource, /role="alert"/);
  assert.match(sectionSource, /role="status"/);
  assert.doesNotMatch(sectionSource, /\/complete|score_post_test|evaluatePostTest|generate|provider|startPostTest/);
  assert.match(resultSource, /embedded = false/);
});
