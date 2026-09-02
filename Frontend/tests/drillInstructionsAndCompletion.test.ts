import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('the active Drill shows one vertical responsive instruction hierarchy', () => {
  assert.match(source, /aria-label="Drill instructions"/);
  assert.match(source, />Task<\/p>/);
  assert.match(source, />How to answer<\/p>/);
  assert.match(source, />Answer format<\/p>/);
  assert.match(source, /divide-y divide-line/);
  const instructionsStart = source.indexOf('aria-label="Drill instructions"');
  const instructionsEnd = source.indexOf("activeSession.drill_type === 'negotiation'", instructionsStart);
  assert.doesNotMatch(source.slice(instructionsStart, instructionsEnd), /grid-cols|col-span/);
});

test('session status, timer, instructions, and prompt details follow the intended order', () => {
  const activeSessionStart = source.indexOf('if (activeSession)');
  const statusIndex = source.indexOf('<SoundWaveInterviewer', activeSessionStart);
  const timerIndex = source.indexOf('role="timer"', statusIndex);
  const instructionsIndex = source.indexOf('aria-label="Drill instructions"', timerIndex);
  const promptIndex = source.indexOf('Prompt details', instructionsIndex);
  assert.ok(statusIndex >= 0 && timerIndex > statusIndex && instructionsIndex > timerIndex && promptIndex > instructionsIndex);
  assert.ok(source.indexOf('>Prompt</p>', instructionsIndex) > instructionsIndex);
});

test('instruction sections read Task, How to answer, Answer format, then Automatic scoring', () => {
  const instructionsStart = source.indexOf('aria-label="Drill instructions"');
  const instructionsEnd = source.indexOf("activeSession.drill_type === 'negotiation'", instructionsStart);
  const instructionMarkup = source.slice(instructionsStart, instructionsEnd);
  const taskIndex = instructionMarkup.indexOf('>Task</p>');
  const howIndex = instructionMarkup.indexOf('>How to answer</p>');
  const formatIndex = instructionMarkup.indexOf('>Answer format</p>');
  const scoringIndex = instructionMarkup.indexOf('>Automatic scoring</p>');
  assert.ok(taskIndex >= 0 && howIndex > taskIndex && formatIndex > howIndex && scoringIndex > formatIndex);
  assert.match(instructionMarkup, /bg-card\/50 px-4 py-3/);
  assert.doesNotMatch(instructionMarkup, /w-\[[^\]]+\]|min-w-\[[^\]]+\]/);
});

test('task directions and automatic scoring transparency remain visibly separate', () => {
  assert.match(source, />Automatic scoring<\/p>/);
  assert.match(source, /Practice goal: follow the task directions as closely as possible\./);
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
