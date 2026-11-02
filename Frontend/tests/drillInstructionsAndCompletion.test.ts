import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { claimDrillCompletion, DrillCompletionPerfTrace, drillCompletionPerfEnabled } from '../src/components/DrillsPage';

const source = readFileSync(
  new URL('../src/components/DrillsPage.tsx', import.meta.url),
  'utf8',
);

const drillTypes = [
  'jam',
  'fast_word',
  'emotion',
  'synonym',
  'fake_profile',
  'emoji_story',
  'positive_framing',
  'taboo',
  'elevator_pitch',
  'rephrase',
  'negotiation',
  'crisis',
] as const;

test('all twelve supported Drill types have typed non-empty task instructions', () => {
  assert.match(source, /const drillTaskInstructions: Record<DrillType, DrillInstruction>/);
  for (const drillType of drillTypes) {
    assert.match(source, new RegExp(`${drillType}: \\{[\\s\\S]*?task: '[^']+'[\\s\\S]*?howToAnswer: '[^']+'`));
  }
});

test('active instructions depend only on Drill type and work online or offline', () => {
  assert.match(source, /getDrillInstruction\(activeSession\.drill_type\)/);
  const registryStart = source.indexOf('const drillTaskInstructions');
  const registryEnd = source.indexOf('const promptFieldLabels', registryStart);
  const registry = source.slice(registryStart, registryEnd);
  assert.doesNotMatch(registry, /effectiveOnline|sessionMode|apiUrl|fetch\(/);
});

test('only an explicitly offline checkpoint can restore a local Drill identity', () => {
  assert.match(source, /resumeSession\.mode !== 'offline'/);
  assert.match(source, /activeOfflineClientSessionIdRef\.current = resumeSession\.clientSessionId/);
});

test('the active Drill shows prompt and task before secondary guidance', () => {
  assert.match(source, /aria-label="Drill supporting instructions"/);
  assert.match(source, />Task<\/p>/);
  assert.match(source, />How to answer<\/p>/);
  assert.match(source, />Answer format<\/p>/);
  assert.match(source, /divide-y divide-line/);
  const guidanceStart = source.indexOf('aria-label="Drill supporting instructions"');
  const guidanceEnd = source.indexOf('</section>', guidanceStart);
  assert.doesNotMatch(source.slice(guidanceStart, guidanceEnd), /grid-cols|col-span/);
});

test('timer, prompt, task, response flow, completion, and supporting guidance follow the intended order', () => {
  const activeSessionStart = source.indexOf('if (activeSession)');
  const timerIndex = source.indexOf('role="timer"', activeSessionStart);
  const promptIndex = source.indexOf('>Prompt</p>', timerIndex);
  const taskIndex = source.indexOf('>Task</p>', promptIndex);
  const statusIndex = source.indexOf('<SoundWaveInterviewer', taskIndex);
  const responseIndex = source.indexOf("activeSession.drill_type === 'negotiation'", statusIndex);
  const completeIndex = source.indexOf('onClick={completeDrill}', responseIndex);
  const guidanceIndex = source.indexOf('aria-label="Drill supporting instructions"', completeIndex);
  assert.ok(timerIndex >= 0 && promptIndex > timerIndex && taskIndex > promptIndex && statusIndex > taskIndex);
  assert.ok(responseIndex > statusIndex && completeIndex > responseIndex && guidanceIndex > completeIndex);
});

test('supporting guidance reads How to answer, Answer format, then Automatic scoring', () => {
  const instructionsStart = source.indexOf('aria-label="Drill supporting instructions"');
  const instructionMarkup = source.slice(instructionsStart);
  const howIndex = instructionMarkup.indexOf('>How to answer</p>');
  const formatIndex = instructionMarkup.indexOf('>Answer format</p>');
  const scoringIndex = instructionMarkup.indexOf('>Automatic scoring</p>');
  assert.ok(howIndex >= 0 && formatIndex > howIndex && scoringIndex > formatIndex);
  assert.match(instructionMarkup, /bg-card\/50 px-4 py-2\.5/);
  assert.doesNotMatch(instructionMarkup, /w-\[[^\]]+\]|min-w-\[[^\]]+\]/);
});

