import type { OfflineSessionMode } from '../db';
import { isOfflineClientSessionId, isPositiveServerSessionId } from './sessionIdentity';

export type SessionExecution =
  | { mode: 'online'; serverSessionId: number }
  | { mode: 'offline'; clientSessionId: string }
  | { mode: 'invalid'; reason: 'unverified_session' };

type ResolveSessionExecutionInput = {
  sessionMode: OfflineSessionMode;
  activeSessionId: unknown;
  knownOfflineClientSessionId: string | null;
};

export const resolveSessionExecution = ({
  sessionMode,
  activeSessionId,
  knownOfflineClientSessionId,
}: ResolveSessionExecutionInput): SessionExecution => {
  if (sessionMode === 'offline') {
    const verifiedOfflineClientSessionId = isOfflineClientSessionId(knownOfflineClientSessionId)
      ? knownOfflineClientSessionId.trim() : null;
    return verifiedOfflineClientSessionId
      ? { mode: 'offline', clientSessionId: verifiedOfflineClientSessionId }
      : { mode: 'invalid', reason: 'unverified_session' };
  }

  if (isPositiveServerSessionId(activeSessionId)) {
    return { mode: 'online', serverSessionId: activeSessionId };
  }

  return { mode: 'invalid', reason: 'unverified_session' };
};
