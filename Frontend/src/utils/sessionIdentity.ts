import type { AccountOfflineSession } from '../db';

export const isPositiveServerSessionId = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
);

export const isOfflineClientSessionId = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

export const hasRestorableOfflineIdentity = (
  session: Pick<AccountOfflineSession, 'mode' | 'localId' | 'clientSessionId' | 'serverSessionId'>,
): boolean => (
  session.mode === 'offline'
  && isOfflineClientSessionId(session.clientSessionId)
  && session.localId === session.clientSessionId
  && (session.serverSessionId == null || isPositiveServerSessionId(session.serverSessionId))
);
