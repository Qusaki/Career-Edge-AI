import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { AccountOfflineAudio, AccountOfflineSession } from '../src/db';
import { prepareRecordedAnswers, syncOfflineSession } from '../src/offline/offlineSyncClient';
import { createActivityCheckpoint, mergeActivityCheckpoint } from '../src/offline/sessionFoundation';
import { isClearlySilentAudio } from '../src/hooks/useSpeechInput';
import { SpeechTranscriptionError, transcribeAudioWithToken } from '../src/utils/transcribeAnswer';

test('digital silence is rejected without treating an unavailable analyser as silence', () => {
  assert.equal(isClearlySilentAudio(0, 0), false);
  assert.equal(isClearlySilentAudio(1, 0), false);
  assert.equal(isClearlySilentAudio(2, 0), true);
  assert.equal(isClearlySilentAudio(8, 0.0005), true);
  assert.equal(isClearlySilentAudio(8, 0.005), false);
});

const fixture = (type: AccountOfflineSession['type'], answerIndex = 1) => {
  const blob = new Blob(['OggS', 'spoken-answer'], { type: 'audio/ogg' });
  const session = mergeActivityCheckpoint(createActivityCheckpoint(7, {
    type, mode: 'offline', questionPackVersion: 'test-v1',
    activityState: type === 'drill' ? { drillType: 'jam', drillLevel: 'easy', prompt: 'Topic: teamwork' } : {},
  }, 'offline', 'client-session'), {
    status: 'pending_transcription',
    audioReferences: [{ audioId: 'audio-1', turnId: 'answer-1', answerIndex,
      mimeType: 'audio/ogg', sizeBytes: blob.size, durationMs: 1500, createdAt: 1, transcriptStatus: 'pending' }],
  });
  const audio: AccountOfflineAudio = {
    audioId: 'audio-1', userId: 7, clientSessionId: 'client-session', activityType: type,
    turnId: 'answer-1', answerIndex, mimeType: 'audio/ogg', blob, sizeBytes: blob.size,
    durationMs: 1500, createdAt: 1, updatedAt: 1, transcriptStatus: 'pending', transcriptText: null,
  };
  return { session, audio };
};

const store = (initial: AccountOfflineSession, audio: AccountOfflineAudio) => {
  let session = initial;
  let savedAudio = audio;
  return {
    getOfflineAudio: async (_userId: number, _audioId: string) => savedAudio,
    putOfflineAudio: async (next: AccountOfflineAudio) => { savedAudio = next; return ['key']; },
    updateOfflineSession: async (_userId: number, _type: AccountOfflineSession['type'], _localId: string,
      patch: Partial<AccountOfflineSession>) => { session = { ...session, ...patch }; return session; },
    getPendingOfflineSessions: async () => [session],
    audio: () => savedAudio,
    session: () => session,
  };
};

test('authenticated transcription accepts only a nonempty canonical transcript', async () => {
  const blob = new Blob(['OggS', 'spoken-answer'], { type: 'audio/ogg' });
  let calls = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    return Response.json({ transcript: 'Um, I I agree.' });
  }) as typeof fetch;
  assert.equal(await transcribeAudioWithToken('/api', 'test-token', blob, blob.size, fetchImpl), 'Um, I I agree.');
  assert.equal(calls, 1);
  await assert.rejects(
    transcribeAudioWithToken('/api', 'test-token', blob, blob.size, (async () => Response.json({ transcript: '   ' })) as typeof fetch),
    SpeechTranscriptionError,
  );
});

test('pending Who Am I audio becomes canonical text before text-only sync', async () => {
  const { session, audio } = fixture('pre_test_intro');
  const storage = store(session, audio);
  let calls = 0;
  const dependencies = { apiUrl: '/api', token: 'test-token', userId: 7, storage,
    fetchImpl: (async () => { calls += 1; return Response.json({ transcript: 'My name is Juan.' }); }) as typeof fetch };
  const prepared = await prepareRecordedAnswers(session, dependencies, storage);
  assert.deepEqual(prepared.answers.map(answer => answer.text), ['My name is Juan.']);
  assert.equal(prepared.status, 'pending_sync');
  assert.equal(prepared.audioReferences[0].transcriptStatus, 'available');
  assert.equal(storage.audio().transcriptText, 'My name is Juan.');
  assert.equal(calls, 1);
  // Replaying after a crash reuses the saved transcript and never calls the provider again.
  await prepareRecordedAnswers(session, dependencies, storage);
  assert.equal(calls, 1);
});

