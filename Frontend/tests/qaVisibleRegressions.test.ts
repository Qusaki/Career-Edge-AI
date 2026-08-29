import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readComponent = (file: string) => readFileSync(
  new URL(`../src/components/${file}`, import.meta.url),
  'utf8',
);

test('Pre-Test headings show activity names without offline UUID or online numeric IDs', () => {
  const source = readComponent('PreTestPage.tsx');
  assert.match(source, /activeExercise\.kind === 'active-listening' \? 'Active Listening' : activeExercise\.title/);
  assert.doesNotMatch(source, /#\{activeSession\.id\}/);
  assert.doesNotMatch(source, /session #\$\{session\.id\}/);
  assert.doesNotMatch(source, /session #\$\{completedSession\.id\}/);

  // IDs remain internal and available for offline identity and API routing.
  assert.match(source, /id: checkpoint\.clientSessionId/);
  assert.match(source, /\$\{activeSession\.id\}\/complete/);
});

test('Drill headings show the drill label without offline UUID or online numeric IDs', () => {
  const source = readComponent('DrillsPage.tsx');
  assert.match(source, />Current Drill<\/h1>/);
  assert.doesNotMatch(source, /Current Drill #/);
  assert.doesNotMatch(source, /session #\$\{session\.id\}/);
  assert.doesNotMatch(source, /session #\$\{completedSession\.id\}/);

  // IDs remain internal and available for offline identity and API routing.
  assert.match(source, /id: checkpoint\.clientSessionId/);
  assert.match(source, /\/drills\/\$\{activeSession\.id\}\/complete/);
});

test('Post-Test no longer presents its completion session ID and retains internal routing identity', () => {
  const source = readComponent('PostTestPage.tsx');
  assert.doesNotMatch(source, /Post-Test session \$\{completedSession\.id\}/);
  assert.match(source, /post-test-interview\/\$\{activeSession\.id\}\/complete/);
});

test('all scoped HTTP handlers use the shared normalizer and WebSocket messages are narrowed safely', () => {
  const preTest = readComponent('PreTestPage.tsx');
  const postTest = readComponent('PostTestPage.tsx');
  const drills = readComponent('DrillsPage.tsx');

  for (const source of [preTest, postTest, drills]) {
    assert.match(source, /normalizeApiError\(body,/);
    assert.doesNotMatch(source, /new Error\(body\?\.detail \|\|/);
  }
  assert.match(preTest, /normalizeApiError\(data, 'The audio interviewer could not respond/);
  assert.match(postTest, /normalizeApiError\(data, 'The audio interviewer could not respond/);
  assert.match(preTest, /const data: unknown = JSON\.parse/);
  assert.match(postTest, /const data: unknown = JSON\.parse/);
});
