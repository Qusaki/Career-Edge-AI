import type { OfflineSessionMode } from '../db';
import { isOfflineClientSessionId, isPositiveServerSessionId } from './sessionIdentity';

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
  const verifiedOfflineClientSessionId = isOfflineClientSessionId(knownOfflineClientSessionId)
    ? knownOfflineClientSessionId.trim() : null;
  const hasOfflineAuthority = sessionMode === 'offline' || verifiedOfflineClientSessionId !== null;

  if (hasOfflineAuthority) {
    return verifiedOfflineClientSessionId
      ? { mode: 'offline', clientSessionId: verifiedOfflineClientSessionId }
      : { mode: 'invalid', reason: 'unverified_session' };
  }

  if (isPositiveServerSessionId(activeSessionId)) {
    return { mode: 'online', serverSessionId: activeSessionId };
  }

  return { mode: 'invalid', reason: 'unverified_session' };
};
