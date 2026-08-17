import {
  accountStorage,
  type AccountOfflineSession,
  type OfflineAudioReference,
} from '../db';

interface OfflineSyncResponse {
  synchronized: true;
  activity_type: AccountOfflineSession['type'];
  client_session_id: string;
  server_session_id: number;
  status: 'completed';
  evaluation_authority: 'server';
  authoritative_result: Record<string, unknown>;
  completed_at: string;
  idempotent_replay: boolean;
}

interface OfflineSyncErrorDetail {
  code?: string;
  message?: string;
  retryable?: boolean;
}

type SyncStorage = Pick<typeof accountStorage, 'updateOfflineSession' | 'getPendingOfflineSessions'>;

export interface OfflineSyncDependencies {
  apiUrl: string;
  token: string;
  userId: number;
  fetchImpl?: typeof fetch;
  storage?: SyncStorage;
  now?: () => number;
  requestTimeoutMs?: number;
  onSessionUpdated?: (session: AccountOfflineSession) => void;
}

export interface OfflineSyncWorkerOptions extends OfflineSyncDependencies {
  hasActiveOfflineSession: () => boolean;
  isCurrentUser?: () => boolean;
  isOnline?: () => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

export class OfflineSyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'OfflineSyncError';
  }
}

export const MAX_AUTOMATIC_SYNC_ATTEMPTS = 3;
export const AUTOMATIC_SYNC_BACKOFF_MS = [0, 30_000, 120_000] as const;
export const MAX_AUTOMATIC_SYNC_BACKOFF_MS = 120_000;
export const SYNC_REQUEST_TIMEOUT_MS = 60_000;

const activeSyncRuns = new Map<number, Promise<number>>();
const automaticAttempts = new Map<number, Map<string, number>>();

const toAudioManifest = (references: OfflineAudioReference[]) => references.map(reference => ({
  audio_id: reference.audioId,
  turn_id: reference.turnId,
  answer_index: reference.answerIndex,
  mime_type: reference.mimeType,
  size_bytes: reference.sizeBytes,
  duration_ms: reference.durationMs,
  transcript_status: reference.transcriptStatus,
}));

export const buildOfflineSyncPayload = (session: AccountOfflineSession) => {
  if (!session.questionPackVersion) {
    throw new OfflineSyncError(
      'This offline session uses an unsupported question version and needs manual attention.',
      'unsupported_question_pack',
      false,
    );
  }
  return {
    client_session_id: session.clientSessionId,
    activity_type: session.type,
    question_pack_version: session.questionPackVersion,
    server_session_id: session.serverSessionId,
    answers: session.answers.map(answer => ({
      step: answer.step,
      text: answer.text,
      created_at: answer.createdAt,
    })),
    conversation_log: session.conversationLog.map(turn => ({ sender: turn.sender, text: turn.text })),
    activity_state: session.activityState,
    eye_contact_summary: session.eyeContactSummary,
    audio_manifest: toAudioManifest(session.audioReferences),
    local_score: session.localScore,
    local_evaluation: session.localEvaluation,
    evaluation_authority: session.evaluationAuthority,
  };
};

const isRetryableStatus = (status: number) => (
  status === 408 || status === 425 || status === 429 || status >= 500
);

export const classifyOfflineSyncFailure = (
  status: number,
  detail: OfflineSyncErrorDetail | string | null,
  retryAfterHeader: string | null = null,
): OfflineSyncError => {
  const structured = detail && typeof detail === 'object' ? detail : null;
  const message = structured?.message
    || (typeof detail === 'string' ? detail : null)
    || `Offline synchronization failed with HTTP ${status}.`;
  const normalizedMessage = message.toLowerCase();
  const code = structured?.code || (
    status === 401 || status === 403 ? 'authorization_required'
      : status === 409 && normalizedMessage.includes('question-pack') ? 'unsupported_question_pack'
        : status === 409 && normalizedMessage.includes('transcription') ? 'transcription_required'
          : status === 409 && normalizedMessage.includes('already being synchronized') ? 'sync_in_progress'
            : status === 409 && normalizedMessage.includes('question order') ? 'validation_failed'
              : status === 409 ? 'payload_conflict'
        : status === 413 ? 'payload_too_large'
          : status === 422 ? 'validation_failed'
            : status >= 500 ? 'server_unavailable'
              : 'sync_rejected'
  );
  const retryable = typeof structured?.retryable === 'boolean'
    ? structured.retryable
    : isRetryableStatus(status);
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
  return new OfflineSyncError(
    message,
    code,
    retryable,
    status,
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1_000 : null,
  );
};

