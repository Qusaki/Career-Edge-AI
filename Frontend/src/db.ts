import Dexie, { type EntityTable, type Table } from 'dexie';

export type OfflineActivityType = 'upcoming' | 'thesis';
export type OfflineSyncStatus = 'pending_sync' | 'synced';

export interface ConversationTurn {
  sender: 'user' | 'ai';
  text: string;
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
  status: OfflineSyncStatus;
  conversationLog: ConversationTurn[];
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

const requireVerifiedUserId = (userId: number): number => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified backend user ID is required for local account storage.');
  }
  return userId;
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

  getOfflineSessions(userId: number, type: OfflineActivityType) {
    return db.accountOfflineSessions
      .where('[userId+type]')
      .equals([requireVerifiedUserId(userId), type])
      .toArray();
  },

  getPendingOfflineSessions(userId: number) {
    return db.accountOfflineSessions
      .where('[userId+status]')
      .equals([requireVerifiedUserId(userId), 'pending_sync'])
      .toArray();
  },

  putOfflineSession(session: AccountOfflineSession) {
    requireVerifiedUserId(session.userId);
    return db.accountOfflineSessions.put(session);
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
    await db.accountOfflineSessions.update(key, { status: 'synced' });
    return true;
  },
};
