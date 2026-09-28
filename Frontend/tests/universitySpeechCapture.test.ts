import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isClearlySilentAudio, SpeechTranscriptAccumulator, type SpeechRecognitionResultLike } from '../src/hooks/useSpeechInput';
import { SpeechTranscriptionError, transcribeAudioWithToken } from '../src/utils/transcribeAnswer';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const speechHook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const sessionStart = dashboard.indexOf("activeTab === 'interview-session' && (");
const sessionEnd = dashboard.indexOf('{/* Leave Confirmation Modal */}', sessionStart);
const session = dashboard.slice(sessionStart, sessionEnd);
const microphoneStart = dashboard.indexOf('const toggleListening = async () =>');
const microphoneEnd = dashboard.indexOf('const continueCurrentActivityOffline =', microphoneStart);
const microphone = dashboard.slice(microphoneStart, microphoneEnd);

const result = (text: string, isFinal: boolean): SpeechRecognitionResultLike => Object.assign(
  [{ transcript: text }], { isFinal },
);

test('browser final stays the sole canonical answer and skips fallback transcription', () => {
  const accumulator = new SpeechTranscriptAccumulator();
  accumulator.applyResults({ resultIndex: 0, results: [result('My final answer', true)] });
  assert.equal(accumulator.claimCanonicalTranscript(), 'My final answer');
  assert.equal(accumulator.claimCanonicalTranscript(), null);
  assert.match(speechHook, /else if \(!canonicalTranscript\) \{\s*releaseMicrophone\(\);\s*fallbackAttempted = true;/);
  assert.match(speechHook, /session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
  assert.match(microphone, /void submitInterviewAnswer\(transcript\)/);
  assert.match(dashboard, /offlineAnswerSubmissionRef\.current = true/);
});

test('University records through its waveform stream and transcribes usable audio only when final speech is absent', async () => {
  assert.match(microphone, /onStreamReady: attachInterviewWaveform/);
  assert.match(microphone, /current\.type === 'upcoming' && typeof MediaRecorder !== 'undefined' \? \{\s*enabled: true,\s*transcribeCapture:/);
  assert.match(speechHook, /createOfflineAudioRecorder\(\{\s*stream: microphoneStream/);
  assert.match(speechHook, /!clearlySilent && capture\.sizeBytes >= 256 && capture\.durationMs >= 200/);
  assert.equal(isClearlySilentAudio(2, 0), true);
  assert.equal(isClearlySilentAudio(2, 0.005), false);

  const blob = new Blob(['recorded student speech'], { type: 'audio/webm' });
  let calls = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.equal(String(url), '/api/speech/transcribe');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    return Response.json({ transcript: 'I enjoy solving problems.' });
  }) as typeof fetch;
  assert.equal(await transcribeAudioWithToken('/api', 'token', blob, blob.size, fetchImpl), 'I enjoy solving problems.');
  assert.equal(calls, 1);
});

test('empty provider output cannot create an answer, and failed processing retains the recording for retry', async () => {
  const blob = new Blob(['recorded student speech'], { type: 'audio/webm' });
  await assert.rejects(
    transcribeAudioWithToken('/api', 'token', blob, blob.size,
      (async () => Response.json({ transcript: '   ' })) as typeof fetch),
    SpeechTranscriptionError,
  );
  assert.match(dashboard, /pendingEnrollmentAudioRef\.current = pending;[\s\S]*?await transcribeAnswer\(API_URL, pending\.capture\)/);
  assert.match(dashboard, /const pending = pendingEnrollmentAudioRef\.current;[\s\S]*?processEnrollmentAudio\(pending\)/);
  assert.match(dashboard, /if \(transcript\) void submitInterviewAnswer\(transcript\)/);
  assert.match(dashboard, /message\.includes\('No speech was detected'\)[\s\S]*?We couldn't process your speech/);
  assert.match(dashboard, /!isThesis && pendingEnrollmentAudio[\s\S]*?Retry Speech Processing/);
  assert.match(speechHook, /else if \(clearlySilent\) \{\s*session\.onError\?\.\('No speech was detected/);
});

test('one finalization and session-bound retry prevent duplicate University answers and AI turns', () => {
  assert.match(speechHook, /const canonicalTranscript = session\.accumulator\.claimCanonicalTranscript\(\);\s*if \(canonicalTranscript === null\) return/);
  assert.match(speechHook, /sessionRef\.current = null;[\s\S]*?session\.onTranscript\(canonicalTranscript \|\| fallbackTranscript\)/);
  assert.match(dashboard, /if \(enrollmentAudioProcessingRef\.current \|\| checkpoint\?\.type !== 'upcoming'/);
  assert.match(dashboard, /checkpoint\.clientSessionId !== pending\.clientSessionId[\s\S]*?checkpoint\.responseCount \+ 1 !== pending\.answerIndex/);
  assert.match(dashboard, /pendingEnrollmentAudioRef\.current = null;\s*setPendingEnrollmentAudio\(null\);\s*return transcript/);
  assert.match(dashboard, /if \(!text \|\| offlineAnswerSubmissionRef\.current\)/);
  assert.match(dashboard, /sendOnlineInterviewResponse\(mode, text, isFinal\)/);
});

test('processing, TTS exclusion, offline pending audio, and speech-only controls remain scoped to University', () => {
  assert.match(dashboard, /const isEnrollmentMicDisabled = isMicTransitioning \|\| isProcessingEnrollmentAudio/);
  assert.match(dashboard, /isProcessingEnrollmentAudio\s*\? 'Processing speech\.\.\.'/);
  assert.match(dashboard, /isAiSpeakingRef\.current \|\| window\.speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
  assert.match(dashboard, /!isThesis && \(isListening \|\| isMicTransitioning \|\| isProcessingEnrollmentAudio\)/);
  assert.match(dashboard, /activeInterviewModeRef\.current === 'enrollment'[\s\S]*?isListeningRef\.current \|\| isMicTransitioning \|\| enrollmentAudioProcessingRef\.current\)\) return/);
  assert.match(microphone, /speechOnlyFallback: current\.type === 'upcoming' \? true : undefined/);
  assert.match(microphone, /current\.type === 'upcoming'[\s\S]*?transcribeCapture:/);
  assert.match(session, /<EnrollmentMobileCameraFraming \/>/);
  assert.match(session, /onClick=\{toggleListening\}/);
  assert.match(session, /userAudioData\.map\(\(height, i\)/);
  assert.match(session, /Interview Transcript/);
  assert.doesNotMatch(session, /Typed answer fallback|Typed interview answer|Submit typed answer/);
});
