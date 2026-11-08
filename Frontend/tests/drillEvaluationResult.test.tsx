import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDrillCompletionResult, DrillEvaluationResultView } from '../src/components/DrillsPage';

const source = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const drillNames = {
  jam: '30 Seconds Speaking',
  fast_word: 'Fast Word Response',
  emotion: 'Emotion Delivery',
  synonym: 'Synonym Sprint',
  fake_profile: 'Fake Profile Pitch',
  emoji_story: 'Emoji Story',
  positive_framing: 'Positive Framing',
  taboo: 'Taboo Explainer',
  elevator_pitch: 'Elevator Pitch',
  rephrase: 'Plain-Language Rephrase',
  negotiation: 'Salary Negotiation',
  crisis: 'Crisis Response',
} as const;

const scoring = {
  authority: 'semantic_ai_with_objective_caps',
  criteria: { vocabulary: 4, clarity: 3, grammar: 4, conciseness: 3, task_completion: 5, courtesy: 4 },
};
const onlinePayload = {
  score: 76.67,
  passed: true,
  feedback_summary: 'Relevant answer with a clear next step.',
  evaluation_data: JSON.stringify({ spoken_response: 'An answer', scoring }),
};
const render = (result: ReturnType<typeof createDrillCompletionResult>) =>
  renderToStaticMarkup(<DrillEvaluationResultView result={result} error={null} onDone={() => {}} />);

test('all twelve Drill types share the completed result view and display their full names', () => {
  for (const [drillType, name] of Object.entries(drillNames) as Array<[keyof typeof drillNames, string]>) {
    const html = render(createDrillCompletionResult(drillType, 'online', onlinePayload));
    assert.ok(html.includes(name), drillType);
    assert.match(html, /Evaluation complete/);
    assert.match(html, /76\.67%/);
    assert.match(html, /Relevant answer with a clear next step\./);
    assert.match(html, /Passed/);
  }
});

test('online response retains rubric criteria and labels its actual scoring authority', () => {
  const html = render(createDrillCompletionResult('jam', 'online', onlinePayload));
  assert.match(html, /Performance breakdown/);
  for (const label of ['Vocabulary', 'Clarity', 'Grammar', 'Conciseness', 'Task completion', 'Courtesy']) {
    assert.ok(html.includes(label));
  }
  assert.match(html, /AI-assisted assessment/);
  assert.match(html, /Overall score: 76\.67 percent/);
  assert.match(html, /Back to Drills/);
});

test('malformed or missing criteria cannot hide valid score and feedback', () => {
  for (const evaluation_data of ['not JSON', JSON.stringify({ scoring: { criteria: { clarity: 5 } } }), null]) {
    const html = render(createDrillCompletionResult('fast_word', 'online', { ...onlinePayload, evaluation_data }));
    assert.match(html, /76\.67%/);
    assert.match(html, /Relevant answer with a clear next step\./);
    assert.doesNotMatch(html, /Performance breakdown/);
  }
});

test('deterministic fallback is shown as a completed result, never as AI-assisted scoring', () => {
  const html = render(createDrillCompletionResult('crisis', 'online', {
    ...onlinePayload,
    passed: false,
    evaluation_data: JSON.stringify({ scoring: { ...scoring, authority: 'deterministic_fallback' } }),
  }));
  assert.match(html, /Needs more practice/);
  assert.match(html, /Evaluation source: Deterministic fallback/);
  assert.doesNotMatch(html, /AI-assisted assessment/);
});

test('offline evaluated Drill is explicitly provisional', () => {
  const html = render(createDrillCompletionResult('negotiation', 'provisional', {
    ...onlinePayload,
    scoring,
  }));
  assert.match(html, /Provisional evaluation/);
  assert.match(html, /Provisional result calculated offline/);
  assert.match(html, /may change after synchronization/);
  assert.match(html, /76\.67%/);
  assert.doesNotMatch(html, /Evaluation source: AI-assisted assessment/);
});

test('offline pending audio shows no fabricated score, feedback, or rubric', () => {
  const html = render(createDrillCompletionResult('jam', 'pending-transcription'));
  assert.match(html, /Evaluation pending/);
  assert.match(html, /after transcription and synchronization/);
  assert.doesNotMatch(html, /Overall score|Feedback|Performance breakdown|Passed/);
});

test('completion result survives session close and refresh until Back to Drills is selected', () => {
  const completion = source.slice(source.indexOf('const completeDrill = async () =>'), source.indexOf('if (completionResult)'));
  assert.match(completion, /const completedSession: DrillSession = await response\.json\(\)/);
  assert.match(completion, /setCompletionResult\(createDrillCompletionResult\(activeSession\.drill_type as DrillType, 'online', completedSession\)\)/);
  assert.match(completion, /setCompletionResult\(createDrillCompletionResult\(activeSession\.drill_type as DrillType, 'provisional', result\.evaluation\)\)/);
  assert.match(completion, /setCompletionResult\(createDrillCompletionResult\(activeSession\.drill_type as DrillType, 'pending-transcription'\)\)/);
  assert.match(source, /if \(completionResult\) \{[\s\S]*?<DrillEvaluationResultView[\s\S]*?setCompletionResult\(null\)/);
  assert.equal((source.match(/setCompletionResult\(null\)/g) ?? []).length, 1);
  assert.match(completion, /setActiveSession\(null\)[\s\S]*?await loadSessions\(\)/);
  assert.match(source, /fetch\(`\$\{apiUrl\}\/drills\/`, \{ headers \}\)[\s\S]*?fetch\(`\$\{apiUrl\}\/drills\/progress`, \{ headers \}\)/);
});

test('eye-contact presentation, recent list score policy, and duplicate completion guard remain separate', () => {
  assert.match(source, /<CameraTrackingNotice \{\.\.\.eyeTracker\} \/>/);
  assert.match(source, /if \(completionInFlightRef\.current\) return;/);
  const recent = source.slice(source.indexOf('Recent Drills'));
  assert.match(recent, /session\.status/);
  assert.doesNotMatch(recent, /session\.score|session\.feedback_summary/);
});
