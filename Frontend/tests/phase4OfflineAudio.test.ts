import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { appendOfflineInterviewAnswer } from '../src/offline/interviewRuntime';
import {
  createOfflineAudioRecorder,
  getMicrophoneErrorMessage,
  hasStorageCapacity,
  MAX_OFFLINE_RECORDING_DURATION_MS,
  MAX_OFFLINE_RECORDING_SIZE_BYTES,
  selectSupportedAudioMimeType,
  toOfflineAudioRecord,
} from '../src/offline/offlineAudioRecorder';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
  mergeActivityCheckpoint,
} from '../src/offline/sessionFoundation';

class FakeMediaRecorder {
  static isTypeSupported(type: string) { return type === 'audio/webm;codecs=opus'; }
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType || 'audio/webm';
  }

  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['local-audio'], { type: this.mimeType }) } as BlobEvent);
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

const fakeStream = {
  getTracks: () => [{ stop() {} }],
} as unknown as MediaStream;

const withFakeRecorder = async (run: () => Promise<void>) => {
  const original = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
  try { await run(); } finally {
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: original });
  }
};

test('offline recorder negotiates compressed MIME and produces Blob metadata without network', async () => {
  await withFakeRecorder(async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('unexpected network'); }) as typeof fetch;
    try {
      const recorder = createOfflineAudioRecorder({ stream: fakeStream });
      assert.equal(await recorder.startRecording(), true);
      assert.equal(recorder.getState(), 'recording');
      const capture = await recorder.stopRecording();
      assert.ok(capture?.blob instanceof Blob);
      assert.equal(capture?.mimeType, 'audio/webm;codecs=opus');
      assert.equal(capture?.sizeBytes, capture?.blob.size);
      assert.equal(fetchCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
});

test('unsupported MediaRecorder and permission-style failures remain recoverable', async () => {
  const original = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
  try {
    const recorder = createOfflineAudioRecorder({ stream: fakeStream });
    assert.equal(await recorder.startRecording(), false);
    assert.equal(recorder.getState(), 'error');
  } finally {
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: original });
  }
  assert.match(getMicrophoneErrorMessage({ name: 'NotAllowedError' }), /permission was blocked/);
  assert.match(getMicrophoneErrorMessage({ name: 'NotFoundError' }), /No microphone/);
  assert.match(getMicrophoneErrorMessage({ name: 'NotReadableError' }), /busy or unavailable/);
  assert.match(getMicrophoneErrorMessage({ name: 'AbortError' }), /interrupted/);
  assert.match(getMicrophoneErrorMessage({ name: 'SecurityError' }), /permission was blocked/);
});

test('size-limit stop returns the valid accumulated Blob instead of losing it', async () => {
  await withFakeRecorder(async () => {
    let limit: string | null = null;
    const recorder = createOfflineAudioRecorder({
      stream: fakeStream,
      maxSizeBytes: 1,
      onLimitReached: reason => { limit = reason; },
    });
    await recorder.startRecording();
    const capture = await recorder.stopRecording();
    assert.equal(limit, 'size');
    assert.equal(capture?.limitReason, 'size');
    assert.ok((capture?.sizeBytes || 0) > 0);
  });
});

test('audio records retain exact account, session, and answer-turn ownership', () => {
  const capture = {
    blob: new Blob(['a'], { type: 'audio/webm' }), mimeType: 'audio/webm', sizeBytes: 1,
    durationMs: 1200, createdAt: 10, limitReason: null,
  } as const;
  const first = toOfflineAudioRecord({
    userId: 41, clientSessionId: 'session-a', activityType: 'upcoming', turnId: 'answer-1', answerIndex: 1,
  }, capture, 'Existing transcript');
  const second = toOfflineAudioRecord({
    userId: 41, clientSessionId: 'session-a', activityType: 'upcoming', turnId: 'answer-2', answerIndex: 2,
  }, capture);
  assert.notEqual(first.record.audioId, second.record.audioId);
  assert.equal(first.record.userId, 41);
  assert.equal(first.record.clientSessionId, 'session-a');
  assert.equal(first.record.transcriptText, 'Existing transcript');
  assert.equal(second.record.transcriptText, null);
  assert.equal(second.record.transcriptStatus, 'pending');
  assert.equal('blob' in first.reference, false);
  assert.equal(Object.values(first.reference).some(value => typeof value === 'string' && value.startsWith('blob:')), false);
});

