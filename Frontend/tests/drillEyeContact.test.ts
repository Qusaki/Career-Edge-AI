import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { combineEyeContactSummaries } from '../src/offline/eyeContact';
import { buildOfflineSyncPayload } from '../src/offline/offlineSyncClient';
import { createActivityCheckpoint } from '../src/offline/sessionFoundation';
import { derivePreTestBaseline } from '../src/utils/preTestBaseline';


const drillsSource = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const cameraSource = readFileSync(new URL('../src/components/CameraTrackingNotice.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');


test('Drills reuse one shared eye-contact tracker for the active session', () => {
  assert.match(drillsSource, /import \{ useEyeContactTracker \} from '\.\.\/hooks\/useEyeContactTracker'/);
  assert.equal((drillsSource.match(/useEyeContactTracker\(/g) || []).length, 1);
  assert.match(drillsSource, /useEyeContactTracker\(Boolean\(activeSession\)\)/);
  assert.doesNotMatch(drillsSource, /useEyeContactTracker\([^)]*negotiationTurn/);
  assert.doesNotMatch(drillsSource, /getUserMedia\(/);
});

test('Drill camera renders inline in the activity-card header with responsive stacking', () => {
  assert.match(drillsSource, /flex flex-col items-start gap-4 sm:flex-row sm:justify-between[\s\S]*?<CameraTrackingNotice \{\.\.\.eyeTracker\} \/>/);
  assert.match(cameraSource, /max-w-44/);
  assert.doesNotMatch(cameraSource, /\bfixed\b|right-\d|right-\[/);
  assert.match(cameraSource, /Camera unavailable/);
  assert.match(cameraSource, /Activity can continue without Visual Engagement scoring\./);
  assert.match(drillsSource, /Visual Engagement sample data is invalid/);
  assert.match(drillsSource, /Visual Engagement score data is invalid/);
  assert.match(drillsSource, /eye_contact_score: eyeContactScore/);
  assert.match(drillsSource, /eye_contact_samples: eyeContactSummary\.samples/);
});

test('every normal Drill and negotiation share the active-session camera path', () => {
  const supportedTypes = [
    'jam', 'fast_word', 'emotion', 'synonym', 'fake_profile', 'emoji_story',
    'positive_framing', 'taboo', 'elevator_pitch', 'rephrase', 'crisis', 'negotiation',
  ];
  for (const drillType of supportedTypes) {
    assert.match(drillsSource, new RegExp(`drillType: '${drillType}'`));
  }
  assert.match(drillsSource, /if \(activeSession\) \{[\s\S]*?<CameraTrackingNotice \{\.\.\.eyeTracker\} \/>[\s\S]*?activeSession\.drill_type === 'negotiation'/);
});

test('online Drill completion serializes camera metrics without dropping zero percent', () => {
  assert.match(drillsSource, /const eyeContactSummary = getCheckpointEyeContactSummary\(\)/);
  assert.match(drillsSource, /const eyeContactScore = eyeContactSummary\.samples > 0 \? eyeContactSummary\.score : null/);
  assert.match(drillsSource, /eye_contact_score: eyeContactScore/);
  assert.match(drillsSource, /eye_contact_samples: eyeContactSummary\.samples/);
  assert.match(drillsSource, /Number\.isSafeInteger\(eyeContactSummary\.samples\)/);
  assert.match(drillsSource, /Number\.isFinite\(eyeContactScore\)/);
  assert.doesNotMatch(drillsSource, /eye_contact_score:\s*eyeContactSummary\.score\s*\?/);
});

test('offline Drill checkpoints use a fixed restored baseline plus the live tracker window', () => {
  assert.match(drillsSource, /offlineEyeContactBaselineRef\.current = resumeSession\.eyeContactSummary/);
  assert.match(drillsSource, /combineEyeContactSummaries\(offlineEyeContactBaselineRef\.current, liveWindow\)/);
  assert.match(drillsSource, /const userCheckpointSaved = await onActivityCheckpoint\(\{[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
  assert.match(drillsSource, /localEvaluation: result\.evaluation,[\s\S]*?eyeContactSummary: getCheckpointEyeContactSummary\(\)/);

  const firstLifecycle = combineEyeContactSummaries(
    { score: 80, samples: 20 },
    { score: 50, samples: 10 },
  );
  const repeatedCheckpoint = combineEyeContactSummaries(
    { score: 80, samples: 20 },
    { score: 50, samples: 10 },
  );
  const secondLifecycle = combineEyeContactSummaries(
    firstLifecycle,
    { score: 100, samples: 10 },
  );

  assert.deepEqual(firstLifecycle, { score: 70, samples: 30 });
  assert.deepEqual(repeatedCheckpoint, firstLifecycle);
  assert.deepEqual(secondLifecycle, { score: 78, samples: 40 });
});

test('offline Drill sync payload includes the corrected cumulative summary', () => {
  const session = createActivityCheckpoint(7, {
    type: 'drill',
    mode: 'offline',
    clientSessionId: 'drill-camera-sync',
    questionPackVersion: 'drills-v1',
    answers: [{ step: 1, text: 'A complete Drill response.', createdAt: 1 }],
    eyeContactSummary: { score: 0, samples: 20 },
    activityState: { drillType: 'jam', drillLevel: 'easy' },
  }, 'offline', 'drill-camera-sync');

  assert.deepEqual(buildOfflineSyncPayload(session).eye_contact_summary, {
    score: 0,
    samples: 20,
  });
});

test('Drill camera data remains in activity history but cannot change initial Pre-Test Baseline', () => {
  assert.match(dashboardSource, /\{ label: 'Drills', records: completedModules\.filter\(item => item\._source === 'drills'\) \}/);
  const initial = { _source: 'pre-test-intro', id: 1, status: 'completed',
    start_time: '2026-01-01T00:00:00Z', score_eye_contact: 40, eye_contact_samples: 10 };
  const drill = { _source: 'drills', id: 2, status: 'completed',
    start_time: '2026-01-02T00:00:00Z', score_eye_contact: 100, eye_contact_samples: 100 };
  assert.equal(derivePreTestBaseline([initial, drill])?.visualEngagement, 40);
});
