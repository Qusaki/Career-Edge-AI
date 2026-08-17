import Dexie, { type EntityTable, type Table } from 'dexie';
import { selectOwnedResumableSessions, selectOwnedSyncQueue } from './offline/selectors';

export type OfflineActivityType =
  | 'upcoming'
  | 'thesis'
  | 'pre_test_intro'
  | 'pre_test_active_listening'
  | 'post_test'
  | 'drill';
export type OfflineSessionMode = 'online' | 'offline';
export type OfflineSyncStatus =
  | 'in_progress'
  | 'completed_local'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'sync_failed';
export type OfflineSyncRetryDisposition = 'retryable' | 'manual_attention' | null;

export interface ConversationTurn {
  sender: 'user' | 'ai';
  text: string;
}

export type OfflineAudioTranscriptStatus = 'available' | 'pending' | 'not_requested';

export interface OfflineAudioReference {
  audioId: string;
  turnId: string;
  answerIndex: number;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  transcriptStatus: OfflineAudioTranscriptStatus;
}

export interface AccountOfflineAudio {
  audioId: string;
  userId: number;
  clientSessionId: string;
  activityType: OfflineActivityType;
  turnId: string;
  answerIndex: number;
  mimeType: string;
  blob: Blob;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  transcriptStatus: OfflineAudioTranscriptStatus;
  transcriptText: string | null;
}

// Version 1 records have no trustworthy account owner. These stores are kept
// intact for migration safety, but application reads and synchronization must
// never use them.
export interface LegacyUserProfile {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  department?: string;
  profile_picture_url?: string;
}

export interface LegacyOfflineSession {
  localId: string;
  type: OfflineActivityType;
  status: OfflineSyncStatus;
  conversationLog: unknown[];
  evaluation: unknown;
  timestamp: number;
}

export interface LegacyCachedHistory {
  id: number;
  type: OfflineActivityType;
  data: unknown;
  timestamp: number;
}

export interface AccountCachedProfile {
  userId: number;
  email: string;
  name: string;
  department: string;
  profilePicture: string;
}

export interface AccountCachedHistory {
  userId: number;
  type: OfflineActivityType;
  data: unknown[];
  timestamp: number;
}

export interface AccountOfflineSession {
  localId: string;
  userId: number;
  type: OfflineActivityType;
  mode: OfflineSessionMode;
  status: OfflineSyncStatus;
  serverSessionId: number | null;
  clientSessionId: string;
  activityVersion: number;
  questionPackVersion: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  currentStep: number;
  responseCount: number;
  currentQuestion: string;
  conversationLog: ConversationTurn[];
  answers: Array<{ step: number; text: string; createdAt: number }>;
  audioReferences: OfflineAudioReference[];
  eyeContactSummary: { score: number | null; samples: number } | null;
  pendingEvaluation: Record<string, unknown> | null;
  localEvaluation: Record<string, unknown> | null;
  authoritativeResult: Record<string, unknown> | null;
  localScore: number | null;
  evaluationAuthority: 'local_provisional' | 'server' | null;
  activityState: Record<string, unknown>;
  retryCount: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  retryDisposition: OfflineSyncRetryDisposition;
  syncedAt: number | null;
  syncState: 'not_ready' | 'queued' | 'syncing' | 'synced' | 'failed';
  // Retained for safe reads of existing v2 records.
  evaluation: Record<string, unknown> | null;
  timestamp: number;
}

const db = new Dexie('CareerEdgeDB') as Dexie & {
  // Retained v1 legacy/unowned stores.
  profile: EntityTable<LegacyUserProfile, 'id'>;
  offlineSessions: EntityTable<LegacyOfflineSession, 'localId'>;
  history: EntityTable<LegacyCachedHistory, 'id'>;

  // Account-scoped v2 stores.
  accountProfiles: EntityTable<AccountCachedProfile, 'userId'>;
  accountHistory: Table<AccountCachedHistory, [number, OfflineActivityType]>;
  accountOfflineSessions: Table<AccountOfflineSession, [number, OfflineActivityType, string]>;
  accountOfflineAudio: Table<AccountOfflineAudio, [number, string]>;
};

db.version(1).stores({
  profile: 'id, email',
  offlineSessions: 'localId, type, status',
  history: 'id, type',
});

db.version(2).stores({
  // Re-declare the v1 stores without altering or claiming their records.
  profile: 'id, email',
  offlineSessions: 'localId, type, status',
  history: 'id, type',
  accountProfiles: 'userId, email',
  accountHistory: '[userId+type], userId, type',
  accountOfflineSessions: '[userId+type+localId], userId, type, status, [userId+status], [userId+type]',
});

db.version(3).stores({
  // Legacy v1 stores remain quarantined and unchanged.
  profile: 'id, email',
  offlineSessions: 'localId, type, status',
  history: 'id, type',
  accountProfiles: 'userId, email',
  accountHistory: '[userId+type], userId, type',
  accountOfflineSessions: '[userId+type+localId], userId, type, status, mode, clientSessionId, [userId+status], [userId+type], [userId+mode]',
});

