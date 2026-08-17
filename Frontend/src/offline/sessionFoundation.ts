import type {
  AccountOfflineSession,
  ConversationTurn,
  OfflineActivityType,
  OfflineSessionMode,
} from '../db';
import type { OfflineAudioCapture } from './offlineAudioRecorder';

export interface OfflineAudioCheckpointInput {
  activityType: OfflineActivityType;
  turnId: string;
  answerIndex: number;
  capture: OfflineAudioCapture;
  transcriptText?: string;
}

export interface ActivitySessionStart {
  type: OfflineActivityType;
  mode?: OfflineSessionMode;
  clientSessionId?: string;
  serverSessionId?: number | null;
  currentStep?: number;
  currentQuestion?: string;
  conversationLog?: ConversationTurn[];
  responseCount?: number;
  answers?: AccountOfflineSession['answers'];
  audioReferences?: AccountOfflineSession['audioReferences'];
  eyeContactSummary?: AccountOfflineSession['eyeContactSummary'];
  questionPackVersion?: string | null;
  activityState?: AccountOfflineSession['activityState'];
}

export type ActivityCheckpointUpdate = Partial<Pick<
  AccountOfflineSession,
  | 'currentStep'
  | 'currentQuestion'
  | 'conversationLog'
  | 'responseCount'
  | 'answers'
  | 'audioReferences'
  | 'eyeContactSummary'
  | 'pendingEvaluation'
  | 'localEvaluation'
  | 'authoritativeResult'
  | 'localScore'
  | 'evaluationAuthority'
  | 'activityState'
  | 'questionPackVersion'
  | 'status'
  | 'completedAt'
  | 'lastError'
  | 'retryCount'
  | 'lastAttemptAt'
  | 'nextRetryAt'
  | 'lastErrorCode'
  | 'retryDisposition'
  | 'syncedAt'
  | 'syncState'
>>;

export type ActivitySessionEnd = 'cloud_completed' | 'abandoned' | 'completed_local';

export interface OfflineActivityBridgeProps {
  effectiveOnline: boolean;
  sessionMode: OfflineSessionMode;
  resumeSession: AccountOfflineSession | null;
  onActivityStart: (input: ActivitySessionStart) => Promise<AccountOfflineSession | null>;
  onActivityCheckpoint: (update: ActivityCheckpointUpdate) => Promise<boolean>;
  onActivityEnd: (outcome: ActivitySessionEnd) => Promise<boolean>;
  onOfflineAudioCaptured: (input: OfflineAudioCheckpointInput) => Promise<boolean>;
}

export const createClientSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

export const createActivityCheckpoint = (
  userId: number,
  input: ActivitySessionStart,
  mode: OfflineSessionMode = 'online',
  clientSessionId = input.clientSessionId ?? createClientSessionId(),
): AccountOfflineSession => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified backend user ID is required for an offline checkpoint.');
  }
  const now = Date.now();
  return {
    userId,
    type: input.type,
    localId: clientSessionId,
    clientSessionId,
    mode: input.mode ?? mode,
    status: 'in_progress',
    serverSessionId: input.serverSessionId ?? null,
    activityVersion: 1,
    questionPackVersion: input.questionPackVersion ?? null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    currentStep: input.currentStep ?? 0,
    responseCount: input.responseCount ?? 0,
    currentQuestion: input.currentQuestion ?? '',
    conversationLog: input.conversationLog ?? [],
    answers: input.answers ?? [],
    audioReferences: input.audioReferences ?? [],
    eyeContactSummary: input.eyeContactSummary ?? null,
    pendingEvaluation: null,
    localEvaluation: null,
    authoritativeResult: null,
    localScore: null,
    evaluationAuthority: null,
    activityState: input.activityState ?? {},
    retryCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    lastError: null,
    lastErrorCode: null,
    retryDisposition: null,
    syncedAt: null,
    syncState: 'not_ready',
    evaluation: null,
    timestamp: now,
  };
};

export const mergeActivityCheckpoint = (
  existing: AccountOfflineSession,
  update: ActivityCheckpointUpdate & { mode?: OfflineSessionMode },
): AccountOfflineSession => ({
  ...existing,
  ...update,
  mode: existing.mode === 'offline' ? 'offline' : (update.mode || existing.mode),
  userId: existing.userId,
  type: existing.type,
  localId: existing.localId,
  clientSessionId: existing.clientSessionId,
  serverSessionId: existing.serverSessionId,
  startedAt: existing.startedAt,
  updatedAt: Date.now(),
  timestamp: existing.timestamp,
});

export const createCompletedLocalCheckpoint = (
  existing: AccountOfflineSession,
): AccountOfflineSession => mergeActivityCheckpoint(existing, {
  status: 'completed_local',
  completedAt: Date.now(),
  syncState: 'not_ready',
});

export const createPendingSyncCheckpoint = (
  completed: AccountOfflineSession,
): AccountOfflineSession => {
  if (completed.status !== 'completed_local') {
    throw new Error('Only a safely persisted local completion can enter the sync queue.');
  }
  return mergeActivityCheckpoint(completed, {
    status: 'pending_sync',
    syncState: 'queued',
  });
};
