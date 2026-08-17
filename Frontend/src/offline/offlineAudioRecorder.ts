import type {
  AccountOfflineAudio,
  OfflineActivityType,
  OfflineAudioReference,
  OfflineAudioTranscriptStatus,
} from '../db';

export type OfflineRecorderState =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'error';

export interface OfflineAudioOwner {
  userId: number;
  clientSessionId: string;
  activityType: OfflineActivityType;
  turnId: string;
  answerIndex: number;
}

export interface OfflineAudioCapture {
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  limitReason: 'duration' | 'size' | null;
}

export interface OfflineAudioRecorderOptions {
  stream?: MediaStream;
  maxDurationMs?: number;
  maxSizeBytes?: number;
  storageHeadroomBytes?: number;
  onStateChange?: (state: OfflineRecorderState) => void;
  onLimitReached?: (reason: 'duration' | 'size') => void;
  onAutoStopped?: () => void;
}

export interface OfflineAudioRecorderController {
  getState: () => OfflineRecorderState;
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<OfflineAudioCapture | null>;
  cancelRecording: () => void;
  releaseRecorder: () => void;
  getStream: () => MediaStream | null;
}

export const MAX_OFFLINE_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const MAX_OFFLINE_RECORDING_SIZE_BYTES = 25 * 1024 * 1024;
export const OFFLINE_AUDIO_STORAGE_HEADROOM_BYTES = 2 * 1024 * 1024;
const MINIMUM_STARTING_HEADROOM_BYTES = 5 * 1024 * 1024;

const MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export const selectSupportedAudioMimeType = (
  MediaRecorderClass: typeof MediaRecorder | undefined = globalThis.MediaRecorder,
): string => {
  if (!MediaRecorderClass) return '';
  if (typeof MediaRecorderClass.isTypeSupported !== 'function') return '';
  return MIME_TYPE_CANDIDATES.find(type => MediaRecorderClass.isTypeSupported(type)) || '';
};

export const getMicrophoneErrorMessage = (error: unknown): string => {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === 'object' && error && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was blocked. Allow microphone access or use the typed answer.';
    case 'NotFoundError':
      return 'No microphone was found. Connect a microphone or use the typed answer.';
    case 'NotReadableError':
      return 'The microphone is busy or unavailable. Close other microphone apps or use the typed answer.';
    case 'AbortError':
      return 'Microphone startup was interrupted. Try again or use the typed answer.';
    default:
      return 'The microphone could not start. Try again or use the typed answer.';
  }
};

export const hasStorageCapacity = async (
  requiredBytes: number,
  estimate: (() => Promise<StorageEstimate>) | undefined = navigator.storage?.estimate?.bind(navigator.storage),
): Promise<boolean> => {
  if (!estimate) return true;
  try {
    const { usage, quota } = await estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return true;
    return quota - usage >= requiredBytes;
  } catch {
    return true;
  }
};

