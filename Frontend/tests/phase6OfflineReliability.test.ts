import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { AccountOfflineSession } from '../src/db';
import {
  AUTOMATIC_SYNC_BACKOFF_MS,
  classifyOfflineSyncFailure,
  getAutomaticSyncBackoffMs,
  MAX_AUTOMATIC_SYNC_ATTEMPTS,
  resetOfflineSyncRuntimeForTests,
  retryOfflineSessionManually,
  syncOfflineQueueWithRetry,
  syncOfflineSession,
} from '../src/offline/offlineSyncClient';
import {
  maintainOwnedOfflineStorage,
  STORAGE_PRESSURE_RETENTION_MS,
  SYNCED_RECORD_RETENTION_MS,
} from '../src/offline/offlineCleanup';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
} from '../src/offline/sessionFoundation';
import { isCompletedActivity } from '../src/utils/analytics';

const makePendingSession = (userId = 7, clientSessionId = 'phase6-session'): AccountOfflineSession => {
  const started = createActivityCheckpoint(userId, {
    type: 'pre_test_intro',
    mode: 'offline',
    questionPackVersion: 'pretest-who-am-i-v1',
    answers: [{ step: 1, text: 'A complete raw answer', createdAt: 10 }],
  }, 'offline', clientSessionId);
  return createPendingSyncCheckpoint(createCompletedLocalCheckpoint(started));
};