test('account-scoped lookup and cleanup schema cannot address another user session', () => {
  const dbSource = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  assert.match(dbSource, /accountOfflineAudio:\s*'\[userId\+audioId\]/);
  assert.match(dbSource, /\.equals\(\[verifiedUserId, clientSessionId\]\)/);
  assert.match(dbSource, /deleteOfflineAudioForSession/);
  assert.match(dbSource, /transaction\('rw', db\.accountOfflineSessions, db\.accountOfflineAudio/);
});

test('audio references survive checkpoint restoration and pending sync completion', () => {
  const started = createActivityCheckpoint(7, { type: 'post_test', mode: 'offline' }, 'offline', 'stable-audio-session');
  const reference = {
    audioId: 'audio-1', turnId: 'post-test-1', answerIndex: 1, mimeType: 'audio/webm',
    sizeBytes: 100, durationMs: 900, createdAt: 20, transcriptStatus: 'available' as const,
  };
  const restored = mergeActivityCheckpoint(started, {
    audioReferences: [reference],
    answers: [{ step: 1, text: 'Real transcript', createdAt: 20 }],
  });
  const pending = createPendingSyncCheckpoint(createCompletedLocalCheckpoint(restored));
  assert.equal(pending.clientSessionId, 'stable-audio-session');
  assert.deepEqual(pending.audioReferences, [reference]);
  assert.equal(pending.answers[0].text, 'Real transcript');
});

test('an empty text response remains invalid even when audio metadata exists', () => {
  assert.throws(() => appendOfflineInterviewAnswer([], '   '), /required/);
});

test('quota and documented limits prevent uncontrolled storage growth', async () => {
  assert.equal(await hasStorageCapacity(500, async () => ({ usage: 900, quota: 1000 })), false);
  assert.equal(await hasStorageCapacity(50, async () => ({ usage: 900, quota: 1000 })), true);
  assert.equal(MAX_OFFLINE_RECORDING_DURATION_MS, 300_000);
  assert.equal(MAX_OFFLINE_RECORDING_SIZE_BYTES, 25 * 1024 * 1024);
});

test('Dexie v4 preserves v3 session stores and adds durable Blob storage outside Cache Storage', () => {
  const dbSource = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  assert.match(dbSource, /db\.version\(3\)\.stores/);
  assert.match(dbSource, /db\.version\(4\)\.stores/);
  assert.match(dbSource, /blob:\s*Blob/);
  assert.doesNotMatch(dbSource, /caches\.(?:open|match)|CacheStorage/);
});

test('all existing voice activities opt into shared audio persistence only while offline', () => {
  for (const file of ['PreTestPage.tsx', 'PostTestPage.tsx', 'DrillsPage.tsx']) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /sessionMode === 'offline'/);
    assert.match(source, /persistAudio: onOfflineAudioCaptured/);
  }
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /activeActivityCheckpointRef\.current\?\.mode === 'offline'/);
  assert.match(dashboard, /createOfflineAudioRecorder/);
  assert.match(dashboard, /URL\.createObjectURL/);
  assert.match(dashboard, /URL\.revokeObjectURL/);
});

test('online Gemini and lazy WebLLM contracts remain unchanged', () => {
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const webllm = readFileSync(new URL('../src/hooks/useWebLLM.ts', import.meta.url), 'utf8');
  assert.match(dashboard, /sendOnlineInterviewResponse/);
  assert.match(dashboard, /useWebLLM\([^\n]+, false\)/);
  assert.match(webllm, /availability !== 'cached_ready'/);
  assert.doesNotMatch(webllm, /auto.*download/i);
});

test('audio persistence model excludes credentials, video, and fabricated transcript text', () => {
  const dbSource = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  const recorderSource = readFileSync(new URL('../src/offline/offlineAudioRecorder.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(`${dbSource}\n${recorderSource}`, /JWT|Bearer|SECRET_KEY|AWS_SECRET|videoBlob/);
  assert.match(recorderSource, /transcriptText:\s*normalizedTranscript/);
  assert.match(recorderSource, /normalizedTranscript \? 'available' : 'pending'/);
});
