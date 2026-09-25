import type { OfflineSessionMode } from '../db';
import { isOfflineClientSessionId, isPositiveServerSessionId } from './sessionIdentity';

export type DrillSessionExecution =
  | { mode: 'online'; serverSessionId: number }
  | { mode: 'offline'; clientSessionId: string }
  | { mode: 'invalid'; reason: 'unverified_session' };

type ResolveDrillSessionExecutionInput = {
  sessionMode: OfflineSessionMode;
  activeSessionId: number | string;
  knownOfflineClientSessionId: string | null;
};

export const resolveDrillSessionExecution = ({
  sessionMode,
  activeSessionId,
  knownOfflineClientSessionId,
}: ResolveDrillSessionExecutionInput): DrillSessionExecution => {
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
