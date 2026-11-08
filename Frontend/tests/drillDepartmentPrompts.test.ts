import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DRILLS_VERSION,
  getOfflineDrillPrompt,
  getQuestionPackVersion,
  hasCurrentQuestionPack,
  LEGACY_DRILLS_VERSION,
} from '../src/offline/questionPacks';

const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const drillsSource = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');

test('verified Dashboard department reaches offline Drill selection without entering online start payload', () => {
  assert.match(dashboardSource, /userDepartment=\{authenticatedUserId \? profile\.department : ''\}/);
  assert.match(drillsSource, /getOfflineDrillPrompt\(drill\.drillType, clientSessionId, userDepartment, DRILLS_VERSION\)/);
  const onlineRequest = drillsSource.match(/fetch\(`\$\{apiUrl\}\/drills\/start`, \{[\s\S]*?\n      \}\);/)?.[0];
  assert.ok(onlineRequest);
  assert.doesNotMatch(onlineRequest, /userDepartment|department:/);
});

test('new v2 Fast Word and Fake Profile prompts use per-department content and match backend fixtures', () => {
  assert.equal(getQuestionPackVersion('drill'), 'drills-v2');
  const expected = {
    CCIT: { word: 'Backend', job: 'Data Analyst' },
    CTE: { word: 'Pedagogy', job: 'Training Facilitator' },
    CBAPA: { word: 'Budgeting', job: 'Marketing Associate' },
  } as const;
  for (const department of ['CCIT', 'CTE', 'CBAPA'] as const) {
    assert.deepEqual(getOfflineDrillPrompt('fast_word', 'sample-id', department, DRILLS_VERSION), { word: expected[department].word });
    assert.equal(getOfflineDrillPrompt('fake_profile', 'sample-id', department, DRILLS_VERSION).job, expected[department].job);
    assert.deepEqual(
      getOfflineDrillPrompt('fast_word', 'sample-id', department, DRILLS_VERSION),
      getOfflineDrillPrompt('fast_word', 'sample-id', department, DRILLS_VERSION),
    );
  }
  assert.notDeepEqual(
    getOfflineDrillPrompt('fast_word', 'same-id', 'CCIT', DRILLS_VERSION),
    getOfflineDrillPrompt('fast_word', 'same-id', 'CTE', DRILLS_VERSION),
  );
  assert.deepEqual(
    getOfflineDrillPrompt('fast_word', 'sample-id', ' cte ', DRILLS_VERSION),
    getOfflineDrillPrompt('fast_word', 'sample-id', 'CTE', DRILLS_VERSION),
  );
});

test('shared Drills stay shared; v1 checkpoints remain resumable without conversion', () => {
  for (const drillType of ['jam', 'emotion', 'synonym', 'emoji_story', 'negotiation']) {
    const shared = getOfflineDrillPrompt(drillType, 'same-id', 'CCIT', DRILLS_VERSION);
    assert.deepEqual(getOfflineDrillPrompt(drillType, 'same-id', 'CTE', DRILLS_VERSION), shared);
    assert.deepEqual(getOfflineDrillPrompt(drillType, 'same-id', 'CBAPA', DRILLS_VERSION), shared);
  }
  assert.equal(hasCurrentQuestionPack('drill', LEGACY_DRILLS_VERSION), true);
  assert.equal(hasCurrentQuestionPack('drill', DRILLS_VERSION), true);
  assert.deepEqual(getOfflineDrillPrompt('fast_word', 'sample-id', 'CTE', LEGACY_DRILLS_VERSION), { word: 'Python' });
  assert.match(drillsSource, /setActivePrompt\(String\(resumeSession\.activityState\.prompt \|\| resumeSession\.currentQuestion\)\)/);
  assert.match(drillsSource, /questionPackVersion: DRILLS_VERSION/);
});

test('invalid field-biased department fails closed while neutral Drills remain available', () => {
  assert.throws(() => getOfflineDrillPrompt('fast_word', 'sample-id', '', DRILLS_VERSION), /supported department/);
  assert.throws(() => getOfflineDrillPrompt('fast_word', 'sample-id', 'unknown', DRILLS_VERSION), /supported department/);
  assert.deepEqual(getOfflineDrillPrompt('jam', 'sample-id', '', DRILLS_VERSION), { topic: 'Smartphones' });
});

test('taboo, pitch, rephrase, positive framing, and crisis exclude another department field prompts', () => {
  const types = ['taboo', 'elevator_pitch', 'rephrase', 'positive_framing', 'crisis'];
  for (const drillType of types) {
    const ccitOnly = new Set<string>();
    const cteOnly = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const ccit = JSON.stringify(getOfflineDrillPrompt(drillType, `sample-${index}`, 'CCIT', DRILLS_VERSION));
      const cte = JSON.stringify(getOfflineDrillPrompt(drillType, `sample-${index}`, 'CTE', DRILLS_VERSION));
      ccitOnly.add(ccit);
      cteOnly.add(cte);
    }
    assert.ok([...ccitOnly].some(prompt => !cteOnly.has(prompt)), drillType);
  }
});
