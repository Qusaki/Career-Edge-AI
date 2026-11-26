import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PostTestEvaluationResult } from '../src/components/PostTestEvaluationResult';
import {
  extractPostTestHistoryPairs, fetchPostTestHistoryDetail, PostTestHistoryFetchError,
  readPostTestHistoryDisplay, readPostTestV2Evaluation,
} from '../src/utils/postTestHistory';

const criteria = () => ({ vocabulary: 4, clarity: 3, grammar: 4, courtesy: 3, conciseness: 3 });
const evaluation = () => ({
  schema_version: 'post-test-evaluation-v2', question_pack_version: 'original-pack',
  scoring_authority: 'semantic_ai_with_objective_caps',
  question_evaluations: Array.from({ length: 5 }, (_, index) => ({
    question_index: index + 1, criteria: criteria(), answer_relevance: 4,
    learning_evidence: 3, feedback: `Stored feedback ${index + 1}`,
    scoring_authority: 'semantic_ai_with_objective_caps',
  })),
  aggregate_criteria: criteria(), total_score: 17, passed: true,
  overall_feedback: 'Stored overall feedback', recommendations: ['Stored recommendation'],
});
const messages = () => Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  role: index % 2 === 0 ? 'ai' : 'user',
  content: index % 2 === 0 ? `Historical prompt ${Math.floor(index / 2) + 1}` : `Exact answer ${Math.floor(index / 2) + 1}`,
  timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
}));
const detail = () => ({
  id: 42, status: 'completed', start_time: '2025-01-01T00:00:00Z', end_time: '2025-01-02T00:00:00Z',
  total_score: 17, passed: true, feedback_summary: 'Stored overall feedback',
  score_vocabulary: 4, score_clarity: 3, score_grammar: 4, score_courtesy: 3, score_conciseness: 3,
  evaluation_data: evaluation(), messages: messages(),
});
const renderHistory = (raw = detail()) => {
  const display = readPostTestHistoryDisplay(raw, 42);
  assert.ok(display);
  return renderToStaticMarkup(<PostTestEvaluationResult
    result={display.result} questions={display.pairs.map(pair => pair.question)}
    answers={display.pairs.map(pair => pair.answer)} aggregateCriteria={display.aggregateCriteria}
    completedAt={display.completedAt} detailNotice={display.detailNotice}
    closeLabel="Back to Post-Test History" onClose={() => {}}
  />);
};

test('history parser sorts by timestamp then ID and preserves five exact persisted pairs', () => {
  const source = messages();
  source[1].timestamp = source[0].timestamp;
  const pairs = extractPostTestHistoryPairs([...source].reverse());
  assert.equal(pairs?.length, 5);
  assert.deepEqual(pairs?.[0], { question: 'Historical prompt 1', answer: 'Exact answer 1' });
  assert.deepEqual(pairs?.[4], { question: 'Historical prompt 5', answer: 'Exact answer 5' });
  assert.deepEqual(extractPostTestHistoryPairs([...source, {
    id: 11, role: 'ai', content: 'Completed all five.', timestamp: '2025-01-01T00:00:11Z',
  }]), pairs);
});

test('history parser rejects missing, blank, incorrectly paired, or additional answer messages', () => {
  assert.equal(extractPostTestHistoryPairs(messages().slice(1)), null);
  assert.equal(extractPostTestHistoryPairs(messages().slice(0, 9)), null);
  const blank = messages(); blank[3].content = '  ';
  assert.equal(extractPostTestHistoryPairs(blank), null);
  const wrongRole = messages(); wrongRole[2].role = 'user';
  assert.equal(extractPostTestHistoryPairs(wrongRole), null);
  const extra = messages(); extra.push({ id: 11, role: 'user', content: 'Sixth answer', timestamp: '2025-01-01T00:00:11Z' });
  assert.equal(extractPostTestHistoryPairs(extra), null);
});

test('V2 validation requires five unique indexed results and in-range numeric scores', () => {
  assert.ok(readPostTestV2Evaluation(evaluation()));
  const four = evaluation(); four.question_evaluations.pop();
  assert.equal(readPostTestV2Evaluation(four), null);
  const duplicate = evaluation(); duplicate.question_evaluations[4].question_index = 1;
  assert.equal(readPostTestV2Evaluation(duplicate), null);
  const missingIndex = evaluation(); missingIndex.question_evaluations[4].question_index = 6;
  assert.equal(readPostTestV2Evaluation(missingIndex), null);
  const invalid = evaluation(); invalid.question_evaluations[0].criteria.clarity = 6;
  assert.equal(readPostTestV2Evaluation(invalid), null);
  const relevance = evaluation(); relevance.question_evaluations[0].answer_relevance = 0;
  assert.equal(readPostTestV2Evaluation(relevance), null);
  assert.equal(readPostTestV2Evaluation({ ...evaluation(), schema_version: 'post-test-evaluation-v3' }), null);
});

test('history display validates identity and keeps stored total and aggregate without recomputation', () => {
  const raw = detail(); raw.total_score = 12;
  const display = readPostTestHistoryDisplay(raw, 42);
  assert.equal(display?.result.total_score, 12);
  assert.equal(display?.result.passed, true);
  assert.equal(display?.aggregateCriteria.vocabulary, 4);
  assert.equal(display?.completedAt, '2025-01-02T00:00:00Z');
  assert.equal(readPostTestHistoryDisplay(raw, 99), null);
  assert.equal(readPostTestHistoryDisplay({ ...raw, status: 'active' }, 42), null);
});

