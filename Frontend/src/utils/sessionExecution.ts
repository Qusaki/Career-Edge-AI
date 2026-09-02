import type { OfflineSessionMode } from '../db';

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
    const verifiedOfflineClientSessionId = knownOfflineClientSessionId?.trim() || null;
    return verifiedOfflineClientSessionId
      ? { mode: 'offline', clientSessionId: verifiedOfflineClientSessionId }
      : { mode: 'invalid', reason: 'unverified_session' };
  }

  if (
    typeof activeSessionId === 'number'
    && Number.isSafeInteger(activeSessionId)
    && activeSessionId > 0
  ) {
    return { mode: 'online', serverSessionId: activeSessionId };
  }

  return { mode: 'invalid', reason: 'unverified_session' };
};
