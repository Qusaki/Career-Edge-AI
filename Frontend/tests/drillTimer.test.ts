import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

import {
  createDrillTimerState,
  formatDrillTimer,
  getCurrentDrillTimerState,
  getDrillTimerConfig,
  pauseDrillTimer,
  restoreDrillTimer,
  serializeDrillTimer,
  startDrillTimer,
} from '../src/utils/drillTimer';

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

const drillsSource = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('the twelve-type audit enables a timer only for the 60-second JAM contract', () => {
  assert.deepEqual(getDrillTimerConfig('jam'), { durationSeconds: 60 });
  for (const drillType of drillTypes.filter(type => type !== 'jam')) {
    assert.equal(getDrillTimerConfig(drillType), null);
  }
});

test('a new JAM timer is ready at 01:00 and untimed drills create no timer', () => {
  assert.deepEqual(createDrillTimerState('jam'), {
    durationSeconds: 60,
    remainingSeconds: 60,
    startedAt: null,
    endsAt: null,
    hasStarted: false,
    phase: 'ready',
  });
  assert.equal(createDrillTimerState('fast_word'), null);
  assert.equal(formatDrillTimer(60), '01:00');
  assert.equal(formatDrillTimer(9), '00:09');
  assert.match(drillsSource, /\{drillTimer && \(/);
});

test('fake time advances only a running timer and manual stop preserves remaining time', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000 });
  try {
    const initial = createDrillTimerState('jam');
    assert.ok(initial);
    const running = startDrillTimer(initial);
    mock.timers.tick(10_000);
    const paused = pauseDrillTimer(running);
    assert.equal(paused.remainingSeconds, 50);
    assert.equal(paused.phase, 'paused');

    mock.timers.tick(30_000);
    assert.equal(getCurrentDrillTimerState(paused).remainingSeconds, 50);

    const resumed = startDrillTimer(paused);
    mock.timers.tick(20_000);
    const current = getCurrentDrillTimerState(resumed);
    assert.equal(current.remainingSeconds, 30);
    assert.equal(current.phase, 'running');
  } finally {
    mock.timers.reset();
  }
});

test('timeout clamps at zero and enters the expired state', () => {
  const initial = createDrillTimerState('jam');
  assert.ok(initial);
  const running = startDrillTimer(initial, 1_000);
  const expired = getCurrentDrillTimerState(running, 70_000);
  assert.equal(expired.remainingSeconds, 0);
  assert.equal(expired.phase, 'expired');
  assert.equal(expired.startedAt, null);
});

test('checkpoint restore preserves paused time and accounts for elapsed running time', () => {
  const pausedState = {
    durationSeconds: 60,
    remainingSeconds: 42,
    startedAt: null,
    endsAt: null,
    hasStarted: true,
    phase: 'paused' as const,
  };
  assert.deepEqual(restoreDrillTimer('jam', serializeDrillTimer(pausedState), 50_000), pausedState);

  const runningState = {
    ...pausedState,
    remainingSeconds: 40,
    startedAt: 10_000,
    endsAt: 50_000,
    phase: 'running' as const,
  };
  const restoredRunning = restoreDrillTimer('jam', serializeDrillTimer(runningState), 25_000);
  assert.equal(restoredRunning?.remainingSeconds, 25);
  assert.equal(restoredRunning?.phase, 'running');
});

test('legacy checkpoints receive the full initial time while malformed timer data fails closed', () => {
  assert.equal(restoreDrillTimer('jam', {})?.remainingSeconds, 60);
  const malformed = restoreDrillTimer('jam', { drillTimer: { remainingSeconds: 999 } });
  assert.equal(malformed?.remainingSeconds, 0);
  assert.equal(malformed?.phase, 'expired');
});

test('the component binds start, pause, expiry, and cleanup to the speech lifecycle', () => {
  assert.match(drillsSource, /if \(!isListening \|\| !current[\s\S]*?persistTimerState\(startDrillTimer\(current\)\)/);
  assert.match(drillsSource, /if \(isListening \|\| !current \|\| current\.phase !== 'running'\) return;[\s\S]*?pauseDrillTimer\(current\)/);
  assert.match(drillsSource, /if \(next\.phase === 'expired'\)[\s\S]*?stopListening\(\)/);
  assert.match(drillsSource, /return \(\) => window\.clearInterval\(intervalId\)/);
  assert.match(drillsSource, /const stopDrillResponse[\s\S]*?pauseDrillTimer\(current\)[\s\S]*?stopListening\(\)/);
  assert.ok((drillsSource.match(/applyDrillTimer\(null\)/g) ?? []).length >= 3);
});

test('timer metadata is checkpointed for offline and online resume without backend schema changes', () => {
  assert.match(drillsSource, /\.\.\.serializeDrillTimer\(initialTimer\)/);
  assert.match(drillsSource, /restoreDrillTimer\(drill\.drillType, resumeSession\.activityState\)/);
  assert.match(drillsSource, /restoreDrillTimer\(drill\.drillType, checkpoint\.activityState\)/);
  assert.match(dashboardSource, /input\.type === 'drill'[\s\S]*?checkpoint\.serverSessionId === input\.serverSessionId/);
  assert.match(dashboardSource, /checkpoint\.mode === 'online'[\s\S]*?checkpoint\.status === 'in_progress'/);
});

test('the timer does not start on page load, prompt speech, or microphone permission request', () => {
  const startEffect = drillsSource.indexOf('persistTimerState(startDrillTimer(current))');
  const listeningGuard = drillsSource.lastIndexOf('if (!isListening', startEffect);
  assert.ok(startEffect > listeningGuard && listeningGuard >= 0);
  const speakTextStart = drillsSource.indexOf('const speakText');
  const speakTextEnd = drillsSource.indexOf('const loadSessions', speakTextStart);
  assert.doesNotMatch(drillsSource.slice(speakTextStart, speakTextEnd), /startDrillTimer/);
  assert.doesNotMatch(drillsSource, /getUserMedia[\s\S]{0,200}startDrillTimer/);
});

test('timeout stops recognition without completing the Drill or promoting interim text', () => {
  const expiryStart = drillsSource.indexOf("if (next.phase === 'expired')");
  const expiryEnd = drillsSource.indexOf('}, 250)', expiryStart);
  const expiryBranch = drillsSource.slice(expiryStart, expiryEnd);
  assert.match(expiryBranch, /stopListening\(\)/);
  assert.doesNotMatch(expiryBranch, /completeDrill|onActivityEnd|liveTranscript/);
});
