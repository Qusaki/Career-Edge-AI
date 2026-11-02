import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readComponent = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
const dashboard = readComponent('Dashboard.tsx');

for (const [file, startName, label] of [
  ['PreTestPage.tsx', 'startExercise', 'Pre-Test'],
  ['DrillsPage.tsx', 'startDrill', 'Drills'],
  ['PostTestPage.tsx', 'startPostTest', 'Post-Test'],
] as const) {
  const source = readComponent(file);
  const start = source.indexOf(`const ${startName} = async`);
  const offlineBranch = source.indexOf('if (!effectiveOnline)', start);
  const flow = source.slice(start, offlineBranch + 1200);

  test(`${label} waits for cloud verification before choosing a new session mode`, () => {
    assert.ok(start >= 0 && offlineBranch > start);
    const checkingGuard = flow.indexOf("if (cloudConnectionState === 'checking')");
    assert.ok(checkingGuard >= 0 && checkingGuard < offlineBranch - start);
    assert.match(flow.slice(checkingGuard, offlineBranch - start), /setError\(CLOUD_CHECKING_START_MESSAGE\);\s*return;/);
    assert.match(source, /CLOUD_CHECKING_START_MESSAGE = 'Checking Career Edge cloud connection\. Please try again in a moment\.'/);
    assert.match(source, /cloudConnectionState: ConnectionState/);
    assert.match(source, /if \(!effectiveOnline\) \{[\s\S]*?mode: 'offline'/);
    assert.match(source, /setError\(current => current === CLOUD_CHECKING_START_MESSAGE \? null : current\)/);
    assert.match(dashboard, new RegExp(`<${label === 'Pre-Test' ? 'PreTestPage' : label === 'Drills' ? 'DrillsPage' : 'PostTestPage'}[\\s\\S]*?cloudConnectionState=\\{connectivity\\.connectionState\\}`));
  });
}

test('Enrollment checks current connectivity before and after professor preparation', () => {
  const start = dashboard.indexOf('const startInterviewSession = async () => {');
  const offlineBranch = dashboard.indexOf('if (!connectivityOnlineRef.current)', start);
  const flow = dashboard.slice(start, offlineBranch);
  assert.ok(start >= 0 && offlineBranch > start);
  assert.equal((flow.match(/if \(isCloudChecking\(\)\)/g) ?? []).length, 2);
  assert.match(flow, /setCheckingInterviewStart\('enrollment'\);\s*return;/);
  assert.match(flow, /await waitForProfessorAsset\(\)/);
  assert.match(flow, /setCheckingInterviewStart\('enrollment'\);\s*setIsStartingInterview\(false\);\s*return;/);
  assert.match(dashboard, /checkingInterviewStart === 'enrollment'[\s\S]*?<p role="status"[^>]*>\{CLOUD_CHECKING_START_MESSAGE\}/);
  assert.match(dashboard.slice(offlineBranch), /mode: 'offline'/);
  assert.match(dashboard.slice(offlineBranch), /upcoming-student-interview\/start/);
});

test('Thesis checks current connectivity before and after abstract preparation', () => {
  const start = dashboard.indexOf('const startThesisSession = async () => {');
  const offlineBranch = dashboard.indexOf('if (!connectivityOnlineRef.current)', start);
  const flow = dashboard.slice(start, offlineBranch);
  assert.ok(start >= 0 && offlineBranch > start);
  assert.equal((flow.match(/if \(isCloudChecking\(\)\)/g) ?? []).length, 2);
  assert.match(flow, /setCheckingInterviewStart\('thesis'\);\s*return;/);
  assert.match(flow, /await readThesisAbstractFile\(thesisAbstractFile\)/);
  assert.match(flow, /setCheckingInterviewStart\('thesis'\);\s*setThesisIsStarting\(false\);\s*return;/);
  assert.match(dashboard, /checkingInterviewStart === 'thesis'[\s\S]*?<p role="status"[^>]*>\{CLOUD_CHECKING_START_MESSAGE\}/);
  assert.match(dashboard.slice(offlineBranch), /mode: 'offline'/);
  assert.match(dashboard.slice(offlineBranch), /thesis-interview\/start/);
});

test('checking feedback clears after verification without changing offline-locked sessions', () => {
  assert.match(dashboard, /if \(connectivity\.connectionState !== 'checking'\) setCheckingInterviewStart\(null\)/);
  assert.match(dashboard, /if \(active\?\.mode === 'offline' && active\.status === 'in_progress'\) return/);
  assert.match(dashboard, /if \(active\.mode === 'online'\) \{[\s\S]*?setShowConnectionLossPrompt\(true\)/);
  assert.match(dashboard, /if \(checkpoint\.mode === 'offline'\)/);
});