db.version(4).stores({
  // Legacy stores remain quarantined and account-scoped v3 records stay intact.
  profile: 'id, email',
  offlineSessions: 'localId, type, status',
  history: 'id, type',
  accountProfiles: 'userId, email',
  accountHistory: '[userId+type], userId, type',
  accountOfflineSessions: '[userId+type+localId], userId, type, status, mode, clientSessionId, [userId+status], [userId+type], [userId+mode]',
  accountOfflineAudio: '[userId+audioId], userId, audioId, clientSessionId, activityType, [userId+clientSessionId], [userId+clientSessionId+answerIndex]',
});

const requireVerifiedUserId = (userId: number): number => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified backend user ID is required for local account storage.');
  }
  return userId;
};

const normalizeOfflineSession = (session: AccountOfflineSession): AccountOfflineSession => {
  const timestamp = session.timestamp || session.updatedAt || Date.now();
  return {
    ...session,
    mode: session.mode || 'offline',
    clientSessionId: session.clientSessionId || session.localId,
    serverSessionId: session.serverSessionId ?? null,
    activityVersion: session.activityVersion || 1,
    questionPackVersion: session.questionPackVersion ?? null,
    startedAt: session.startedAt || timestamp,
    updatedAt: session.updatedAt || timestamp,
    completedAt: session.completedAt ?? null,
    currentStep: session.currentStep || 0,
    responseCount: session.responseCount || 0,
    currentQuestion: session.currentQuestion || '',
    conversationLog: Array.isArray(session.conversationLog) ? session.conversationLog : [],
    answers: Array.isArray(session.answers) ? session.answers : [],
    audioReferences: Array.isArray(session.audioReferences) ? session.audioReferences : [],
    eyeContactSummary: session.eyeContactSummary ?? null,
    pendingEvaluation: session.pendingEvaluation ?? session.evaluation ?? null,
    localEvaluation: session.localEvaluation ?? null,
    authoritativeResult: session.authoritativeResult ?? null,
    localScore: session.localScore ?? null,
    evaluationAuthority: session.evaluationAuthority ?? null,
    activityState: session.activityState && typeof session.activityState === 'object' ? session.activityState : {},
    retryCount: session.retryCount || 0,
    lastAttemptAt: session.lastAttemptAt ?? null,
    nextRetryAt: session.nextRetryAt ?? null,
    lastError: session.lastError ?? null,
    lastErrorCode: session.lastErrorCode ?? null,
    retryDisposition: session.retryDisposition ?? null,
    syncedAt: session.syncedAt ?? (session.status === 'synced' ? session.updatedAt || timestamp : null),
    syncState: session.syncState || (session.status === 'pending_sync' ? 'queued' : 'not_ready'),
    evaluation: session.evaluation ?? null,
    timestamp,
  };
};

