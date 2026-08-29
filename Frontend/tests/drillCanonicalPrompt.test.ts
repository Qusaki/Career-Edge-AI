import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/DrillsPage.tsx', import.meta.url),
  'utf8',
);

test('online Drill start requests the canonical session directly without generator endpoints', () => {
  assert.match(source, /fetch\(`\$\{apiUrl\}\/drills\/start`/);
  assert.doesNotMatch(source, /generatorEndpoint/);
  assert.doesNotMatch(source, /\/drills\/generate\//);
});

test('online Drill prompt state is derived from the returned canonical prompt', () => {
  assert.match(source, /if \(!session\.canonical_prompt\)/);
  assert.match(source, /const formattedPrompt = formatPrompt\(session\.canonical_prompt\)/);
  assert.match(source, /setActivePrompt\(formattedPrompt\)/);
});

test('offline Drill start retains versioned local deterministic prompt generation', () => {
  assert.match(source, /if \(!effectiveOnline\)[\s\S]*?getOfflineDrillPrompt\(drill\.drillType, clientSessionId\)/);
  assert.match(source, /mode: 'offline'/);
  assert.match(source, /questionPackVersion: DRILLS_VERSION/);
});

test('canonical prompt work preserves QA-safe headings and structured errors', () => {
  assert.match(source, />Current Drill<\/h1>/);
  assert.doesNotMatch(source, /Current Drill #/);
  assert.match(source, /normalizeApiError\(body,/);
  assert.doesNotMatch(source, /new Error\(body\?\.detail \|\|/);
});