const successResponse = (session: AccountOfflineSession, replay = false) => new Response(JSON.stringify({
  synchronized: true,
  activity_type: session.type,
  client_session_id: session.clientSessionId,
  server_session_id: 81,
  status: 'completed',
  evaluation_authority: 'server',
  authoritative_result: { id: 81, total_score: 12, status: 'completed' },
  completed_at: new Date(20).toISOString(),
  idempotent_replay: replay,
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const errorResponse = (
  status: number,
  code: string,
  retryable: boolean,
  message = 'Safe synchronization error.',
) => new Response(JSON.stringify({ detail: { code, retryable, message } }), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const makeMemoryStorage = (initial: AccountOfflineSession[]) => {
  const records = new Map(initial.map(session => [session.clientSessionId, session]));
  const transitions: string[] = [];
  return {
    records,
    transitions,
    async getPendingOfflineSessions(userId: number) {
      return [...records.values()].filter(session => (
        session.userId === userId
        && ['pending_sync', 'syncing', 'sync_failed'].includes(session.status)
      ));
    },
    async updateOfflineSession(
      userId: number,
      type: AccountOfflineSession['type'],
      localId: string,
      update: Partial<AccountOfflineSession>,
    ) {
      const current = records.get(localId);
      if (!current || current.userId !== userId || current.type !== type) return undefined;
      const next = { ...current, ...update, userId, type, localId, clientSessionId: current.clientSessionId };
      records.set(localId, next);
      if (update.status) transitions.push(update.status);
      return next;
    },
  };
};

test('retry classification separates transient server failures from permanent client conflicts', () => {
  assert.equal(classifyOfflineSyncFailure(503, null).retryable, true);
  assert.equal(classifyOfflineSyncFailure(422, 'Invalid answers.').retryable, false);
  assert.equal(classifyOfflineSyncFailure(409, { code: 'sync_in_progress', message: 'Busy', retryable: true }).retryable, true);
  const conflict = classifyOfflineSyncFailure(409, { code: 'payload_conflict', message: 'Changed', retryable: false });
  assert.equal(conflict.retryable, false);
  assert.equal(conflict.code, 'payload_conflict');
});

test('automatic retry policy is bounded and capped', () => {
  assert.equal(MAX_AUTOMATIC_SYNC_ATTEMPTS, 3);
  assert.deepEqual(AUTOMATIC_SYNC_BACKOFF_MS, [0, 30_000, 120_000]);
  assert.equal(getAutomaticSyncBackoffMs(1), 30_000);
  assert.equal(getAutomaticSyncBackoffMs(2), 120_000);
  assert.equal(getAutomaticSyncBackoffMs(99), 120_000);
});

test('retryable failures receive at most three sequential automatic attempts', async () => {
  resetOfflineSyncRuntimeForTests();
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  let calls = 0;
  let clock = 1_000;
  const sleeps: number[] = [];
  const completed = await syncOfflineQueueWithRetry({
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    now: () => clock,
    sleep: async delay => { sleeps.push(delay); clock += delay; },
    fetchImpl: async () => { calls += 1; return errorResponse(503, 'provider_unavailable', true); },
  });
  assert.equal(completed, 0);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [30_000, 120_000]);
  assert.equal(storage.records.get(pending.clientSessionId)?.status, 'sync_failed');
  assert.equal(storage.records.get(pending.clientSessionId)?.retryCount, 3);
});

test('duplicate reconnect workers and connectivity flapping cannot create parallel requests', async () => {
  resetOfflineSyncRuntimeForTests();
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const options = {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    isCurrentUser: () => true,
    isOnline: () => true,
    fetchImpl: async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return successResponse(pending);
    },
  };
  await Promise.all([
    syncOfflineQueueWithRetry(options),
    syncOfflineQueueWithRetry(options),
    syncOfflineQueueWithRetry(options),
  ]);
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
});

test('a syncing record left by reload safely reconciles through idempotent replay', async () => {
  resetOfflineSyncRuntimeForTests();
  const syncing = { ...makePendingSession(), status: 'syncing' as const, syncState: 'syncing' as const };
  const storage = makeMemoryStorage([syncing]);
  const completed = await syncOfflineQueueWithRetry({
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    fetchImpl: async () => successResponse(syncing, true),
  });
  assert.equal(completed, 1);
  assert.equal(storage.records.get(syncing.clientSessionId)?.status, 'synced');
  assert.equal(storage.records.get(syncing.clientSessionId)?.clientSessionId, syncing.clientSessionId);
});

test('server success followed by local reconciliation failure remains recoverable', async () => {
  const pending = makePendingSession();
  const base = makeMemoryStorage([pending]);
  let rejectFirstSyncedWrite = true;
  const storage = {
    ...base,
    async updateOfflineSession(
      userId: number,
      type: AccountOfflineSession['type'],
      localId: string,
      update: Partial<AccountOfflineSession>,
    ) {
      if (update.status === 'synced' && rejectFirstSyncedWrite) {
        rejectFirstSyncedWrite = false;
        return undefined;
      }
      return base.updateOfflineSession(userId, type, localId, update);
    },
  };
  await assert.rejects(() => syncOfflineSession(pending, {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    fetchImpl: async () => successResponse(pending),
  }), /local reconciliation was interrupted/);
  const failed = storage.records.get(pending.clientSessionId)!;
  assert.equal(failed.status, 'sync_failed');
  const reconciled = await retryOfflineSessionManually(failed, {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    fetchImpl: async () => successResponse(pending, true),
  });
  assert.equal(reconciled.status, 'synced');
  assert.equal(reconciled.serverSessionId, 81);
});

test('permanent conflicts and unsupported packs are preserved for manual attention without hammering', async () => {
  resetOfflineSyncRuntimeForTests();
  const conflictSession = makePendingSession(7, 'conflict');
  const storage = makeMemoryStorage([conflictSession]);
  let calls = 0;
  await syncOfflineQueueWithRetry({
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    fetchImpl: async () => { calls += 1; return errorResponse(409, 'payload_conflict', false); },
  });
  assert.equal(calls, 1);
  assert.equal(storage.records.get('conflict')?.retryDisposition, 'manual_attention');

  resetOfflineSyncRuntimeForTests();
  const oldPack = { ...makePendingSession(7, 'old-pack'), questionPackVersion: null };
  const oldStorage = makeMemoryStorage([oldPack]);
  await syncOfflineQueueWithRetry({
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage: oldStorage,
    hasActiveOfflineSession: () => false,
    fetchImpl: async () => { throw new Error('network should not be called'); },
  });
  assert.equal(oldStorage.records.get('old-pack')?.lastErrorCode, 'unsupported_question_pack');
  assert.equal(oldStorage.records.get('old-pack')?.retryDisposition, 'manual_attention');
});

test('manual retry preserves ownership and the stable idempotency identity', async () => {
  const failed = {
    ...makePendingSession(),
    status: 'sync_failed' as const,
    syncState: 'failed' as const,
    retryDisposition: 'manual_attention' as const,
  };
  const storage = makeMemoryStorage([failed]);
  let clientSessionId = '';
  const result = await retryOfflineSessionManually(failed, {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    fetchImpl: async (_input, init) => {
      clientSessionId = JSON.parse(String(init?.body)).client_session_id;
      return successResponse(failed, true);
    },
  });
  assert.equal(clientSessionId, failed.clientSessionId);
  assert.equal(result.status, 'synced');
  await assert.rejects(() => retryOfflineSessionManually(failed, {
    apiUrl: 'https://api.example', token: 'token', userId: 8, storage,
  }), /ownership/);
});

test('cleanup removes only the current user stale synced sessions and their linked audio', async () => {
  const now = 30 * 24 * 60 * 60 * 1_000;
  const stale = { ...makePendingSession(7, 'stale'), status: 'synced' as const, syncedAt: now - SYNCED_RECORD_RETENTION_MS - 1 };
  const recent = { ...makePendingSession(7, 'recent'), status: 'synced' as const, syncedAt: now - 1_000 };
  const pending = makePendingSession(7, 'pending');
  const other = { ...makePendingSession(8, 'other'), status: 'synced' as const, syncedAt: 0 };
  const records = [stale, recent, pending, other];
  const deleted: string[] = [];
  const audio = new Set(['stale', 'recent', 'pending', 'other']);
  const result = await maintainOwnedOfflineStorage({
    userId: 7,
    now: () => now,
    estimateStorage: async () => ({ usage: 10, quota: 100 }),
    storage: {
      async getSyncedOfflineSessions() { return records; },
      async deleteSyncedOfflineSession(userId, _type, localId, eligibleBefore) {
        const record = records.find(item => item.localId === localId);
        if (!record || record.userId !== userId || record.status !== 'synced') return false;
        if ((record.syncedAt ?? record.updatedAt) > eligibleBefore) return false;
        deleted.push(localId);
        audio.delete(localId);
        return true;
      },
    },
  });
  assert.deepEqual(deleted, ['stale']);
  assert.equal(audio.has('stale'), false);
  assert.equal(audio.has('recent'), true);
  assert.equal(audio.has('pending'), true);
  assert.equal(audio.has('other'), true);
  assert.equal(result.retentionMs, SYNCED_RECORD_RETENTION_MS);
});

test('storage pressure shortens only synced retention and never selects unresolved work', async () => {
  const now = 20 * 24 * 60 * 60 * 1_000;
  const pressureEligible = { ...makePendingSession(7, 'pressure'), status: 'synced' as const, syncedAt: now - STORAGE_PRESSURE_RETENTION_MS - 1 };
  const unresolved = { ...makePendingSession(7, 'unresolved'), updatedAt: 0 };
  const deleted: string[] = [];
  const result = await maintainOwnedOfflineStorage({
    userId: 7,
    now: () => now,
    estimateStorage: async () => ({ usage: 90, quota: 100 }),
    storage: {
      async getSyncedOfflineSessions() { return [pressureEligible, unresolved]; },
      async deleteSyncedOfflineSession(_userId, _type, localId) { deleted.push(localId); return true; },
    },
  });
  assert.equal(result.storagePressure, true);
  assert.equal(result.retentionMs, STORAGE_PRESSURE_RETENTION_MS);
  assert.deepEqual(deleted, ['pressure']);
});

test('account isolation, analytics exclusion, and minimal sync UX remain explicit', () => {
  assert.equal(isCompletedActivity({ status: 'in_progress', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'completed_local', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'pending_sync', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'syncing', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'sync_failed', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'synced', total_score: 99 }), false);
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /Pending Sync/);
  assert.match(dashboard, /Syncing/);
  assert.match(dashboard, /Sync Failed/);
  assert.match(dashboard, /Retry Sync/);
  assert.match(dashboard, /fetchHistory/);
});