export const accountStorage = {
  getCachedProfile(userId: number) {
    return db.accountProfiles.get(requireVerifiedUserId(userId));
  },

  putCachedProfile(profile: AccountCachedProfile) {
    requireVerifiedUserId(profile.userId);
    return db.accountProfiles.put(profile);
  },

  getCachedHistory(userId: number, type: OfflineActivityType) {
    return db.accountHistory.get([requireVerifiedUserId(userId), type]);
  },

  putCachedHistory(history: AccountCachedHistory) {
    requireVerifiedUserId(history.userId);
    return db.accountHistory.put(history);
  },

  async getOfflineSessions(userId: number, type: OfflineActivityType) {
    const sessions = await db.accountOfflineSessions
      .where('[userId+type]')
      .equals([requireVerifiedUserId(userId), type])
      .toArray();
    return sessions.map(normalizeOfflineSession);
  },

  async getPendingOfflineSessions(userId: number) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const [pending, syncing, failed] = await Promise.all([
      db.accountOfflineSessions.where('[userId+status]').equals([verifiedUserId, 'pending_sync']).toArray(),
      db.accountOfflineSessions.where('[userId+status]').equals([verifiedUserId, 'syncing']).toArray(),
      db.accountOfflineSessions.where('[userId+status]').equals([verifiedUserId, 'sync_failed']).toArray(),
    ]);
    return selectOwnedSyncQueue(
      [...pending, ...syncing, ...failed].map(normalizeOfflineSession),
      verifiedUserId,
    );
  },

  async getSyncedOfflineSessions(userId: number) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const sessions = await db.accountOfflineSessions
      .where('[userId+status]')
      .equals([verifiedUserId, 'synced'])
      .toArray();
    return sessions.map(normalizeOfflineSession);
  },

  async getResumableOfflineSessions(userId: number) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const sessions = await db.accountOfflineSessions
      .where('[userId+status]')
      .equals([verifiedUserId, 'in_progress'])
      .toArray();
    return selectOwnedResumableSessions(sessions.map(normalizeOfflineSession), verifiedUserId);
  },

  async getOfflineSession(userId: number, type: OfflineActivityType, localId: string) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const session = await db.accountOfflineSessions.get([verifiedUserId, type, localId]);
    return session ? normalizeOfflineSession(session) : undefined;
  },

  putOfflineSession(session: AccountOfflineSession) {
    requireVerifiedUserId(session.userId);
    if (!session.localId || !session.clientSessionId || session.localId !== session.clientSessionId) {
      throw new Error('Offline checkpoints require one stable client session ID.');
    }
    return db.accountOfflineSessions.put(session);
  },

  putOfflineAudio(record: AccountOfflineAudio) {
    requireVerifiedUserId(record.userId);
    if (!record.audioId || !record.clientSessionId || !record.turnId || record.answerIndex <= 0) {
      throw new Error('Offline audio requires stable session and turn ownership.');
    }
    if (!(record.blob instanceof Blob) || record.blob.size !== record.sizeBytes) {
      throw new Error('Offline audio Blob metadata is invalid.');
    }
    return db.accountOfflineAudio.put(record);
  },

  getOfflineAudio(userId: number, audioId: string) {
    return db.accountOfflineAudio.get([requireVerifiedUserId(userId), audioId]);
  },

  getOfflineAudioForSession(userId: number, clientSessionId: string) {
    return db.accountOfflineAudio
      .where('[userId+clientSessionId]')
      .equals([requireVerifiedUserId(userId), clientSessionId])
      .sortBy('answerIndex');
  },

  async deleteOfflineAudioForSession(userId: number, clientSessionId: string) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const ownedKeys = await db.accountOfflineAudio
      .where('[userId+clientSessionId]')
      .equals([verifiedUserId, clientSessionId])
      .primaryKeys();
    await db.accountOfflineAudio.bulkDelete(ownedKeys);
    return ownedKeys.length;
  },

  async updateOfflineSession(
    userId: number,
    type: OfflineActivityType,
    localId: string,
    update: Partial<AccountOfflineSession>,
  ) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const key: [number, OfflineActivityType, string] = [verifiedUserId, type, localId];
    return db.transaction('rw', db.accountOfflineSessions, async () => {
      const current = await db.accountOfflineSessions.get(key);
      if (!current || current.userId !== verifiedUserId) return undefined;
      const normalized = normalizeOfflineSession(current);
      const next: AccountOfflineSession = {
        ...normalized,
        ...update,
        mode: normalized.mode === 'offline' ? 'offline' : (update.mode || normalized.mode),
        userId: verifiedUserId,
        type: normalized.type,
        localId: normalized.localId,
        clientSessionId: normalized.clientSessionId,
        serverSessionId: normalized.serverSessionId ?? update.serverSessionId ?? null,
        startedAt: normalized.startedAt,
        updatedAt: Date.now(),
        timestamp: normalized.timestamp,
      };
      await db.accountOfflineSessions.put(next);
      return next;
    });
  },

  deleteOfflineSession(userId: number, type: OfflineActivityType, localId: string) {
    const verifiedUserId = requireVerifiedUserId(userId);
    return db.transaction('rw', db.accountOfflineSessions, db.accountOfflineAudio, async () => {
      await db.accountOfflineSessions.delete([verifiedUserId, type, localId]);
      const ownedAudioKeys = await db.accountOfflineAudio
        .where('[userId+clientSessionId]')
        .equals([verifiedUserId, localId])
        .primaryKeys();
      await db.accountOfflineAudio.bulkDelete(ownedAudioKeys);
    });
  },

  deleteSyncedOfflineSession(
    userId: number,
    type: OfflineActivityType,
    localId: string,
    eligibleBefore: number,
  ) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const key: [number, OfflineActivityType, string] = [verifiedUserId, type, localId];
    return db.transaction('rw', db.accountOfflineSessions, db.accountOfflineAudio, async () => {
      const current = await db.accountOfflineSessions.get(key);
      if (!current || current.userId !== verifiedUserId || current.status !== 'synced') return false;
      const normalized = normalizeOfflineSession(current);
      const syncedAt = normalized.syncedAt ?? normalized.updatedAt;
      if (syncedAt > eligibleBefore) return false;
      await db.accountOfflineSessions.delete(key);
      const ownedAudioKeys = await db.accountOfflineAudio
        .where('[userId+clientSessionId]')
        .equals([verifiedUserId, normalized.clientSessionId])
        .primaryKeys();
      await db.accountOfflineAudio.bulkDelete(ownedAudioKeys);
      return true;
    });
  },

  async markOfflineSessionSynced(
    userId: number,
    type: OfflineActivityType,
    localId: string,
  ) {
    const verifiedUserId = requireVerifiedUserId(userId);
    const key: [number, OfflineActivityType, string] = [verifiedUserId, type, localId];
    const session = await db.accountOfflineSessions.get(key);
    if (!session || session.userId !== verifiedUserId) return false;
    await db.accountOfflineSessions.update(key, {
      status: 'synced',
      syncState: 'synced',
      updatedAt: Date.now(),
    });
    return true;
  },
};
