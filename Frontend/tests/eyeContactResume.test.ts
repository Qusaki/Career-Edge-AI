import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { combineEyeContactSummaries, type EyeContactSummary } from '../src/offline/eyeContact';
import { buildOfflineSyncPayload } from '../src/offline/offlineSyncClient';
import { createActivityCheckpoint } from '../src/offline/sessionFoundation';

const noLiveSamples: EyeContactSummary = { score: null, samples: 0 };

test('fresh eye-contact window preserves its 80 percent score across 20 samples', () => {
  assert.deepEqual(
    combineEyeContactSummaries(null, { score: 80, samples: 20 }),
    { score: 80, samples: 20 },
  );
});

test('resumed baseline 80/20 plus live window 50/10 becomes 70/30', () => {
  assert.deepEqual(
    combineEyeContactSummaries(
      { score: 80, samples: 20 },
      { score: 50, samples: 10 },
    ),
    { score: 70, samples: 30 },
  );
});

test('zero-percent baseline remains valid and combines with a perfect live window', () => {
  assert.deepEqual(
    combineEyeContactSummaries(
      { score: 0, samples: 10 },
      { score: 100, samples: 10 },
    ),
    { score: 50, samples: 20 },
  );
});

test('zero-percent live window remains valid and combines with a perfect baseline', () => {
  assert.deepEqual(
    combineEyeContactSummaries(
      { score: 100, samples: 10 },
      { score: 0, samples: 10 },
    ),
    { score: 50, samples: 20 },
  );
});

test('resume checkpoint with no new samples preserves the restored baseline', () => {
  assert.deepEqual(
    combineEyeContactSummaries({ score: 80, samples: 20 }, noLiveSamples),
    { score: 80, samples: 20 },
  );
});

test('repeated checkpoints in one lifecycle do not mutate or double-count the baseline', () => {
  const baseline: EyeContactSummary = { score: 80, samples: 20 };
  const liveWindow: EyeContactSummary = { score: 50, samples: 10 };

  const firstCheckpoint = combineEyeContactSummaries(baseline, liveWindow);
  const repeatedCheckpoint = combineEyeContactSummaries(baseline, liveWindow);

  assert.deepEqual(firstCheckpoint, { score: 70, samples: 30 });
  assert.deepEqual(repeatedCheckpoint, firstCheckpoint);
  assert.deepEqual(baseline, { score: 80, samples: 20 });
});

test('the saved cumulative result becomes the fixed baseline after a second refresh', () => {
  const afterFirstRefresh = combineEyeContactSummaries(
    { score: 80, samples: 20 },
    { score: 50, samples: 10 },
  );
  const afterSecondRefresh = combineEyeContactSummaries(
    afterFirstRefresh,
    { score: 100, samples: 10 },
  );

  assert.deepEqual(afterFirstRefresh, { score: 70, samples: 30 });
  assert.deepEqual(afterSecondRefresh, { score: 78, samples: 40 });
});

test('zero percent with positive samples is not treated as missing data', () => {
  assert.deepEqual(
    combineEyeContactSummaries(null, { score: 0, samples: 12 }),
    { score: 0, samples: 12 },
  );
  assert.deepEqual(combineEyeContactSummaries(null, noLiveSamples), noLiveSamples);
});

test('Who Am I and Active Listening restore one fixed offline baseline and serialize the combined result', () => {
  const source = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /offlineEyeContactBaselineRef\.current = resumeSession\.eyeContactSummary/);
  assert.match(source, /combineEyeContactSummaries\(offlineEyeContactBaselineRef\.current, liveWindow\)/);
  assert.match(source, /const recordIntro = \(\) =>[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
  assert.match(source, /const sendReply = async[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
  assert.match(source, /evaluationAuthority: 'local_provisional',[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
});

test('offline Post-Test resume and completion use cumulative eye contact independently of answer limits', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /offlineEyeContactBaselineRef\.current = resumeSession\.eyeContactSummary/);
  assert.match(source, /combineEyeContactSummaries\(offlineEyeContactBaselineRef\.current, liveWindow\)/);
  assert.match(source, /appendPostTestUserAnswer\(currentMessages, text\)/);
  assert.match(source, /requireExactPostTestAnswerCount\(currentMessages\)/);
  assert.match(source, /evaluationAuthority: 'local_provisional',[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
});

test('offline sync serializes the final cumulative summary without contract changes', () => {
  const cumulative = combineEyeContactSummaries(
    { score: 80, samples: 20 },
    { score: 50, samples: 10 },
  );
  const session = createActivityCheckpoint(7, {
    type: 'post_test',
    mode: 'offline',
    clientSessionId: 'eye-contact-sync-session',
    questionPackVersion: 'post-test-v1',
    eyeContactSummary: cumulative,
  }, 'offline', 'eye-contact-sync-session');

  assert.deepEqual(buildOfflineSyncPayload(session).eye_contact_summary, {
    score: 70,
    samples: 30,
  });
});
