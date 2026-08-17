import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deriveConnectionState } from '../src/hooks/useConnectivity';
import { selectOwnedResumableSessions, selectOwnedSyncQueue } from '../src/offline/selectors';
import { createActivityCheckpoint, mergeActivityCheckpoint } from '../src/offline/sessionFoundation';
import { isCompletedActivity } from '../src/utils/analytics';

test('connectivity distinguishes offline, degraded, checking, and online', () => {
  assert.equal(deriveConnectionState(false, false), 'offline');
  assert.equal(deriveConnectionState(true, false), 'degraded');
  assert.equal(deriveConnectionState(true, null), 'checking');
  assert.equal(deriveConnectionState(true, true), 'online');
});

test('stable client session ID and immutable ownership survive checkpoint updates', () => {
  const original = createActivityCheckpoint(
    17,
    { type: 'upcoming', serverSessionId: 42, currentQuestion: 'Question one?' },
    'online',
    'stable-client-session',
  );
  const updated = mergeActivityCheckpoint(original, {
    responseCount: 1,
    currentStep: 1,
    currentQuestion: 'Question two?',
  });

  assert.equal(updated.clientSessionId, 'stable-client-session');
  assert.equal(updated.localId, 'stable-client-session');
  assert.equal(updated.userId, 17);
  assert.equal(updated.serverSessionId, 42);
});

test('an offline-locked activity cannot switch back to online during checkpoint merges', () => {
  const original = createActivityCheckpoint(17, { type: 'thesis' }, 'offline', 'locked-session');
  const reconnected = mergeActivityCheckpoint(original, { mode: 'online', currentStep: 2 });
  assert.equal(reconnected.mode, 'offline');
  assert.equal(reconnected.currentStep, 2);
});

test('resume and sync selectors never return another account records', () => {
  const records = [
    { userId: 17, status: 'in_progress', mode: 'offline', updatedAt: 30, id: 'resume-own' },
    { userId: 18, status: 'in_progress', mode: 'offline', updatedAt: 40, id: 'resume-other' },
    { userId: 17, status: 'pending_sync', mode: 'offline', updatedAt: 20, id: 'pending-own' },
    { userId: 18, status: 'pending_sync', mode: 'offline', updatedAt: 10, id: 'pending-other' },
    { userId: 17, status: 'sync_failed', mode: 'offline', updatedAt: 25, id: 'failed-own' },
  ];

  assert.deepEqual(selectOwnedResumableSessions(records, 17).map(record => record.id), ['resume-own']);
  assert.deepEqual(selectOwnedSyncQueue(records, 17).map(record => record.id), ['pending-own', 'failed-own']);
});

test('pending local sessions are not completed analytics records', () => {
  assert.equal(isCompletedActivity({ status: 'pending_sync', total_score: 0 }), false);
  assert.equal(isCompletedActivity({ status: 'completed_local', total_score: 0 }), false);
  assert.equal(isCompletedActivity({ status: 'sync_failed', total_score: 0 }), false);
  assert.equal(isCompletedActivity({ status: 'completed', total_score: 85 }), true);
});

test('normal Dashboard startup keeps WebLLM disabled and connectivity loss does not initialize it', () => {
  const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const connectivitySource = readFileSync(new URL('../src/hooks/useConnectivity.ts', import.meta.url), 'utf8');
  assert.match(dashboardSource, /useWebLLM\([^\n]+, false\)/);
  assert.match(connectivitySource, /addEventListener\('offline'/);
  assert.doesNotMatch(connectivitySource, /ensureOfflineAIReady|CreateMLCEngine/);
});