test('valid V2 history renders five stored prompts, answers, criteria, feedback, and recommendations once', () => {
  const html = renderHistory();
  assert.equal((html.match(/<article /g) || []).length, 5);
  assert.match(html, /Historical prompt 1/);
  assert.match(html, /Exact answer 5/);
  assert.match(html, /Your answer/);
  for (const label of ['Vocabulary', 'Clarity', 'Grammar', 'Courtesy', 'Conciseness', 'Answer Relevance', 'Learning Evidence']) assert.match(html, new RegExp(label));
  assert.match(html, /Stored feedback 1/);
  assert.match(html, /Stored recommendation/);
  assert.equal((html.match(/Stored overall feedback/g) || []).length, 1);
  assert.match(html, /17\/25/);
  assert.match(html, /Passed/);
  assert.match(html, /Completed/);
  assert.match(html, /Back to Post-Test History/);
  assert.match(html, /AI-assisted evaluation/);
  assert.ok(html.indexOf('Historical prompt 1') < html.indexOf('Historical prompt 5'));
});

test('legacy null result shows stored aggregate only, without invented cards', () => {
  const raw = { ...detail(), evaluation_data: null };
  const html = renderHistory(raw);
  assert.match(html, /Detailed per-question evaluation is not available/);
  assert.match(html, /17\/25/);
  assert.match(html, /Stored overall feedback/);
  assert.match(html, /Vocabulary/);
  assert.doesNotMatch(html, /<article /);
});

test('unknown and malformed V2 detail fail safely to aggregate-only views', () => {
  const unknown = renderHistory({ ...detail(), evaluation_data: { ...evaluation(), schema_version: 'post-test-evaluation-v3' } });
  assert.match(unknown, /cannot be displayed/);
  assert.doesNotMatch(unknown, /<article /);
  const invalid = detail(); invalid.messages = messages().slice(0, 9);
  const malformed = renderHistory(invalid);
  assert.match(malformed, /incomplete for this session/);
  assert.match(malformed, /17\/25/);
  assert.doesNotMatch(malformed, /<article /);
  const invalidAggregate = detail(); invalidAggregate.score_clarity = 99;
  const aggregateOnly = renderHistory(invalidAggregate);
  assert.match(aggregateOnly, /incomplete for this session/);
  assert.doesNotMatch(aggregateOnly, /<article /);
});

test('deterministic fallback history remains visibly limited without invented AI feedback', () => {
  const raw = detail();
  raw.evaluation_data.scoring_authority = 'deterministic_fallback';
  raw.evaluation_data.question_evaluations.forEach(entry => {
    entry.scoring_authority = 'deterministic_fallback'; entry.feedback = null as never;
  });
  const html = renderHistory(raw);
  assert.match(html, /Limited objective evaluation/);
  assert.match(html, /Detailed AI feedback was unavailable/);
  assert.doesNotMatch(html, /Stored feedback 1/);
});

test('detail fetch requests only the authenticated owned-session endpoint and reports HTTP errors', async () => {
  const controller = new AbortController();
  let url = ''; let auth = ''; let signal: AbortSignal | undefined;
  const request: typeof fetch = async (input, init) => {
    url = String(input); auth = String(new Headers(init?.headers).get('Authorization')); signal = init?.signal ?? undefined;
    return new Response(JSON.stringify(detail()), { status: 200 });
  };
  const raw = await fetchPostTestHistoryDetail('https://example.test', 42, 'test-token', controller.signal, request);
  assert.equal((raw as { id: number }).id, 42);
  assert.equal(url, 'https://example.test/post-test-interview/42');
  assert.equal(auth, 'Bearer test-token');
  assert.equal(signal, controller.signal);
  for (const status of [403, 404, 500]) {
    await assert.rejects(() => fetchPostTestHistoryDetail('https://example.test', 42, 'test-token', controller.signal,
      async () => new Response(null, { status })), (error: unknown) => error instanceof PostTestHistoryFetchError && error.status === status);
  }
  await assert.rejects(() => fetchPostTestHistoryDetail('https://example.test', 42, 'test-token', controller.signal,
    async () => { throw new TypeError('Network unavailable'); }), TypeError);
});

test('history action stays completed-only, score-free, and isolated from completion/start flows', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  const list = source.slice(source.indexOf('Recent Post-Tests'));
  assert.match(list, /session\.status === 'completed'/);
  assert.match(list, /View Evaluation/);
  assert.match(list, /session\.start_time/);
  assert.match(list, /session\.status/);
  assert.match(list, /Refresh/);
  assert.doesNotMatch(list, /session\.total_score/);
  assert.match(source, /historyRequestRef\.current\?\.abort\(\)/);
  assert.match(source, /generation !== historyGenerationRef\.current/);
  assert.match(source, /setSelectedHistoryId\(null\)/);
  assert.match(source, /setHistoryDetail\(null\)/);
  assert.match(source, /if \(completedResult\)[\s\S]*?if \(selectedHistoryId !== null\)/);
  assert.match(source, /if \(!effectiveOnline\)[\s\S]*?evaluation details are unavailable while offline/);
});
