import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/DrillsPage.tsx', import.meta.url),
  'utf8',
);

test('Drill progression is loaded from the authenticated backend endpoint', () => {
  assert.match(source, /fetch\(`\$\{apiUrl\}\/drills\/progress`, \{ headers \}\)/);
  assert.match(source, /setProgress\(progressData\)/);
});

test('safe initial progression unlocks Easy and locks Medium and Hard', () => {
  assert.match(source, /easy:\s*\{[\s\S]*?unlocked: true/);
  assert.match(source, /medium:\s*\{[\s\S]*?unlocked: false/);
  assert.match(source, /hard:\s*\{[\s\S]*?unlocked: false/);
});

test('locked levels remain visible with clear lock guidance', () => {
  assert.match(source, /<Lock className=/);
  assert.match(source, /Complete all Easy drills to unlock\./);
  assert.match(source, /Complete all Medium drills to unlock\./);
});

test('each level displays authoritative completion counts', () => {
  assert.match(source, /\{levelProgress\.completed\} \/ \{levelProgress\.total\} drills completed/);
});

test('individual completed Drill types are visibly marked', () => {
  assert.match(source, /levelProgress\.completed_types\.includes\(drill\.drillType\)/);
  assert.match(source, /isCompleted \? 'Completed' : 'Not completed'/);
});

test('locked Drill actions cannot start a session', () => {
  assert.match(source, /disabled=\{isLocked \|\| starting !== null \|\| completing !== null\}/);
  assert.match(source, /if \(!progress\[drill\.drillLevel\]\.unlocked\)/);
});

test('server lock errors use the shared API error normalizer', () => {
  assert.match(source, /normalizeApiError\(body, `Unable to start \$\{drill\.title\}\.`\)/);
});

test('online completion refreshes authoritative progression immediately', () => {
  assert.match(source, /setNotice\('Drill was marked complete\.'\)[\s\S]*?await loadSessions\(\)/);
});

test('completed Drill types remain replayable', () => {
  assert.match(source, /isCompleted \? 'Replay Drill' : 'Start Drill'/);
  assert.doesNotMatch(source, /disabled=\{[^}]*isCompleted/);
});

test('offline starts use the same current server-authoritative lock state', () => {
  const guardIndex = source.indexOf('if (!progress[drill.drillLevel].unlocked)');
  const offlineIndex = source.indexOf('if (!effectiveOnline)', guardIndex);
  assert.ok(guardIndex >= 0 && offlineIndex > guardIndex);
});
