import type { AccountOfflineSession } from '../db';

type SessionSafetyRecord = Pick<AccountOfflineSession, 'mode' | 'status'>;

export const hasUnsyncedOfflineWork = (sessions: SessionSafetyRecord[]): boolean => (
  sessions.some(session => session.mode === 'offline' && session.status !== 'synced')
);

export const isUpdateSessionActive = ({
  activeTab,
  isModuleSessionMode,
  activeCheckpoint,
  isStartingInterview,
  thesisIsStarting,
}: {
  activeTab: string;
  isModuleSessionMode: boolean;
  activeCheckpoint: SessionSafetyRecord | null;
  isStartingInterview: boolean;
  thesisIsStarting: boolean;
}): boolean => (
  isModuleSessionMode
  || activeCheckpoint?.status === 'in_progress'
  || isStartingInterview
  || thesisIsStarting
  // Conservatively include practice entry screens while a child start is in flight.
  || ['pre-test', 'drills', 'post-test', 'interview-session', 'thesis-session'].includes(activeTab)
);
