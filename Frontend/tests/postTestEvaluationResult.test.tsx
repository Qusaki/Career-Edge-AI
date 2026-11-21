import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PostTestEvaluationResult, type PostTestCompletionResult } from '../src/components/PostTestEvaluationResult';

const result = (): PostTestCompletionResult => ({
  total_score: 17,
  passed: true,
  feedback_summary: 'The answers show useful communication skills and some areas to develop.',
  evaluation_data: {
    schema_version: 'post-test-evaluation-v2',
    question_pack_version: 'posttest-v1',
    scoring_authority: 'semantic_ai_with_objective_caps',
    question_evaluations: Array.from({ length: 5 }, (_, index) => ({
      question_index: index + 1,
      criteria: { vocabulary: 4, clarity: 3, grammar: 4, courtesy: 3, conciseness: 3 },
      answer_relevance: 4,
      learning_evidence: 3,
      feedback: `Question ${index + 1} identifies a useful strength. Add one specific example next time.`,
      scoring_authority: 'semantic_ai_with_objective_caps' as const,
    })),
    aggregate_criteria: { vocabulary: 4, clarity: 3, grammar: 4, courtesy: 3, conciseness: 3 },
    total_score: 17,
    passed: true,
    overall_feedback: 'The answers show useful communication skills and some areas to develop.',
    recommendations: ['Support each answer with an example.', 'Practice a clearer answer structure.'],
  },
});

const render = (value: PostTestCompletionResult) => renderToStaticMarkup(
  <PostTestEvaluationResult result={value} questions={['First prompt', 'Second prompt', 'Third prompt', 'Fourth prompt', 'Fifth prompt']} onClose={() => {}} />,
);

test('authoritative Post-Test renders five ordered question cards and the complete result', () => {
  const value = result();
  value.evaluation_data!.question_evaluations.reverse();
  const html = render(value);
  assert.equal((html.match(/<article /g) || []).length, 5);
  for (let index = 1; index <= 5; index += 1) assert.match(html, new RegExp(`Question ${index}`));
  assert.ok(html.indexOf('First prompt') < html.indexOf('Fifth prompt'));
  for (const label of ['Vocabulary', 'Clarity', 'Grammar', 'Courtesy', 'Conciseness', 'Answer Relevance', 'Learning Evidence']) assert.match(html, new RegExp(label));
  assert.match(html, /17\/25/);
  assert.match(html, /Passed/);
  assert.match(html, /Question 1 identifies a useful strength/);
  assert.match(html, /Overall feedback/);
  assert.match(html, /Support each answer with an example/);
});

test('fallback result is honestly limited and has no invented semantic comments', () => {
  const value = result();
  value.passed = false;
  value.total_score = 10;
  value.evaluation_data!.scoring_authority = 'deterministic_fallback';
  value.evaluation_data!.recommendations = [];
  value.evaluation_data!.question_evaluations.forEach(item => { item.feedback = null; item.scoring_authority = 'deterministic_fallback'; });
  const html = render(value);
  assert.match(html, /10\/25/);
  assert.match(html, /Needs more practice/);
  assert.match(html, /Detailed AI feedback was unavailable/);
  assert.equal((html.match(/Detailed AI feedback is unavailable for this response/g) || []).length, 5);
  assert.doesNotMatch(html, /Question 1 identifies a useful strength/);
});

test('online completion consumes authoritative detail while offline stays pending', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const result = await response\.json\(\) as PostTestCompletionResult/);
  assert.match(source, /setCompletedResult\(\{ result, questions: completedQuestions \}\)/);
  assert.match(source, /return <PostTestEvaluationResult result=\{completedResult\.result\}/);
  assert.match(source, /Detailed question evaluation will be available after synchronization/);
  assert.doesNotMatch(source.slice(source.indexOf("const result = evaluatePostTest(currentMessages)"), source.indexOf("const token = localStorage.getItem('token');", source.indexOf("const result = evaluatePostTest(currentMessages)"))), /setCompletedResult/);
});
