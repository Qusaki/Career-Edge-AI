import type { OfflineAudioCapture } from '../offline/offlineAudioRecorder';

export class SpeechTranscriptionError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}

const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 190_000;

export const transcribeAudioWithToken = async (
  apiUrl: string, token: string, blob: Blob, sizeBytes: number, fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  if (!sizeBytes || blob.size !== sizeBytes) {
    throw new SpeechTranscriptionError('No usable audio was recorded. Please speak and try again.', false);
  }
  if (!token) throw new SpeechTranscriptionError('Sign in again to process your saved recording.', false);
  const data = new FormData();
  data.append('file', blob, 'answer-audio');
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSCRIPTION_REQUEST_TIMEOUT_MS);
  try {
    response = await fetchImpl(`${apiUrl}/speech/transcribe`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data, signal: controller.signal,
    });
  } catch {
    throw new SpeechTranscriptionError('Speech processing is unavailable. Your recording is retained for retry.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 422) throw new SpeechTranscriptionError('No speech was detected. Your recording is retained for review.', false);
    if (response.status === 400 || response.status === 413 || response.status === 415) {
      throw new SpeechTranscriptionError('The recording cannot be processed. It remains saved on this device.', false);
    }
    throw new SpeechTranscriptionError('Speech processing is unavailable. Your recording is retained for retry.', response.status >= 500 || response.status === 429);
  }
  const body: unknown = await response.json().catch(() => null);
  const transcript = typeof body === 'object' && body !== null && 'transcript' in body
    && typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) throw new SpeechTranscriptionError('No speech was detected. Your recording is retained for review.', false);
  return transcript;
};

export const transcribeAnswer = (apiUrl: string, capture: OfflineAudioCapture): Promise<string> =>
  transcribeAudioWithToken(apiUrl, localStorage.getItem('token') || '', capture.blob, capture.sizeBytes);
