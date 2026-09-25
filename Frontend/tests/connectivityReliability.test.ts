import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  confirmBackendReachability,
  deriveConnectionState,
  HEALTH_ATTEMPT_TIMEOUTS_MS,
  HEALTH_RETRY_DELAYS_MS,
} from '../src/hooks/useConnectivity';
import { createActivityCheckpoint, mergeActivityCheckpoint } from '../src/offline/sessionFoundation';

const hookSource = readFileSync(new URL('../src/hooks/useConnectivity.ts', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

const noWait = async (_delayMs: number, _signal: AbortSignal) => {};

test('first health success confirms online without retry', async () => {
  const timeouts: number[] = [];
  let transientFailures = 0;
  const reachable = await confirmBackendReachability({
    signal: new AbortController().signal,
    probe: async timeoutMs => {
      timeouts.push(timeoutMs);
      return true;
    },
    wait: noWait,
    onFirstFailure: () => { transientFailures += 1; },
  });
  assert.equal(reachable, true);
  assert.deepEqual(timeouts, [HEALTH_ATTEMPT_TIMEOUTS_MS[0]]);
  assert.equal(transientFailures, 0);
  assert.equal(deriveConnectionState(true, reachable), 'online');
});

test('first timeout changes an established connection to checking, not degraded', async () => {
  let backendReachable: boolean | null = true;
  let releaseRetry: ((value: boolean) => void) | undefined;
  const retry = new Promise<boolean>(resolve => { releaseRetry = resolve; });
  let announceFirstFailure: (() => void) | undefined;
  const firstFailure = new Promise<void>(resolve => { announceFirstFailure = resolve; });
  let attempts = 0;
  const confirmation = confirmBackendReachability({
    signal: new AbortController().signal,
    probe: async () => (++attempts === 1 ? false : retry),
    wait: noWait,
    onFirstFailure: () => {
      backendReachable = null;
      announceFirstFailure?.();
    },
  });
  await firstFailure;
  assert.equal(deriveConnectionState(true, backendReachable), 'checking');
  releaseRetry?.(true);
  backendReachable = await confirmation;
  assert.equal(deriveConnectionState(true, backendReachable), 'online');
  assert.equal(attempts, 2);
});

test('a bounded retry succeeds with the configured delay and second timeout', async () => {
  const timeouts: number[] = [];
  const delays: number[] = [];
  const reachable = await confirmBackendReachability({
    signal: new AbortController().signal,
    probe: async timeoutMs => {
      timeouts.push(timeoutMs);
      return timeouts.length === 2;
    },
    wait: async delayMs => { delays.push(delayMs); },
  });
  assert.equal(reachable, true);
  assert.deepEqual(timeouts, [...HEALTH_ATTEMPT_TIMEOUTS_MS.slice(0, 2)]);
  assert.deepEqual(delays, [HEALTH_RETRY_DELAYS_MS[0]]);
});

test('only exhausting all bounded attempts confirms degraded backend state', async () => {
  const timeouts: number[] = [];
  const delays: number[] = [];
  let firstFailures = 0;
  const reachable = await confirmBackendReachability({
    signal: new AbortController().signal,
    probe: async timeoutMs => {
      timeouts.push(timeoutMs);
      return false;
    },
    wait: async delayMs => { delays.push(delayMs); },
    onFirstFailure: () => { firstFailures += 1; },
  });
  assert.equal(reachable, false);
  assert.equal(deriveConnectionState(true, reachable), 'degraded');
  assert.deepEqual(timeouts, [...HEALTH_ATTEMPT_TIMEOUTS_MS]);
  assert.deepEqual(delays, [...HEALTH_RETRY_DELAYS_MS]);
  assert.equal(firstFailures, 1);
});

test('cancelling a pending confirmation cannot publish an unavailable result', async () => {
  const controller = new AbortController();
  const confirmation = confirmBackendReachability({
    signal: controller.signal,
    probe: async (_timeoutMs, signal) => new Promise<boolean>(resolve => {
      signal.addEventListener('abort', () => resolve(false), { once: true });
    }),
    wait: noWait,
  });
  controller.abort();
  assert.equal(await confirmation, null);
});

test('browser offline bypasses health probes; browser online returns to checking first', () => {
  const offlineGuard = hookSource.indexOf("if (typeof navigator !== 'undefined' && !navigator.onLine)");
  const probeStart = hookSource.indexOf('confirmBackendReachability({', offlineGuard);
  assert.ok(offlineGuard >= 0 && probeStart > offlineGuard);
  assert.match(hookSource.slice(offlineGuard, probeStart), /return Promise\.resolve\(false\)/);
  assert.equal(deriveConnectionState(false, false), 'offline');
  const onlineEvent = hookSource.slice(hookSource.indexOf('const handleOnline = () =>'), hookSource.indexOf('const handleFocus = () =>'));
  assert.match(onlineEvent, /setBackendReachable\(null\)/);
  assert.match(onlineEvent, /checkBackend\(true\)/);
  assert.equal(deriveConnectionState(true, null), 'checking');
});

test('manual retry forces a fresh probe and recovery needs no page refresh', async () => {
  assert.match(hookSource, /retryConnection: \(\) => checkBackend\(true\)/);
  assert.match(hookSource, /if \(force\) abortRef\.current\?\.abort\(\)/);
  const reachable = await confirmBackendReachability({
    signal: new AbortController().signal,
    probe: async () => true,
    wait: noWait,
  });
  assert.equal(deriveConnectionState(true, false), 'degraded');
  assert.equal(deriveConnectionState(true, null), 'checking');
  assert.equal(deriveConnectionState(true, reachable), 'online');
});

test('focus and periodic checks retain throttle and share an active confirmation', () => {
  assert.match(hookSource, /if \(!force && activeCheckRef\.current\) return activeCheckRef\.current/);
  assert.match(hookSource, /now - lastCheckRef\.current < HEALTH_CHECK_THROTTLE_MS/);
  assert.match(hookSource, /if \(navigator\.onLine\) void checkBackend\(false\)/);
  assert.match(hookSource, /backendReachableRef\.current === false \|\| Date\.now\(\) - lastCheckRef\.current >= HEALTH_CHECK_INTERVAL_MS/);
  assert.match(hookSource, /\}, HEALTH_RECOVERY_INTERVAL_MS\)/);
});

test('offline-locked activity stays offline when health recovers', () => {
  const checkpoint = createActivityCheckpoint(17, { type: 'upcoming' }, 'offline', 'offline-owned');
  assert.equal(mergeActivityCheckpoint(checkpoint, { mode: 'online' }).mode, 'offline');
  assert.match(dashboardSource, /if \(active\?\.mode === 'offline' && active\.status === 'in_progress'\) return/);
});

test('Drill progress refetch and feature-level error paths remain outside health classification', () => {
  assert.match(dashboardSource, /if \(connectivity\.effectiveOnline\) void refreshPostTestProgress\(authenticatedUserId\)/);
  assert.match(dashboardSource, /connectivity\.effectiveOnline,[\s\S]*?refreshPostTestProgress/);
  assert.match(dashboardSource, /Connecting to Career Edge cloud/);
  assert.match(dashboardSource, /Career Edge cloud unavailable/);
  assert.match(hookSource, /\/health only confirms that the API process answered, not database or AI availability/);
  assert.doesNotMatch(hookSource, /normalizeApiError|\/drills\/progress|\/auth\/login/);
});