const readError = async (response: Response) => {
  const body = await response.json().catch(() => null) as { detail?: OfflineSyncErrorDetail | string } | null;
  return classifyOfflineSyncFailure(
    response.status,
    body?.detail ?? null,
    response.headers.get('Retry-After'),
  );
};

export const getAutomaticSyncBackoffMs = (failureCount: number) => {
  if (failureCount <= 0) return AUTOMATIC_SYNC_BACKOFF_MS[0];
  const index = Math.min(failureCount, AUTOMATIC_SYNC_BACKOFF_MS.length - 1);
  return Math.min(AUTOMATIC_SYNC_BACKOFF_MS[index], MAX_AUTOMATIC_SYNC_BACKOFF_MS);
};

const asSyncError = (error: unknown) => {
  if (error instanceof OfflineSyncError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new OfflineSyncError('Synchronization timed out. Career Edge will retry safely.', 'request_timeout', true);
  }
  return new OfflineSyncError(
    'Career Edge could not reach the synchronization service. Your work remains stored locally.',
    'network_error',
    true,
  );
};

export const syncOfflineSession = async (
  session: AccountOfflineSession,
  dependencies: OfflineSyncDependencies,
  options: { recoverSyncing?: boolean } = {},
): Promise<AccountOfflineSession> => {
  if (session.userId !== dependencies.userId) {
    throw new OfflineSyncError(
      'Offline session ownership does not match the current account.',
      'ownership_mismatch',
      false,
    );
  }
  const permittedStatuses = options.recoverSyncing
    ? ['pending_sync', 'sync_failed', 'syncing']
    : ['pending_sync', 'sync_failed'];
  if (!permittedStatuses.includes(session.status)) {
    throw new OfflineSyncError('Only completed offline sessions can be synchronized.', 'invalid_local_state', false);
  }

  const now = dependencies.now ?? Date.now;
  const attemptAt = now();
  const storage = dependencies.storage ?? accountStorage;
  const syncing = await storage.updateOfflineSession(
    dependencies.userId,
    session.type,
    session.localId,
    {
      status: 'syncing',
      syncState: 'syncing',
      lastAttemptAt: attemptAt,
      nextRetryAt: null,
      lastError: null,
      lastErrorCode: null,
      retryDisposition: null,
    },
  );
  if (!syncing) {
    throw new OfflineSyncError(
      'The owned offline session could not enter synchronization safely.',
      'local_state_unavailable',
      true,
    );
  }
  dependencies.onSessionUpdated?.(syncing);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.requestTimeoutMs ?? SYNC_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(`${dependencies.apiUrl}/offline-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dependencies.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOfflineSyncPayload(syncing)),
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    const result = await response.json() as OfflineSyncResponse;
    if (
      !result.synchronized
      || result.client_session_id !== syncing.clientSessionId
      || result.activity_type !== syncing.type
      || !Number.isSafeInteger(result.server_session_id)
    ) {
      throw new OfflineSyncError(
        'The server returned an invalid synchronization result.',
        'invalid_server_response',
        false,
      );
    }
    const saved = await storage.updateOfflineSession(
      dependencies.userId,
      syncing.type,
      syncing.localId,
      {
        status: 'synced',
        syncState: 'synced',
        serverSessionId: result.server_session_id,
        evaluationAuthority: 'server',
        authoritativeResult: result.authoritative_result,
        syncedAt: now(),
        nextRetryAt: null,
        lastError: null,
        lastErrorCode: null,
        retryDisposition: null,
      },
    );
    if (!saved) {
      throw new OfflineSyncError(
        'The server completed synchronization, but local reconciliation was interrupted.',
        'client_reconciliation_failed',
        true,
      );
    }
    dependencies.onSessionUpdated?.(saved);
    return saved;
  } catch (error) {
    const classified = asSyncError(error);
    const failureCount = syncing.retryCount + 1;
    const retryDelay = Math.max(
      getAutomaticSyncBackoffMs(failureCount),
      classified.retryAfterMs ?? 0,
    );
    const failed = await storage.updateOfflineSession(
      dependencies.userId,
      syncing.type,
      syncing.localId,
      {
        status: 'sync_failed',
        syncState: 'failed',
        retryCount: failureCount,
        lastAttemptAt: attemptAt,
        nextRetryAt: classified.retryable ? now() + retryDelay : null,
        lastError: classified.message.slice(0, 500),
        lastErrorCode: classified.code,
        retryDisposition: classified.retryable ? 'retryable' : 'manual_attention',
      },
    );
    if (failed) dependencies.onSessionUpdated?.(failed);
    throw classified;
  } finally {
    clearTimeout(timeout);
  }
};

const defaultSleep = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));

export const syncOfflineQueueWithRetry = (options: OfflineSyncWorkerOptions): Promise<number> => {
  const existing = activeSyncRuns.get(options.userId);
  if (existing) return existing;

  const run = (async () => {
    const storage = options.storage ?? accountStorage;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? defaultSleep;
    const userAttempts = automaticAttempts.get(options.userId) ?? new Map<string, number>();
    automaticAttempts.set(options.userId, userAttempts);
    let completed = 0;

    while (
      !options.hasActiveOfflineSession()
      && (options.isCurrentUser?.() ?? true)
      && (options.isOnline?.() ?? true)
    ) {
      const owned = await storage.getPendingOfflineSessions(options.userId);
      const retryable = owned.filter(session => {
        if (session.status === 'pending_sync' || session.status === 'syncing') return true;
        return session.status === 'sync_failed' && session.retryDisposition === 'retryable';
      }).filter(session => (userAttempts.get(session.clientSessionId) ?? 0) < MAX_AUTOMATIC_SYNC_ATTEMPTS);
      if (retryable.length === 0) break;

      const due = retryable.filter(session => session.status !== 'sync_failed' || (session.nextRetryAt ?? 0) <= now());
      if (due.length === 0) {
        const nextRetryAt = Math.min(...retryable.map(session => session.nextRetryAt ?? now()));
        await sleep(Math.min(Math.max(0, nextRetryAt - now()), MAX_AUTOMATIC_SYNC_BACKOFF_MS));
        continue;
      }

      for (const session of due) {
        if (
          options.hasActiveOfflineSession()
          || !(options.isCurrentUser?.() ?? true)
          || !(options.isOnline?.() ?? true)
        ) return completed;
        userAttempts.set(session.clientSessionId, (userAttempts.get(session.clientSessionId) ?? 0) + 1);
        try {
          await syncOfflineSession(session, options, { recoverSyncing: session.status === 'syncing' });
          completed += 1;
        } catch {
          // The classified local state controls whether another bounded attempt
          // is eligible. Other owned records still receive a sequential chance.
        }
      }
    }
    return completed;
  })().finally(() => {
    activeSyncRuns.delete(options.userId);
  });
  activeSyncRuns.set(options.userId, run);
  return run;
};

export const syncPendingSessionsOnce = syncOfflineQueueWithRetry;

export const retryOfflineSessionManually = (
  session: AccountOfflineSession,
  dependencies: OfflineSyncDependencies,
) => syncOfflineSession(session, dependencies, { recoverSyncing: session.status === 'syncing' });

export const resetOfflineSyncRuntimeForTests = () => {
  activeSyncRuns.clear();
  automaticAttempts.clear();
};
