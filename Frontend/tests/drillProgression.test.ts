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

test('canonical level groups keep Positive Framing in Medium and preserve exact order', () => {
  assert.match(source, /easy:\s*\['jam',\s*'fast_word'\]/);
  assert.match(source, /medium:\s*\['emotion',\s*'synonym',\s*'fake_profile',\s*'emoji_story',\s*'positive_framing'\]/);
  assert.match(source, /hard:\s*\['taboo',\s*'elevator_pitch',\s*'rephrase',\s*'negotiation',\s*'crisis'\]/);
  assert.match(source, /const levelDrills = drillTypesByLevel\[level\]\.map\(getDrillDefinition\)/);
});

test('safe initial progression unlocks only JAM for a new user', () => {
  assert.match(source, /const levelUnlocked = level === 'easy'/);
  assert.match(source, /unlocked: levelUnlocked && index === 0/);
  assert.match(source, /easy: createInitialLevelProgress\('easy'\)/);
  assert.match(source, /medium: createInitialLevelProgress\('medium'\)/);
  assert.match(source, /hard: createInitialLevelProgress\('hard'\)/);
});

test('locked levels remain visible with clear lock guidance', () => {
  assert.match(source, /<Lock className=/);
  assert.match(source, /Complete all Easy drills to unlock Medium\./);
  assert.match(source, /Complete all Medium drills to unlock Hard\./);
});

test('locked drills show the immediate prerequisite returned by progression state', () => {
  assert.match(source, /Complete \$\{drillUnlockNames\[drillProgress\.prerequisite_type\]\} first to unlock\./);
  assert.match(source, /isDrillLocked && <p[^>]*>\{lockedCopy\}<\/p>/);
  assert.match(source, /aria-label=\{isDrillLocked \? `\$\{drill\.title\} is locked\. \$\{lockedCopy\}`/);
});

test('each level displays authoritative completion counts', () => {
  assert.match(source, /\{levelProgress\.completed\} \/ \{levelProgress\.total\} drills completed/);
});

test('individual completed Drill types are visibly marked', () => {
  assert.match(source, /levelProgress\.drills\.find\(item => item\.type === drill\.drillType\)/);
  assert.match(source, /const isCompleted = Boolean\(drillProgress\?\.completed\)/);
  assert.match(source, /isCompleted \? 'Completed' : isDrillLocked \? 'Locked' : 'Available'/);
});

test('locked Drill actions cannot start a session', () => {
  assert.match(source, /disabled=\{isDrillLocked \|\| starting !== null \|\| completing !== null\}/);
  assert.match(source, /if \(!levelProgress\.unlocked\)/);
  assert.match(source, /if \(!drillProgress\?\.unlocked\)/);
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
  const guardIndex = source.indexOf('if (!drillProgress?.unlocked)');
  const offlineIndex = source.indexOf('if (!effectiveOnline)', guardIndex);
  assert.ok(guardIndex >= 0 && offlineIndex > guardIndex);
});
