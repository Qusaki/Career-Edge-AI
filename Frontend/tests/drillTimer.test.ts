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

test('JAM keeps its stable identity while every Drill view uses the 30 Seconds Speaking name', () => {
  assert.match(drillsSource, /title: '30 Seconds Speaking',[\s\S]*?drillType: 'jam'/);
  assert.doesNotMatch(drillsSource, /Just-a-Minute Speaking|Just a Minute Speaking/);
  assert.match(drillsSource, /jam: \{\s*task: 'Practice speaking continuously about the topic shown for 30 seconds\.'/);
  assert.match(drillsSource, /drillType === 'jam' \? getDrillDefinition\('jam'\)\.title/);
  assert.equal((drillsSource.match(/getDrillDisplayName\((?:activeSession|session)\.drill_type\)/g) ?? []).length, 2);
  for (const title of ['Fast Word Response', 'Emotion Delivery', 'Salary Negotiation']) {
    assert.match(drillsSource, new RegExp(`title: '${title}'`));
  }
});

test('the twelve-type audit enables a timer only for the 30-second JAM contract', () => {
  assert.deepEqual(getDrillTimerConfig('jam'), { durationSeconds: 30 });
  for (const drillType of drillTypes.filter(type => type !== 'jam')) {
    assert.equal(getDrillTimerConfig(drillType), null);
  }
});

test('a new JAM timer is ready at 00:30 and untimed drills create no timer', () => {
  assert.deepEqual(createDrillTimerState('jam'), {
    durationSeconds: 30,
    remainingSeconds: 30,
    startedAt: null,
    endsAt: null,
    hasStarted: false,
    phase: 'ready',
  });
  assert.equal(createDrillTimerState('fast_word'), null);
  assert.equal(formatDrillTimer(30), '00:30');
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
    assert.equal(paused.remainingSeconds, 20);
    assert.equal(paused.phase, 'paused');

    mock.timers.tick(30_000);
    assert.equal(getCurrentDrillTimerState(paused).remainingSeconds, 20);

    const resumed = startDrillTimer(paused);
    mock.timers.tick(10_000);
    const current = getCurrentDrillTimerState(resumed);
    assert.equal(current.remainingSeconds, 10);
    assert.equal(current.phase, 'running');
  } finally {
    mock.timers.reset();
  }
});

test('timeout clamps at zero and enters the expired state', () => {
  const initial = createDrillTimerState('jam');
  assert.ok(initial);
  const running = startDrillTimer(initial, 1_000);
  const expired = getCurrentDrillTimerState(running, 31_000);
  assert.equal(expired.remainingSeconds, 0);
  assert.equal(expired.phase, 'expired');
  assert.equal(expired.startedAt, null);
});

test('checkpoint restore preserves paused time and accounts for elapsed running time', () => {
  const pausedState = {
    durationSeconds: 30,
    remainingSeconds: 22,
    startedAt: null,
    endsAt: null,
    hasStarted: true,
    phase: 'paused' as const,
  };
  assert.deepEqual(restoreDrillTimer('jam', serializeDrillTimer(pausedState), 50_000), pausedState);

  const runningState = {
    ...pausedState,
    remainingSeconds: 20,
    startedAt: 10_000,
    endsAt: 30_000,
    phase: 'running' as const,
  };
  const restoredRunning = restoreDrillTimer('jam', serializeDrillTimer(runningState), 25_000);
  assert.equal(restoredRunning?.remainingSeconds, 5);
  assert.equal(restoredRunning?.phase, 'running');
});

test('legacy checkpoints receive the new initial time while malformed timer data fails closed', () => {
  assert.equal(restoreDrillTimer('jam', {})?.remainingSeconds, 30);
  const malformed = restoreDrillTimer('jam', { drillTimer: { remainingSeconds: 999 } });
  assert.equal(malformed?.remainingSeconds, 0);
  assert.equal(malformed?.phase, 'expired');
});

test('existing 60-second JAM checkpoints retain elapsed speaking time under the new limit', () => {
  const oldReady = { durationSeconds: 60, remainingSeconds: 60, startedAt: null, endsAt: null, hasStarted: false, phase: 'ready' };
  const oldPaused = { ...oldReady, remainingSeconds: 45, hasStarted: true, phase: 'paused' };
  const oldRunning = { ...oldPaused, startedAt: 10_000, endsAt: 55_000, phase: 'running' };

  assert.equal(restoreDrillTimer('jam', { drillTimer: oldReady })?.remainingSeconds, 30);
  assert.deepEqual(restoreDrillTimer('jam', { drillTimer: oldPaused }), {
    durationSeconds: 30, remainingSeconds: 15, startedAt: null, endsAt: null, hasStarted: true, phase: 'paused',
  });
  assert.equal(restoreDrillTimer('jam', { drillTimer: oldRunning }, 20_000)?.remainingSeconds, 5);
  assert.equal(restoreDrillTimer('jam', { drillTimer: oldRunning }, 25_000)?.phase, 'expired');
  assert.equal(restoreDrillTimer('jam', { drillTimer: { ...oldPaused, remainingSeconds: 30 } })?.phase, 'expired');
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
