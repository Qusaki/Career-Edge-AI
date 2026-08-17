import assert from 'node:assert/strict';
import test from 'node:test';

import type { AccountOfflineSession } from '../src/db';
import {
  buildOfflineSyncPayload,
  syncOfflineSession,
  syncPendingSessionsOnce,
} from '../src/offline/offlineSyncClient';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
} from '../src/offline/sessionFoundation';
import { isCompletedActivity } from '../src/utils/analytics';

const makePendingSession = (userId = 7, clientSessionId = 'sync-client'): AccountOfflineSession => {
  const started = createActivityCheckpoint(userId, {
    type: 'pre_test_intro',
    mode: 'offline',
    questionPackVersion: 'pretest-who-am-i-v1',
    answers: [{ step: 1, text: 'A real answer', createdAt: 10 }],
    audioReferences: [{
      audioId: 'audio-1', turnId: 'intro-1', answerIndex: 1, mimeType: 'audio/webm',
      sizeBytes: 100, durationMs: 900, createdAt: 10, transcriptStatus: 'available',
    }],
  }, 'offline', clientSessionId);
  return createPendingSyncCheckpoint(createCompletedLocalCheckpoint(started));
};

const successResponse = (session: AccountOfflineSession, serverSessionId = 55) => new Response(JSON.stringify({
  synchronized: true,
  activity_type: session.type,
  client_session_id: session.clientSessionId,
  server_session_id: serverSessionId,
  status: 'completed',
  evaluation_authority: 'server',
  authoritative_result: { id: serverSessionId, total_score: 12, status: 'completed' },
  completed_at: new Date(20).toISOString(),
  idempotent_replay: false,
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const makeMemoryStorage = (initial: AccountOfflineSession[]) => {
  const records = new Map(initial.map(session => [session.clientSessionId, session]));
  const transitions: string[] = [];
  return {
    records,
    transitions,
    async getPendingOfflineSessions(userId: number) {
      return [...records.values()].filter(session => session.userId === userId && ['pending_sync', 'sync_failed'].includes(session.status));
    },
    async updateOfflineSession(userId: number, type: AccountOfflineSession['type'], localId: string, update: Partial<AccountOfflineSession>) {
      const current = records.get(localId);
      if (!current || current.userId !== userId || current.type !== type) return undefined;
      const next = { ...current, ...update, userId, type, localId, clientSessionId: current.clientSessionId };
      records.set(localId, next);
      if (update.status) transitions.push(update.status);
      return next;
    },
  };
};

test('sync payload preserves client identity, raw answers, and audio manifest without user authority', () => {
  const session = makePendingSession();
  const payload = buildOfflineSyncPayload(session);
  assert.equal(payload.client_session_id, session.clientSessionId);
  assert.equal(payload.answers[0].text, 'A real answer');
  assert.equal(payload.audio_manifest[0].audio_id, 'audio-1');
  assert.equal('user_id' in payload, false);
});

test('in-progress and cross-account sessions are never synchronized', async () => {
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  await assert.rejects(() => syncOfflineSession({ ...pending, status: 'in_progress' }, {
    apiUrl: 'https://example.invalid', token: 'token', userId: 7, storage,
  }), /Only completed/);
  await assert.rejects(() => syncOfflineSession(pending, {
    apiUrl: 'https://example.invalid', token: 'token', userId: 8, storage,
  }), /ownership/);
});

test('pending sync transitions through syncing to synced and retains local audio', async () => {
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  const saved = await syncOfflineSession(pending, {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    fetchImpl: async () => successResponse(pending),
  });
  assert.deepEqual(storage.transitions, ['syncing', 'synced']);
  assert.equal(saved.clientSessionId, pending.clientSessionId);
  assert.equal(saved.serverSessionId, 55);
  assert.equal(saved.evaluationAuthority, 'server');
  assert.deepEqual(saved.audioReferences, pending.audioReferences);
});

test('failed synchronization becomes sync_failed with retry metadata', async () => {
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  await assert.rejects(() => syncOfflineSession(pending, {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    fetchImpl: async () => new Response(JSON.stringify({ detail: 'Provider unavailable.' }), { status: 503 }),
  }), /Provider unavailable/);
  const failed = storage.records.get(pending.clientSessionId)!;
  assert.deepEqual(storage.transitions, ['syncing', 'sync_failed']);
  assert.equal(failed.retryCount, 1);
  assert.equal(failed.syncState, 'failed');
});

test('one-shot reconnect processes only pending records sequentially and skips sync_failed', async () => {
  const pendingA = makePendingSession(7, 'pending-a');
  const pendingB = makePendingSession(7, 'pending-b');
  const failed = { ...makePendingSession(7, 'failed'), status: 'sync_failed' as const };
  const other = makePendingSession(8, 'other-user');
  const storage = makeMemoryStorage([pendingA, pendingB, failed, other]);
  let activeFetches = 0;
  let maximumFetches = 0;
  const completed = await syncPendingSessionsOnce({
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    fetchImpl: async (_input, init) => {
      activeFetches += 1;
      maximumFetches = Math.max(maximumFetches, activeFetches);
      const body = JSON.parse(String(init?.body));
      await new Promise(resolve => setTimeout(resolve, 5));
      activeFetches -= 1;
      const source = storage.records.get(body.client_session_id)!;
      return successResponse(source, body.client_session_id === 'pending-a' ? 10 : 11);
    },
  });
  assert.equal(completed, 2);
  assert.equal(maximumFetches, 1);
  assert.equal(storage.records.get('failed')?.status, 'sync_failed');
  assert.equal(storage.records.get('other-user')?.status, 'pending_sync');
});

test('duplicate reconnect events share one run and active offline work blocks sync', async () => {
  const pending = makePendingSession();
  const storage = makeMemoryStorage([pending]);
  let calls = 0;
  const options = {
    apiUrl: 'https://api.example', token: 'token', userId: 7, storage,
    hasActiveOfflineSession: () => false,
    fetchImpl: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return successResponse(pending);
    },
  };
  await Promise.all([syncPendingSessionsOnce(options), syncPendingSessionsOnce(options)]);
  assert.equal(calls, 1);

  const blockedStorage = makeMemoryStorage([makePendingSession(9, 'blocked')]);
  const blocked = await syncPendingSessionsOnce({
    ...options, userId: 9, storage: blockedStorage, hasActiveOfflineSession: () => true,
  });
  assert.equal(blocked, 0);
  assert.equal(blockedStorage.records.get('blocked')?.status, 'pending_sync');
});

test('synced local audit records do not count as separate final analytics results', () => {
  assert.equal(isCompletedActivity({ status: 'synced', total_score: 99 }), false);
  assert.equal(isCompletedActivity({ status: 'completed', total_score: 99 }), true);
});

