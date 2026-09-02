import type { OfflineSessionMode } from '../db';

export type PreTestSessionExecution =
  | { mode: 'online'; serverSessionId: number }
  | { mode: 'offline'; clientSessionId: string }
  | { mode: 'invalid'; reason: 'unverified_session' };

type ResolvePreTestSessionExecutionInput = {
  sessionMode: OfflineSessionMode;
  activeSessionId: number | string;
  knownOfflineClientSessionId: string | null;
};

export const resolvePreTestSessionExecution = ({
  sessionMode,
  activeSessionId,
  knownOfflineClientSessionId,
}: ResolvePreTestSessionExecutionInput): PreTestSessionExecution => {
  const verifiedOfflineClientSessionId = knownOfflineClientSessionId?.trim() || null;
  const hasOfflineAuthority = sessionMode === 'offline' || verifiedOfflineClientSessionId !== null;

  if (hasOfflineAuthority) {
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
