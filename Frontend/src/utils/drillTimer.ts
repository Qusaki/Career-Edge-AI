export const DRILL_TIMER_CONFIG = {
  jam: {
    durationSeconds: 60,
  },
} as const;

export type TimedDrillType = keyof typeof DRILL_TIMER_CONFIG;
export type DrillTimerPhase = 'ready' | 'running' | 'paused' | 'expired';

export type DrillTimerState = {
  durationSeconds: number;
  remainingSeconds: number;
  startedAt: number | null;
  endsAt: number | null;
  hasStarted: boolean;
  phase: DrillTimerPhase;
};

type SerializedDrillTimer = DrillTimerState;

const hasOwn = (value: object, key: PropertyKey): key is keyof typeof value => (
  Object.prototype.hasOwnProperty.call(value, key)
);

export const getDrillTimerConfig = (drillType: string) => (
  hasOwn(DRILL_TIMER_CONFIG, drillType) ? DRILL_TIMER_CONFIG[drillType] : null
);

export const createDrillTimerState = (drillType: string): DrillTimerState | null => {
  const config = getDrillTimerConfig(drillType);
  if (!config) return null;
  return {
    durationSeconds: config.durationSeconds,
    remainingSeconds: config.durationSeconds,
    startedAt: null,
    endsAt: null,
    hasStarted: false,
    phase: 'ready',
  };
};

export const getCurrentDrillTimerState = (
  timer: DrillTimerState,
  now = Date.now(),
): DrillTimerState => {
  if (timer.phase !== 'running' || timer.endsAt === null) return timer;
  const remainingSeconds = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  return remainingSeconds === 0
    ? { ...timer, remainingSeconds: 0, startedAt: null, endsAt: null, hasStarted: true, phase: 'expired' }
    : remainingSeconds !== timer.remainingSeconds
      ? { ...timer, remainingSeconds }
      : timer;
};

export const startDrillTimer = (
  timer: DrillTimerState,
  now = Date.now(),
): DrillTimerState => {
  if (timer.phase === 'expired' || timer.remainingSeconds <= 0) {
    return { ...timer, remainingSeconds: 0, startedAt: null, endsAt: null, hasStarted: true, phase: 'expired' };
  }
  if (timer.phase === 'running') return getCurrentDrillTimerState(timer, now);
  return {
    ...timer,
    startedAt: now,
    endsAt: now + timer.remainingSeconds * 1000,
    hasStarted: true,
    phase: 'running',
  };
};

export const pauseDrillTimer = (
  timer: DrillTimerState,
  now = Date.now(),
): DrillTimerState => {
  const current = getCurrentDrillTimerState(timer, now);
  if (current.phase === 'expired') return current;
  if (!current.hasStarted) return { ...current, startedAt: null, endsAt: null, phase: 'ready' };
  return { ...current, startedAt: null, endsAt: null, phase: 'paused' };
};

export const serializeDrillTimer = (timer: DrillTimerState | null): Record<string, unknown> => (
  timer ? { drillTimer: { ...timer } satisfies SerializedDrillTimer } : {}
);

export const restoreDrillTimer = (
  drillType: string,
  activityState: Record<string, unknown>,
  now = Date.now(),
): DrillTimerState | null => {
  const initial = createDrillTimerState(drillType);
  if (!initial) return null;
  const stored = activityState.drillTimer;
  if (stored === undefined) return initial;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...initial, remainingSeconds: 0, hasStarted: true, phase: 'expired' };
  }

  const candidate = stored as Partial<SerializedDrillTimer>;
  const validPhase = candidate.phase === 'ready'
    || candidate.phase === 'running'
    || candidate.phase === 'paused'
    || candidate.phase === 'expired';
  const validDuration = candidate.durationSeconds === initial.durationSeconds;
  const validRemaining = typeof candidate.remainingSeconds === 'number'
    && Number.isSafeInteger(candidate.remainingSeconds)
    && candidate.remainingSeconds >= 0
    && candidate.remainingSeconds <= initial.durationSeconds;
  const validStartedAt = candidate.startedAt === null
    || (typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt) && candidate.startedAt >= 0);
  const validEndsAt = candidate.endsAt === null
    || (typeof candidate.endsAt === 'number' && Number.isFinite(candidate.endsAt) && candidate.endsAt >= 0);
  const validStateCombination = candidate.phase === 'running'
    ? candidate.hasStarted === true && typeof candidate.startedAt === 'number' && typeof candidate.endsAt === 'number'
    : candidate.startedAt === null && candidate.endsAt === null;
  if (!validPhase || !validDuration || !validRemaining || !validStartedAt || !validEndsAt || !validStateCombination || typeof candidate.hasStarted !== 'boolean') {
    return { ...initial, remainingSeconds: 0, hasStarted: true, phase: 'expired' };
  }

  const restored: DrillTimerState = {
    durationSeconds: candidate.durationSeconds,
    remainingSeconds: candidate.remainingSeconds,
    startedAt: candidate.startedAt,
    endsAt: candidate.endsAt,
    hasStarted: candidate.hasStarted,
    phase: candidate.phase,
  };
  return getCurrentDrillTimerState(restored, now);
};

export const formatDrillTimer = (remainingSeconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
