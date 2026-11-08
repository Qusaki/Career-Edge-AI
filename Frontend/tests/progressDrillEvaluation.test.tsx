import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressDrillEvaluationSection } from '../src/components/ProgressDrillEvaluation';
import { getDrillTitle } from '../src/components/DrillsPage';
import { buildActivityComparison, getNormalizedActivityScore, getProgressDrillEvaluations } from '../src/utils/analytics';

const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const drillsSource = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const sectionSource = readFileSync(new URL('../src/components/ProgressDrillEvaluation.tsx', import.meta.url), 'utf8');

const criteria = { vocabulary: 4, clarity: 3, grammar: 4, conciseness: 3, task_completion: 5, courtesy: 4 };
const completedDrill = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 12,
  _source: 'drills',
  status: 'completed',
  drill_type: 'jam',
  end_time: '2026-11-08T08:00:00Z',
  score: 76.67,
  passed: true,
  feedback_summary: 'The response addressed the assigned topic.',
  evaluation_data: JSON.stringify({ scoring: { authority: 'semantic_ai_with_objective_caps', criteria } }),
  ...overrides,
});
const render = (records: Array<Record<string, unknown>>) =>
  renderToStaticMarkup(<ProgressDrillEvaluationSection records={records} />);

test('Progress shows the latest completed authoritative Drill evaluation and lets users choose recent results', () => {
  const html = render([
    completedDrill({ id: 11, drill_type: 'fast_word', score: 40, end_time: '2026-11-07T08:00:00Z' }),
    completedDrill(),
  ]);
  assert.match(dashboardSource, /<ProgressDrillEvaluationSection records=\{communicationHistory\} \/>/);
  assert.match(dashboardSource, /fetch\(`\$\{API_URL\}\/drills\/`,/);
  assert.match(html, /Drill Evaluation/);
  assert.match(html, /30 Seconds Speaking/);
  assert.match(html, /Overall score: 76\.67 percent/);
  assert.match(html, /Choose a completed Drill/);
  assert.match(html, /Fast Word Response/);
  assert.match(sectionSource, /onChange=\{event => setSelectedId\(Number\(event\.target\.value\)\)\}/);
});

test('zero scores and explicit pass states remain visible', () => {
  const failed = render([completedDrill({ score: 0, passed: false })]);
  assert.match(failed, /Overall score: 0 percent/);
  assert.match(failed, /0%/);
  assert.match(failed, /Needs more practice/);
  assert.match(render([completedDrill()]), /Passed/);
});

test('feedback and six validated rubric criteria render without invented descriptions', () => {
  const html = render([completedDrill()]);
  assert.match(html, /The response addressed the assigned topic\./);
  assert.match(html, /Performance breakdown/);
  for (const label of ['Vocabulary', 'Clarity', 'Grammar', 'Conciseness', 'Task completion', 'Courtesy']) {
    assert.ok(html.includes(label), label);
  }
  assert.doesNotMatch(html, /Strengths|Weaknesses|Confidence/);
});

test('malformed or missing evaluation data cannot hide valid score and feedback', () => {
  for (const evaluation_data of ['not JSON', null, JSON.stringify({ scoring: { criteria: { clarity: 5 } } })]) {
    const html = render([completedDrill({ evaluation_data })]);
    assert.match(html, /76\.67%/);
    assert.match(html, /The response addressed the assigned topic\./);
    assert.doesNotMatch(html, /Performance breakdown/);
  }
  const missing = render([completedDrill({ passed: null, feedback_summary: null, evaluation_data: '{' })]);
  assert.match(missing, /Result unavailable/);
  assert.match(missing, /No detailed feedback is available for this Drill/);
});

test('stored fallback authority is not presented as AI scoring', () => {
  const fallback = render([completedDrill({
    evaluation_data: JSON.stringify({ scoring: { authority: 'deterministic_fallback', criteria } }),
  })]);
  assert.match(fallback, /Evaluation source: Deterministic fallback/);
  assert.doesNotMatch(fallback, /AI-assisted assessment/);
  assert.match(render([completedDrill()]), /Evaluation source: AI-assisted assessment/);
  assert.doesNotMatch(render([completedDrill({ evaluation_data: null })]), /Evaluation source:/);
});

test('all twelve Drill IDs use the existing full user-facing titles', () => {
  const names = {
    jam: '30 Seconds Speaking', fast_word: 'Fast Word Response', emotion: 'Emotion Delivery',
    synonym: 'Synonym Sprint', fake_profile: 'Fake Profile Pitch', emoji_story: 'Emoji Story',
    positive_framing: 'Positive Framing', taboo: 'Taboo Explainer', elevator_pitch: 'Elevator Pitch',
    rephrase: 'Plain-Language Rephrase', negotiation: 'Salary Negotiation', crisis: 'Crisis Response',
  };
  for (const [drillType, title] of Object.entries(names)) {
    assert.equal(getDrillTitle(drillType), title);
    assert.match(render([completedDrill({ drill_type: drillType })]), new RegExp(title));
  }
});

test('department does not filter an authenticated completed Drill result', () => {
  for (const department of ['CCIT', 'CTE', 'CBAPA']) {
    assert.match(render([completedDrill({ department })]), /30 Seconds Speaking/);
  }
  assert.doesNotMatch(sectionSource, /userDepartment|profile\.department/);
});

test('unsynced local results stay out, while an authoritative synced backend session appears', () => {
  const provisional = completedDrill({ id: 10, status: 'completed_local', score: 99 });
  const pending = completedDrill({ id: 11, status: 'pending_sync', score: 99 });
  assert.equal(getProgressDrillEvaluations([provisional, pending]).length, 0);
  assert.match(render([provisional, pending]), /Complete a Drill to see your detailed evaluation here/);
  assert.match(render([provisional, pending, completedDrill()]), /76\.67%/);
  assert.match(dashboardSource, /if \(synchronized <= 0\) return;[\s\S]*?fetchCommunicationHistory\(authenticatedUserId\)/);
});

test('no scored completed Drill shows a compact empty state', () => {
  assert.match(render([]), /Complete a Drill to see your detailed evaluation here/);
  assert.match(render([completedDrill({ score: null })]), /Complete a Drill to see your detailed evaluation here/);
});

test('existing aggregate, Eye Contact, and Recent Drills policies are unchanged', () => {
  const record = completedDrill({ score: 0 });
  assert.equal(getNormalizedActivityScore(record), 0);
  assert.equal(buildActivityComparison('Drills', [record]).current, 0);
  assert.match(dashboardSource, /const allScoredActivities = completedActivities[\s\S]*?\.map\(item => getNormalizedActivityScore\(item\)\)/);
  assert.match(dashboardSource, /\{ label: 'Drills', records: completedModules\.filter\(item => item\._source === 'drills'\) \}/);
  assert.match(dashboardSource, /buildActivityComparison\([\s\S]*?'Drills',[\s\S]*?completedModules\.filter\(item => item\._source === 'drills'\)/);
  assert.match(dashboardSource, /const scoredCommunication = completedModules\.filter\(item => item\._source !== 'drills'\)/);
  assert.match(dashboardSource, /const cameraRecords = \[[\s\S]*?\.\.\.completedModules,[\s\S]*?eye_contact_samples[\s\S]*?score_eye_contact/);
  const recent = drillsSource.slice(drillsSource.indexOf('Recent Drills'));
  assert.doesNotMatch(recent, /session\.score|session\.feedback_summary|session\.evaluation_data/);
});

test('section has a labelled selector and responsive, non-fixed-width rubric rows', () => {
  assert.match(render([completedDrill(), completedDrill({ id: 13 })]), /<label for="progress-drill-evaluation-select"/);
  assert.match(sectionSource, /grid gap-2 sm:grid-cols-2/);
  assert.match(sectionSource, /min-w-0/);
  assert.doesNotMatch(sectionSource, /min-w-\[|w-\[[0-9]+px\]/);
});
