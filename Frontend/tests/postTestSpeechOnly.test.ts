import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { AccountOfflineAudio, AccountOfflineSession } from '../src/db';
import { SpeechTranscriptAccumulator, type SpeechRecognitionResultLike } from '../src/hooks/useSpeechInput';
import { prepareRecordedAnswers } from '../src/offline/offlineSyncClient';
import { createActivityCheckpoint, mergeActivityCheckpoint } from '../src/offline/sessionFoundation';
import { getPostTestQuestions, POST_TEST_VERSION } from '../src/offline/questionPacks';

const postTest = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const result = (transcript: string, isFinal: boolean): SpeechRecognitionResultLike =>
  Object.assign([{ transcript }], { isFinal });

test('Post-Test has no typed input and routes one canonical spoken answer through the existing boundary', () => {
  assert.doesNotMatch(postTest, /<textarea\b|Or type your answer|onClick=\{\(\) => void sendReply\(\)\}|>Submit<|setReply\(/);
  assert.match(postTest, /'Speak Answer'/);
  assert.match(postTest, /\{liveTranscript \|\| <span className="text-muted">/);
  assert.match(postTest, /startListening\(transcript => void sendReply\(transcript, answerIndex\)/);
  assert.match(postTest, /if \(answerIndex !== expectedAnswerIndex\) return/);
  assert.match(postTest, /answerSubmissionInFlightRef\.current/);
  assert.match(postTest, /requireExactPostTestAnswerCount\(currentMessages\)/);
  assert.match(postTest, /recordedAnswerCountRef\.current >= POST_TEST_ANSWER_LIMIT/);
  assert.match(postTest, /resetSpeechTranscript\(\)[\s\S]*?messagesRef\.current = checkpointMessages/);
  assert.match(postTest, /const restoredRecordedCount = Math\.max\(/);
});

test('Post-Test cumulative recognition revisions replace full hypotheses without deleting real repeated words', () => {
  const transcript = new SpeechTranscriptAccumulator(true);
  for (const phrase of ['hello', 'hello my', 'hello my name', 'hello my name is']) {
    const state = transcript.applyResults({ resultIndex: 0, results: [result(phrase, false)] });
    assert.equal(state.liveTranscript, phrase);
    assert.equal(state.finalTranscript, '');
  }
  transcript.applyResults({ resultIndex: 0, results: [result('hello', true)] });
  assert.equal(transcript.applyResults({ resultIndex: 1, results: [result('hello', true), result('hello my name', false)] }).liveTranscript, 'hello my name');
  assert.equal(transcript.applyResults({ resultIndex: 1, results: [result('hello', true), result('hello my name is', true)] }).finalTranscript, 'hello my name is');
  assert.equal(transcript.applyResults({ resultIndex: 1, results: [result('hello', true), result('hello my name is', true)] }).finalTranscript, 'hello my name is');
  assert.equal(transcript.claimCanonicalTranscript(), 'hello my name is');
  assert.equal(transcript.claimCanonicalTranscript(), null);

  const repeated = new SpeechTranscriptAccumulator(true);
  repeated.applyResults({ resultIndex: 0, results: [result('I really, really enjoyed the experience.', true)] });
  assert.equal(repeated.claimCanonicalTranscript(), 'I really, really enjoyed the experience.');
  const repeatedAcrossSegments = new SpeechTranscriptAccumulator(true);
  repeatedAcrossSegments.applyResults({ resultIndex: 0, results: [result('I really', true)] });
  repeatedAcrossSegments.applyResults({ resultIndex: 1, results: [result('I really', true), result('really enjoyed the experience.', true)] });
  assert.equal(repeatedAcrossSegments.claimCanonicalTranscript(), 'I really really enjoyed the experience.');
  assert.match(hook, /event\.resultIndex/);
  assert.match(hook, /recognitionRef\.current !== recognition/);
});

test('browser final remains canonical; online fallback is used only without final speech', () => {
  assert.match(postTest, /transcribeCapture: capture => processOnlineAudio\(capture, answerIndex\)/);
  assert.match(postTest, /const transcript = await transcribeAnswer\(apiUrl, capture\)/);
  assert.match(postTest, /Retry Speech Processing/);
  assert.match(hook, /else if \(!canonicalTranscript\) \{[\s\S]*?transcribeCapture\(capture\)/);
  assert.match(hook, /session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
  assert.doesNotMatch(hook, /session\.onTranscript\(.*interimTranscript/);
});

test('offline Post-Test pending audio becomes five ordered canonical answers before sync', async () => {
  const questions = getPostTestQuestions('CCIT');
  const blob = new Blob(['OggS', 'spoken-answer'], { type: 'audio/ogg' });
  const references = [1, 3, 4, 5].map(index => ({
    audioId: `audio-${index}`, turnId: `post-test-${index}`, answerIndex: index,
    mimeType: 'audio/ogg', sizeBytes: blob.size, durationMs: 1500, createdAt: index,
    transcriptStatus: 'pending' as const,
  }));
  let session = mergeActivityCheckpoint(createActivityCheckpoint(7, {
    type: 'post_test', mode: 'offline', questionPackVersion: POST_TEST_VERSION,
    conversationLog: [
      { sender: 'ai', text: questions[0] }, { sender: 'ai', text: questions[1] },
      { sender: 'user', text: 'My second answer.' },
      ...questions.slice(2).map(text => ({ sender: 'ai' as const, text })),
    ],
    answers: [{ step: 2, text: 'My second answer.', createdAt: 2 }],
  }, 'offline', 'post-test-client'), {
    status: 'pending_transcription', audioReferences: references,
  });
  const audio = new Map<string, AccountOfflineAudio>(references.map(reference => [reference.audioId, {
    audioId: reference.audioId, userId: 7, clientSessionId: session.clientSessionId,
    activityType: 'post_test' as const, turnId: reference.turnId, answerIndex: reference.answerIndex,
    mimeType: reference.mimeType, blob, sizeBytes: blob.size, durationMs: 1500,
    createdAt: reference.createdAt, updatedAt: 1, transcriptStatus: 'pending' as const, transcriptText: null as string | null,
  }]));
  let calls = 0;
  const storage = {
    getOfflineAudio: async (_userId: number, audioId: string) => audio.get(audioId),
    putOfflineAudio: async (record: AccountOfflineAudio) => { audio.set(record.audioId, record); return ['saved']; },
    updateOfflineSession: async (_userId: number, _type: AccountOfflineSession['type'], _localId: string,
      patch: Partial<AccountOfflineSession>) => { session = { ...session, ...patch }; return session; },
    getPendingOfflineSessions: async () => [session],
  };
  const prepared = await prepareRecordedAnswers(session, {
    apiUrl: '/api', token: 'test-token', userId: 7, storage,
    fetchImpl: (async () => { calls += 1; return Response.json({ transcript: `My answer ${calls}.` }); }) as typeof fetch,
  }, storage);
  assert.equal(calls, 4);
  assert.equal(prepared.answers.length, 5);
  assert.deepEqual(prepared.answers.map(answer => answer.step), [1, 2, 3, 4, 5]);
  assert.equal(prepared.answers[1].text, 'My second answer.');
  assert.deepEqual(prepared.conversationLog.filter(turn => turn.sender === 'ai').map(turn => turn.text), questions);
  assert.deepEqual(prepared.conversationLog.filter(turn => turn.sender === 'user').map(turn => turn.text),
    prepared.answers.map(answer => answer.text));
  assert.equal(prepared.status, 'pending_sync');
});
