import Dexie, { type EntityTable } from 'dexie';

export interface UserProfile {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  department?: string;
  profile_picture_url?: string;
}

export interface OfflineSession {
  localId: string;
  type: 'upcoming' | 'thesis';
  status: 'pending_sync' | 'synced';
  conversationLog: any[];
  evaluation: any;
  timestamp: number;
}

// We'll also cache the history fetched from the server
export interface CachedHistory {
  id: number;
  type: 'upcoming' | 'thesis';
  data: any;
  timestamp: number;
}

const db = new Dexie('CareerEdgeDB') as Dexie & {
  profile: EntityTable<UserProfile, 'id'>;
  offlineSessions: EntityTable<OfflineSession, 'localId'>;
  history: EntityTable<CachedHistory, 'id'>;
};

db.version(1).stores({
  profile: 'id, email',
  offlineSessions: 'localId, type, status',
  history: 'id, type'
});

export { db };