test('reconnect sends only canonical text and retries sync without retranscribing saved audio', async () => {
  const { session, audio } = fixture('pre_test_intro');
  const storage = store(session, audio);
  const requests: string[] = [];
  const dependencies = { apiUrl: '/api', token: 'test-token', userId: 7, storage,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      requests.push(path);
      if (path.endsWith('/speech/transcribe')) return Response.json({ transcript: 'I enjoy teamwork.' });
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.answers[0].text, 'I enjoy teamwork.');
      assert.doesNotMatch(String(init?.body), /OggS|spoken-answer|blob/);
      if (requests.filter(request => request.endsWith('/offline-sync')).length === 1) {
        return Response.json({ detail: 'Temporary failure' }, { status: 503 });
      }
      return Response.json({ synchronized: true, client_session_id: session.clientSessionId,
        activity_type: session.type, server_session_id: 42, authoritative_result: {} });
    }) as typeof fetch };
  await assert.rejects(syncOfflineSession(session, dependencies));
  assert.equal(storage.audio().transcriptText, 'I enjoy teamwork.');
  assert.equal(storage.session().status, 'sync_failed');
  const result = await syncOfflineSession(storage.session(), dependencies);
  assert.equal(result.status, 'synced');
  assert.equal(requests.filter(request => request.endsWith('/speech/transcribe')).length, 1);
});

test('Active Listening keeps story separate and appends only the user answer', async () => {
  const { session, audio } = fixture('pre_test_active_listening');
  session.conversationLog = [{ sender: 'ai', text: 'The workshop starts at eight.' }];
  const storage = store(session, audio);
  const prepared = await prepareRecordedAnswers(session, { apiUrl: '/api', token: 't', userId: 7, storage,
    fetchImpl: (async () => Response.json({ transcript: 'It begins at eight.' })) as typeof fetch }, storage);
  assert.deepEqual(prepared.conversationLog, [
    { sender: 'ai', text: 'The workshop starts at eight.' },
    { sender: 'user', text: 'It begins at eight.' },
  ]);
});

test('Drill and negotiation answers retain canonical task identity', async () => {
  for (const negotiation of [false, true]) {
    const { session, audio } = fixture('drill');
    session.activityState.drillType = negotiation ? 'negotiation' : 'jam';
    const storage = store(session, audio);
    const prepared = await prepareRecordedAnswers(session, { apiUrl: '/api', token: 't', userId: 7, storage,
      fetchImpl: (async () => Response.json({ transcript: 'I propose a fair solution.' })) as typeof fetch }, storage);
    assert.equal(prepared.answers[0].text, 'I propose a fair solution.');
    if (negotiation) assert.equal(prepared.conversationLog.at(-1)?.sender, 'user');
    else assert.equal(prepared.activityState.spokenResponse, 'I propose a fair solution.');
  }
});

test('wrong account, empty provider output, and failed transcription never create an answer', async () => {
  const { session, audio } = fixture('pre_test_intro');
  const wrongOwner = store(session, { ...audio, userId: 8 });
  await assert.rejects(prepareRecordedAnswers(session, { apiUrl: '/api', token: 't', userId: 7, storage: wrongOwner }, wrongOwner));
  assert.equal(wrongOwner.session().answers.length, 0);
  const storage = store(session, audio);
  await assert.rejects(prepareRecordedAnswers(session, { apiUrl: '/api', token: 't', userId: 7, storage,
    fetchImpl: (async () => Response.json({ transcript: '' })) as typeof fetch }, storage));
  assert.equal(storage.audio().transcriptStatus, 'pending');
  assert.equal(storage.session().answers.length, 0);
});

test('speech-only pages expose retry controls and no manual text inputs', () => {
  for (const page of ['PreTestPage.tsx', 'DrillsPage.tsx']) {
    const source = readFileSync(new URL(`../src/components/${page}`, import.meta.url), 'utf8');
    assert.match(source, /Retry Speech Processing/);
    assert.match(source, /speechOnlyFallback: true/);
    assert.match(source, /onPendingAudio: \(\) => setHasPendingOfflineAudio\(true\)/);
    assert.doesNotMatch(source, /<textarea\b|placeholder="Or type/);
  }
  const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(postTest, /speechOnlyFallback: true/);
});