test('task directions and automatic scoring transparency remain visibly separate', () => {
  assert.match(source, />Automatic scoring<\/p>/);
  assert.match(source, /Practice goal: Follow the task directions as closely as possible\./);
  assert.doesNotMatch(source, /Practice goal: follow the task directions as closely as possible\./);
  assert.match(source, /response completion and speaking length/);
  assert.match(source, /completed conversation turns/);
  assert.match(source, /const activeScoringNote = getDrillScoringNote\(activeSession\.drill_type\)/);
});

test('task copy is framed as practice rather than a semantic scoring guarantee', () => {
  const registryStart = source.indexOf('const drillTaskInstructions');
  const registryEnd = source.indexOf('const promptFieldLabels', registryStart);
  const registry = source.slice(registryStart, registryEnd);
  assert.doesNotMatch(registry, /You will be scored|Required for score|This will count if|You need to|must/i);
  for (const drillType of drillTypes) {
    assert.match(registry, new RegExp(`${drillType}: \\{[\\s\\S]*?task: 'Practice`));
  }
});

test('canonical prompt fields use explicit user-facing labels', () => {
  for (const label of [
    'Topic', 'Target word', 'Sentence', 'Target emotion', 'Name', 'Age', 'Job', 'Hobby',
    'Emojis', 'Situation', 'Forbidden words', 'Scenario', 'Instructions', 'Text to rephrase',
    'Questions to address',
  ]) {
    assert.match(source, new RegExp(`'${label}'`));
  }
  assert.match(source, /promptFieldLabels\[key\]/);
  assert.match(source, /whitespace-pre-wrap break-words/);
});

