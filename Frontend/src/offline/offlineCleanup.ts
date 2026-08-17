import { accountStorage, type AccountOfflineSession } from '../db';

export const SYNCED_RECORD_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
export const STORAGE_PRESSURE_RETENTION_MS = 3 * 24 * 60 * 60 * 1_000;
export const STORAGE_PRESSURE_RATIO = 0.85;

interface CleanupStorage {
  getSyncedOfflineSessions(userId: number): Promise<AccountOfflineSession[]>;
  deleteSyncedOfflineSession(
    userId: number,
    type: AccountOfflineSession['type'],
    localId: string,
    eligibleBefore: number,
  ): Promise<boolean>;
}

export interface OfflineCleanupOptions {
  userId: number;
  storage?: CleanupStorage;
  now?: () => number;
  estimateStorage?: () => Promise<{ usage?: number; quota?: number }>;
}

export interface OfflineCleanupResult {
  deletedSessions: number;
  storagePressure: boolean;
  retentionMs: number;
}

const browserStorageEstimate = () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return Promise.resolve({});
  }
  return navigator.storage.estimate();
};

export const maintainOwnedOfflineStorage = async (
  options: OfflineCleanupOptions,
): Promise<OfflineCleanupResult> => {
  if (!Number.isSafeInteger(options.userId) || options.userId <= 0) {
    throw new Error('A verified backend user ID is required for offline cleanup.');
  }
  const storage = options.storage ?? accountStorage;
  const now = (options.now ?? Date.now)();
  const estimate: { usage?: number; quota?: number } = await (
    options.estimateStorage ?? browserStorageEstimate
  )().catch(() => ({}));
  const usage = typeof estimate.usage === 'number' ? estimate.usage : 0;
  const quota = typeof estimate.quota === 'number' ? estimate.quota : 0;
  const storagePressure = quota > 0 && usage / quota >= STORAGE_PRESSURE_RATIO;
  const retentionMs = storagePressure ? STORAGE_PRESSURE_RETENTION_MS : SYNCED_RECORD_RETENTION_MS;
  const eligibleBefore = now - retentionMs;
  const sessions = await storage.getSyncedOfflineSessions(options.userId);
  const eligible = sessions
    .filter(session => session.userId === options.userId && session.status === 'synced')
    .filter(session => (session.syncedAt ?? session.updatedAt) <= eligibleBefore)
    .sort((a, b) => (a.syncedAt ?? a.updatedAt) - (b.syncedAt ?? b.updatedAt));

  let deletedSessions = 0;
  for (const session of eligible) {
    if (await storage.deleteSyncedOfflineSession(
      options.userId,
      session.type,
      session.localId,
      eligibleBefore,
    )) {
      deletedSessions += 1;
    }
  }
  return { deletedSessions, storagePressure, retentionMs };
};
