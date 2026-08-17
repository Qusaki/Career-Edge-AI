export interface OwnedOfflineRecord {
  userId: number;
  status: string;
  mode?: string;
  updatedAt?: number;
}

const requireUserId = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified backend user ID is required.');
  }
  return userId;
};

export const selectOwnedSyncQueue = <T extends OwnedOfflineRecord>(records: T[], userId: number): T[] => {
  const verifiedUserId = requireUserId(userId);
  return records
    .filter(record =>
      record.userId === verifiedUserId && ['pending_sync', 'syncing', 'sync_failed'].includes(record.status)
    )
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
};

export const selectOwnedResumableSessions = <T extends OwnedOfflineRecord>(records: T[], userId: number): T[] => {
  const verifiedUserId = requireUserId(userId);
  return records
    .filter(record =>
      record.userId === verifiedUserId && record.status === 'in_progress' && record.mode === 'offline'
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};