test('offline UUID identity cannot be sent to the integer completion path', () => {
  assert.match(source, /resolveDrillSessionExecution\(\{/);
  assert.match(source, /if \(execution\.mode === 'offline'\) \{/);
  assert.match(source, /if \(execution\.mode === 'invalid'\) \{/);
  assert.match(source, /fetch\(`\$\{apiUrl\}\/drills\/\$\{serverSessionId\}\/complete`/);
  assert.doesNotMatch(source, /parseInt\(|parseFloat\(/);
});

test('completion sends numeric camera values and never mixes Fake Profile age into result metadata', () => {
  assert.match(source, /eye_contact_score: eyeContactScore/);
  assert.match(source, /eye_contact_samples: eyeContactSummary\.samples/);
  const completionStart = source.indexOf("const token = localStorage.getItem('token')", source.indexOf('const completeDrill'));
  const completionEnd = source.indexOf('if (activeSession)', completionStart);
  const completion = source.slice(completionStart, completionEnd);
  assert.doesNotMatch(completion, /canonical_prompt|\.age|activePrompt/);
});

test('failed online save retains the active response and remains retryable', () => {
  const failureCheck = source.indexOf('if (!response.ok)', source.indexOf('const completeDrill'));
  const successClear = source.indexOf('setActiveSession(null)', failureCheck);
  const catchBlock = source.indexOf('} catch (err)', failureCheck);
  assert.ok(failureCheck >= 0 && successClear > failureCheck && catchBlock > successClear);
  assert.match(source.slice(catchBlock, source.indexOf('} finally', catchBlock)), /setError\(/);
  assert.doesNotMatch(source.slice(catchBlock, source.indexOf('} finally', catchBlock)), /setActiveSession\(null\)|setSpokenResponse\(''\)/);
});

test('invalid online identity preserves the response and cannot create pending sync', () => {
  const invalidStart = source.indexOf("if (execution.mode === 'invalid')");
  const offlineStart = source.indexOf("if (execution.mode === 'offline')", invalidStart);
  const invalidBranch = source.slice(invalidStart, offlineStart);
  assert.match(invalidBranch, /setError\(/);
  assert.doesNotMatch(invalidBranch, /onActivityCheckpoint|onActivityEnd|setActiveSession\(null\)|setSpokenResponse\(''\)/);
});

test('successful completion refreshes authoritative progression after persistence', () => {
  assert.match(source, /if \(!response\.ok\)[\s\S]*?await response\.json\(\)[\s\S]*?setActiveSession\(null\)[\s\S]*?await loadSessions\(\)/);
  assert.match(source, /normalizeApiError\(body, 'Unable to complete the drill session\.'\)/);
});

test('completion phases retain the existing close and authoritative refresh order', () => {
  const completionStart = source.indexOf('const completeDrill = async () =>');
  const completion = source.slice(completionStart, source.indexOf('if (activeSession) {', completionStart));
  const scoring = completion.indexOf("setCompletionPhase('scoring')");
  const request = completion.indexOf('const response = await fetch', scoring);
  const close = completion.indexOf('setActiveSession(null)', request);
  const refreshing = completion.indexOf("setCompletionPhase('refreshing')", close);
  const refresh = completion.indexOf('await loadSessions()', refreshing);
  assert.ok(scoring >= 0 && request > scoring && close > request && refreshing > close && refresh > refreshing);
  assert.match(source, /completionPhase === 'saving-local' \? 'Saving locally\.\.\.' : 'Scoring\.\.\.'/);
  assert.match(source, /: 'Mark Complete'/);
  assert.match(source, /completionPhase === 'refreshing'[\s\S]*?role="status"[\s\S]*?Refreshing progress\.\.\./);
  assert.match(source, /disabled=\{completing !== null \|\| isListening/);
  assert.match(completion, /await loadSessions\(\);[\s\S]*?setCompletionPhase\('idle'\)/);
});

test('synchronous completion claim allows one request and releases on success or failure', () => {
  const inFlight = { current: false };
  let requests = 0;
  if (claimDrillCompletion(inFlight)) requests += 1;
  if (claimDrillCompletion(inFlight)) requests += 1;
  assert.equal(requests, 1);
  assert.equal(inFlight.current, true);
  inFlight.current = false;
  assert.equal(claimDrillCompletion(inFlight), true);
  const completionStart = source.indexOf('const completeDrill = async () =>');
  const completion = source.slice(completionStart, source.indexOf('if (activeSession) {', completionStart));
  assert.match(completion, /if \(completionInFlightRef\.current\) return;/);
  assert.equal((completion.match(/completionInFlightRef\.current = false;/g) ?? []).length, 2);
  assert.match(completion, /catch \(err\) \{[\s\S]*?setError\([\s\S]*?finally \{[\s\S]*?completionInFlightRef\.current = false/);
  assert.match(completion, /setNotice\('Drill was marked complete\.'\)[\s\S]*?await loadSessions\(\)/);
});

test('Drill timing is opt-in and logs only approved phase metadata', () => {
  assert.equal(drillCompletionPerfEnabled(undefined), false);
  assert.equal(drillCompletionPerfEnabled('false'), false);
  assert.equal(drillCompletionPerfEnabled('true'), true);
  assert.match(source, /drillCompletionPerfEnabled\(import\.meta\.env\?\.VITE_DRILL_PERF_DEBUG\)/);
  const lines: string[] = [];
  let now = 10;
  const trace = new DrillCompletionPerfTrace(() => now, line => lines.push(line));
  trace.mark('handlerStart');
  now = 35;
  trace.mark('postResponse', true);
  trace.mark('Private student answer');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /postResponse \+25\.0ms success=true/);
  assert.doesNotMatch(lines.join(' '), /Private student answer|token|Authorization|email/);
  assert.match(source, /requestAnimationFrame\(\(\) => \{\s*trace\.mark\('uiSettled'/);
});
