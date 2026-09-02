import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveDrillSessionExecution } from '../src/utils/drillSessionExecution';

const offlineClientSessionId = '7f4d6d6e-1b7a-4d28-a6c9-9c0b1d2e3f40';
const resolverSource = readFileSync(
  new URL('../src/utils/drillSessionExecution.ts', import.meta.url),
  'utf8',
);

test('offline mode with a known client UUID resolves to local completion', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'offline',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: offlineClientSessionId,
  }), { mode: 'offline', clientSessionId: offlineClientSessionId });
});

test('online mode with a positive safe integer resolves to API completion', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'online',
    activeSessionId: 42,
    knownOfflineClientSessionId: null,
  }), { mode: 'online', serverSessionId: 42 });
});

test('online numeric string is invalid instead of being reinterpreted as offline', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'online',
    activeSessionId: '123',
    knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('online malformed string is invalid instead of being reinterpreted as offline', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'online',
    activeSessionId: 'abc',
    knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('known offline identity remains local when connectivity has returned', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'offline',
    activeSessionId: offlineClientSessionId,
    knownOfflineClientSessionId: offlineClientSessionId,
  }), { mode: 'offline', clientSessionId: offlineClientSessionId });
});

test('offline mode without authoritative client identity is invalid', () => {
  assert.deepEqual(resolveDrillSessionExecution({
    sessionMode: 'offline',
    activeSessionId: 'unverified',
    knownOfflineClientSessionId: null,
  }), { mode: 'invalid', reason: 'unverified_session' });
});

test('unsafe, fractional, zero, and negative online IDs are invalid', () => {
  for (const activeSessionId of [Number.MAX_SAFE_INTEGER + 1, 1.5, 0, -1]) {
    assert.deepEqual(resolveDrillSessionExecution({
      sessionMode: 'online',
      activeSessionId,
      knownOfflineClientSessionId: null,
    }), { mode: 'invalid', reason: 'unverified_session' });
  }
});

test('session identity resolution never coerces a client ID into a number', () => {
  assert.doesNotMatch(resolverSource, /Number\(|parseInt\(|parseFloat\(/);
});