export const createOfflineAudioRecorder = (
  options: OfflineAudioRecorderOptions = {},
): OfflineAudioRecorderController => {
  const RecorderClass = globalThis.MediaRecorder;
  const maxDurationMs = options.maxDurationMs ?? MAX_OFFLINE_RECORDING_DURATION_MS;
  const maxSizeBytes = options.maxSizeBytes ?? MAX_OFFLINE_RECORDING_SIZE_BYTES;
  let state: OfflineRecorderState = 'idle';
  let stream: MediaStream | null = options.stream ?? null;
  let ownsStream = !options.stream;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let accumulatedBytes = 0;
  let startedAt = 0;
  let limitReason: OfflineAudioCapture['limitReason'] = null;
  let durationTimeout: ReturnType<typeof setTimeout> | null = null;
  let stopPromise: Promise<OfflineAudioCapture | null> | null = null;

  const setState = (next: OfflineRecorderState) => {
    state = next;
    options.onStateChange?.(next);
  };
  const clearDurationTimeout = () => {
    if (durationTimeout) clearTimeout(durationTimeout);
    durationTimeout = null;
  };
  const stopTracks = () => {
    if (ownsStream) stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };
  const requestStopForLimit = (reason: 'duration' | 'size') => {
    if (!recorder || recorder.state === 'inactive' || limitReason) return;
    limitReason = reason;
    options.onLimitReached?.(reason);
    try { recorder.stop(); } catch { /* The recorder may already be stopping. */ }
  };

  const startRecording = async () => {
    if (!RecorderClass) {
      setState('error');
      return false;
    }
    if (state === 'recording' || state === 'requesting_permission') return true;
    if (!await hasStorageCapacity(MINIMUM_STARTING_HEADROOM_BYTES)) {
      setState('error');
      throw new Error('Browser storage is too low to save another recording. Use the typed answer or clear local site data.');
    }
    setState('requesting_permission');
    if (!stream) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('error');
        return false;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      ownsStream = true;
    }
    const mimeType = selectSupportedAudioMimeType(RecorderClass);
    recorder = mimeType ? new RecorderClass(stream, { mimeType }) : new RecorderClass(stream);
    chunks = [];
    accumulatedBytes = 0;
    limitReason = null;
    startedAt = Date.now();
    stopPromise = new Promise(resolve => {
      const activeRecorder = recorder!;
      activeRecorder.onerror = () => {
        clearDurationTimeout();
        setState('error');
        stopTracks();
        resolve(null);
      };
      activeRecorder.onstop = () => {
        clearDurationTimeout();
        const createdAt = Date.now();
        const resolvedMimeType = activeRecorder.mimeType || chunks[0]?.type || 'application/octet-stream';
        const blob = new Blob(chunks, { type: resolvedMimeType });
        const capture = blob.size ? {
          blob,
          mimeType: resolvedMimeType,
          sizeBytes: blob.size,
          durationMs: Math.max(0, createdAt - startedAt),
          createdAt,
          limitReason,
        } : null;
        setState(capture ? 'recorded' : 'error');
        stopTracks();
        if (limitReason) options.onAutoStopped?.();
        resolve(capture);
      };
    });
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      chunks.push(event.data);
      accumulatedBytes += event.data.size;
      if (accumulatedBytes >= maxSizeBytes) requestStopForLimit('size');
    };
    recorder.start(1000);
    durationTimeout = setTimeout(() => requestStopForLimit('duration'), maxDurationMs);
    setState('recording');
    return true;
  };

  const stopRecording = () => {
    if (!recorder) return Promise.resolve(null);
    const completion = stopPromise ?? Promise.resolve(null);
    if (recorder.state === 'inactive') return completion;
    setState('stopping');
    try { recorder.stop(); } catch { return Promise.resolve(null); }
    return completion;
  };

  const cancelRecording = () => {
    clearDurationTimeout();
    chunks = [];
    accumulatedBytes = 0;
    try { if (recorder?.state !== 'inactive') recorder?.stop(); } catch { /* Already stopped. */ }
    recorder = null;
    stopTracks();
    setState('idle');
  };

  const releaseRecorder = () => {
    if (state === 'recording') cancelRecording();
    else stopTracks();
    recorder = null;
    clearDurationTimeout();
    if (state !== 'recorded') setState('idle');
  };

  return { getState: () => state, startRecording, stopRecording, cancelRecording, releaseRecorder, getStream: () => stream };
};

export const createAudioId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `audio-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const toOfflineAudioRecord = (
  owner: OfflineAudioOwner,
  capture: OfflineAudioCapture,
  transcriptText?: string,
): { record: AccountOfflineAudio; reference: OfflineAudioReference } => {
  const audioId = createAudioId();
  const normalizedTranscript = transcriptText?.replace(/\s+/g, ' ').trim() || null;
  const transcriptStatus: OfflineAudioTranscriptStatus = normalizedTranscript ? 'available' : 'pending';
  const record: AccountOfflineAudio = {
    ...owner,
    audioId,
    blob: capture.blob,
    mimeType: capture.mimeType,
    sizeBytes: capture.sizeBytes,
    durationMs: capture.durationMs,
    createdAt: capture.createdAt,
    updatedAt: capture.createdAt,
    transcriptStatus,
    transcriptText: normalizedTranscript,
  };
  const { blob: _blob, userId: _userId, clientSessionId: _sessionId, activityType: _activityType, updatedAt: _updatedAt, transcriptText: _transcriptText, ...reference } = record;
  return { record, reference };
};
