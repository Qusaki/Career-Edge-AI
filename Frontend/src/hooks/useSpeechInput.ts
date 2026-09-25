import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOfflineAudioRecorder,
  getMicrophoneErrorMessage,
  type OfflineAudioCapture,
  type OfflineAudioRecorderController,
} from '../offline/offlineAudioRecorder';
import type { OfflineActivityType } from '../db';

type TranscriptHandler = (transcript: string) => void;
type ErrorHandler = (message: string) => void;

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

export type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

export type SpeechRecognitionResultListLike = {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
};

export type SpeechRecognitionResultEventLike = {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

type BrowserSpeechRecognitionErrorEvent = {
  readonly error: string;
  readonly message?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export type SpeechTranscriptState = {
  finalTranscript: string;
  interimTranscript: string;
  liveTranscript: string;
};

const EMPTY_TRANSCRIPT_STATE: SpeechTranscriptState = {
  finalTranscript: '',
  interimTranscript: '',
  liveTranscript: '',
};

export const normalizeSpeechWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const mergeSpeechFragments = (...fragments: string[]) => normalizeSpeechWhitespace(
  fragments.map(normalizeSpeechWhitespace).filter(Boolean).join(' '),
);

export class SpeechTranscriptAccumulator {
  private finalParts: string[] = [];
  private interimTranscript = '';
  private committedResultIndexes = new Set<number>();
  private deliveryClaimed = false;

  resetWindow() {
    this.finalParts = [];
    this.interimTranscript = '';
    this.committedResultIndexes.clear();
    this.deliveryClaimed = false;
  }

  beginRecognitionAttempt() {
    this.interimTranscript = '';
    this.committedResultIndexes.clear();
  }

  applyResults(event: SpeechRecognitionResultEventLike) {
    const firstChangedIndex = Math.max(0, event.resultIndex);
    for (let index = firstChangedIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result?.isFinal || this.committedResultIndexes.has(index)) continue;
      const text = normalizeSpeechWhitespace(result[0]?.transcript ?? '');
      if (text) this.finalParts.push(text);
      this.committedResultIndexes.add(index);
    }

    const currentInterimParts: string[] = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result || result.isFinal) continue;
      const text = normalizeSpeechWhitespace(result[0]?.transcript ?? '');
      if (text) currentInterimParts.push(text);
    }
    this.interimTranscript = mergeSpeechFragments(...currentInterimParts);
    return this.snapshot();
  }

  snapshot(): SpeechTranscriptState {
    const finalTranscript = mergeSpeechFragments(...this.finalParts);
    return {
      finalTranscript,
      interimTranscript: this.interimTranscript,
      liveTranscript: mergeSpeechFragments(finalTranscript, this.interimTranscript),
    };
  }

  claimCanonicalTranscript() {
    if (this.deliveryClaimed) return null;
    this.deliveryClaimed = true;
    return this.snapshot().finalTranscript;
  }
}

export interface OfflineSpeechAudioOptions {
  enabled: boolean;
  activityType: OfflineActivityType;
  turnId: string;
  answerIndex: number;
  persistAudio: (input: {
    activityType: OfflineActivityType;
    turnId: string;
    answerIndex: number;
    capture: OfflineAudioCapture;
    transcriptText?: string;
  }) => Promise<boolean>;
  onAudioCaptured?: (capture: OfflineAudioCapture) => void;
}

export type SpeechInputStreamHandlers = {
  onStreamReady?: (stream: MediaStream) => void;
  onStreamReleased?: () => void;
};

type RecognitionSession = {
  onTranscript: TranscriptHandler;
  onError?: ErrorHandler;
  accumulator: SpeechTranscriptAccumulator;
  retryCount: number;
  fatalError: boolean;
  failureMessage: string | null;
  recognitionReadyEver: boolean;
  resolvingPermission: boolean;
  cancelled: boolean;
  offlineAudio?: OfflineSpeechAudioOptions;
};

export const MAX_RECOGNITION_RESTARTS = 3;
const RECOGNITION_START_TIMEOUT_MS = 4000;
const RECOGNITION_FINALIZATION_TIMEOUT_MS = 3000;

export const canRetryRecognition = (retryCount: number, userStillListening: boolean, voiceActive: boolean) =>
  userStillListening && !voiceActive && retryCount <= MAX_RECOGNITION_RESTARTS;

export const selectSpeechRecognition = (host: Pick<Window, 'SpeechRecognition' | 'webkitSpeechRecognition'>) =>
  host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return selectSpeechRecognition(window);
};

export type SpeechCapabilities = {
  browser: boolean;
  secureContext: boolean;
  microphone: boolean;
  recognition: boolean;
};

export const getSpeechSupportMessage = (capabilities: SpeechCapabilities = {
  browser: typeof window !== 'undefined',
  secureContext: typeof window !== 'undefined' && window.isSecureContext,
  microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
  recognition: Boolean(getSpeechRecognition()),
}) => {
  if (!capabilities.browser) return 'Speech recognition is only available in the browser.';
  if (!capabilities.secureContext) {
    return 'Microphone access requires HTTPS or localhost. Open this app with https:// or http://localhost, then try again.';
  }
  if (!capabilities.microphone) {
    return 'This browser cannot access the microphone from this page. Use Chrome or Edge on HTTPS or localhost.';
  }
  if (!capabilities.recognition) return 'Speech recognition is not supported in this browser. Please use Chrome or Edge.';
  return null;
};

const getSpeechErrorMessage = (event: BrowserSpeechRecognitionErrorEvent) => {
  switch (event.error) {
    case 'not-allowed':
      return 'Microphone access was blocked. Allow microphone permission for this site, then try again.';
    case 'service-not-allowed':
      return 'The browser speech service is blocked. Check browser speech settings or use the typed answer.';
    case 'audio-capture':
      return 'No microphone was found. Check that your microphone is connected and available.';
    case 'network':
      return 'The browser speech service is unavailable right now. Check your internet connection, then try again in Chrome or Edge.';
    default:
      return 'Speech recognition stopped unexpectedly. Please try the mic again.';
  }
};

export const getMicrophoneFailureMessage = (error: unknown, permissionState?: PermissionState) => {
  const name = error instanceof DOMException ? error.name :
    typeof error === 'object' && error && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' && permissionState === 'prompt') {
    return 'Microphone permission was dismissed. Allow access in the browser prompt, or use the typed answer.';
  }
  return getMicrophoneErrorMessage(error);
};

const readMicrophonePermissionState = async (): Promise<PermissionState | undefined> => {
  if (!navigator.permissions?.query) return undefined;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then(result => result.state),
      new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), 500);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export function useSpeechInput() {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const streamHandlersRef = useRef<SpeechInputStreamHandlers | null>(null);
  const offlineRecorderRef = useRef<OfflineAudioRecorderController | null>(null);
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  const sessionRef = useRef<RecognitionSession | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRecognitionRef = useRef<(() => void) | null>(null);
  const requestGenerationRef = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRecognitionReady, setIsRecognitionReady] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [hasUnfinalizedTranscript, setHasUnfinalizedTranscript] = useState(false);
  const [transcriptState, setTranscriptState] = useState<SpeechTranscriptState>(EMPTY_TRANSCRIPT_STATE);

  const clearRestart = useCallback(() => {
    if (!restartTimeoutRef.current) return;
    clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = null;
  }, []);

  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
  }, []);

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    streamHandlersRef.current?.onStreamReleased?.();
    streamHandlersRef.current = null;
  }, []);

  const resetTranscript = useCallback(() => {
    sessionRef.current?.accumulator.resetWindow();
    setTranscriptState(EMPTY_TRANSCRIPT_STATE);
    setHasUnfinalizedTranscript(false);
  }, []);

  const deliverTranscript = useCallback(async () => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    const session = sessionRef.current;
    if (!session || session.cancelled) return;
    const canonicalTranscript = session.accumulator.claimCanonicalTranscript();
    if (canonicalTranscript === null) return;

    const snapshot = session.accumulator.snapshot();
    setTranscriptState(snapshot);
    setHasUnfinalizedTranscript(!canonicalTranscript && Boolean(snapshot.interimTranscript));
    sessionRef.current = null;
    setIsListening(false);
    setIsRecognitionReady(false);

    let audioWasSaved = false;
    if (session.offlineAudio) {
      const capture = await offlineRecorderRef.current?.stopRecording() ?? null;
      if (capture) {
        const persisted = await session.offlineAudio.persistAudio({
          activityType: session.offlineAudio.activityType,
          turnId: session.offlineAudio.turnId,
          answerIndex: session.offlineAudio.answerIndex,
          capture,
          transcriptText: canonicalTranscript || undefined,
        });
        if (!persisted) {
          session.onError?.('The recording could not be saved locally. Your answer was not advanced; retry or use the typed answer.');
          offlineRecorderRef.current?.releaseRecorder();
          offlineRecorderRef.current = null;
          releaseMicrophone();
          setIsFinalizing(false);
          return;
        }
        audioWasSaved = true;
        session.offlineAudio.onAudioCaptured?.(capture);
      }
    }
    offlineRecorderRef.current?.releaseRecorder();
    offlineRecorderRef.current = null;
    releaseMicrophone();
    setIsFinalizing(false);

    if (canonicalTranscript) session.onTranscript(canonicalTranscript);
    else if (snapshot.interimTranscript) {
      session.onError?.("We couldn't finalize that speech. Review it below, then try speaking again or use the typed answer.");
    } else if (session.failureMessage) {
      session.onError?.(session.failureMessage);
    } else if (!session.recognitionReadyEver) {
      session.onError?.('Speech recognition did not start. Try again or use the typed answer.');
    } else if (session.offlineAudio) {
      session.onError?.(audioWasSaved
        ? 'No speech was detected. Your audio was saved locally; try again or type an answer.'
        : 'No speech was detected. No audio file was saved; try again or type an answer.');
    } else session.onError?.('No speech was detected. Please try again.');
  }, [releaseMicrophone]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current && !startingRef.current) return;
    if (startingRef.current) {
      requestGenerationRef.current += 1;
      startingRef.current = false;
      setIsListening(false);
      setIsRecognitionReady(false);
      return;
    }
    listeningRef.current = false;
    startingRef.current = false;
    clearRestart();
    clearStartTimeout();
    setIsListening(false);
    setIsRecognitionReady(false);
    setIsFinalizing(true);
    const recognition = recognitionRef.current;
    if (!recognition) {
      void deliverTranscript();
      return;
    }
    try {
      recognition.stop();
      stopTimeoutRef.current = setTimeout(() => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        try { recognition.abort(); } catch { /* The browser may already have ended it. */ }
        void deliverTranscript();
      }, RECOGNITION_FINALIZATION_TIMEOUT_MS);
    } catch {
      recognitionRef.current = null;
      void deliverTranscript();
    }
  }, [clearRestart, clearStartTimeout, deliverTranscript]);

  const cancelListening = useCallback(() => {
    requestGenerationRef.current += 1;
    listeningRef.current = false;
    startingRef.current = false;
    clearRestart();
    clearStartTimeout();
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = null;
    if (sessionRef.current) sessionRef.current.cancelled = true;
    sessionRef.current = null;
    offlineRecorderRef.current?.cancelRecording();
    offlineRecorderRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch { /* Chrome can throw when recognition already ended. */ }
    releaseMicrophone();
    setIsListening(false);
    setIsFinalizing(false);
    setIsRecognitionReady(false);
    setTranscriptState(EMPTY_TRANSCRIPT_STATE);
    setHasUnfinalizedTranscript(false);
  }, [clearRestart, clearStartTimeout, releaseMicrophone]);

  useEffect(() => {
    setIsSupported(!getSpeechSupportMessage());
    const resumeAfterVisibilityChange = () => {
      if (document.visibilityState === 'visible' && listeningRef.current && !recognitionRef.current && !restartTimeoutRef.current) {
        startRecognitionRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', resumeAfterVisibilityChange);
    return () => {
      requestGenerationRef.current += 1;
      document.removeEventListener('visibilitychange', resumeAfterVisibilityChange);
      listeningRef.current = false;
      startingRef.current = false;
      clearRestart();
      clearStartTimeout();
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
      if (sessionRef.current) sessionRef.current.cancelled = true;
      sessionRef.current = null;
      offlineRecorderRef.current?.cancelRecording();
      offlineRecorderRef.current = null;
      try { recognitionRef.current?.abort(); } catch { /* Chrome can throw when recognition already ended. */ }
      recognitionRef.current = null;
      releaseMicrophone();
    };
  }, [clearRestart, clearStartTimeout, releaseMicrophone]);

  const startListening = useCallback(async (
    onTranscript: TranscriptHandler,
    onError?: ErrorHandler,
    offlineAudio?: OfflineSpeechAudioOptions,
    streamHandlers?: SpeechInputStreamHandlers,
  ) => {
    const supportMessage = getSpeechSupportMessage();
    if (supportMessage && (!offlineAudio?.enabled || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
      setIsSupported(false);
      onError?.(supportMessage);
      return false;
    }
    if (offlineAudio?.enabled && typeof MediaRecorder === 'undefined') {
      onError?.('This browser cannot record audio locally. Use the typed answer instead.');
      return false;
    }
    if (listeningRef.current || startingRef.current || isFinalizing) return false;
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      onError?.('Wait for the audio prompt to finish before starting the microphone.');
      return false;
    }

    clearRestart();
    setTranscriptState(EMPTY_TRANSCRIPT_STATE);
    setHasUnfinalizedTranscript(false);
    setIsRecognitionReady(false);
    const SpeechRecognition = getSpeechRecognition();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    startingRef.current = true;
    // SpeechRecognition owns microphone capture on its own. Opening a second
    // getUserMedia stream is only necessary for offline recording or Enrollment's
    // waveform; doing it for every activity can contend with mobile recognizers.
    let microphoneStream: MediaStream | null = null;
    if (offlineAudio?.enabled || streamHandlers?.onStreamReady) {
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        if (requestGenerationRef.current !== requestGeneration) return false;
        startingRef.current = false;
        const permissionState = await readMicrophonePermissionState();
        if (requestGenerationRef.current !== requestGeneration) return false;
        onError?.(getMicrophoneFailureMessage(error, permissionState));
        return false;
      }
    }
    if (requestGenerationRef.current !== requestGeneration) {
      microphoneStream?.getTracks().forEach(track => track.stop());
      return false;
    }

    const accumulator = new SpeechTranscriptAccumulator();
    sessionRef.current = {
      onTranscript,
      onError,
      accumulator,
      retryCount: 0,
      fatalError: false,
      failureMessage: SpeechRecognition ? null : 'Speech recognition is unavailable in this browser. Audio can be saved locally; type your answer to continue.',
      recognitionReadyEver: false,
      resolvingPermission: false,
      cancelled: false,
      offlineAudio: offlineAudio?.enabled ? offlineAudio : undefined,
    };
    microphoneStreamRef.current = microphoneStream;
    streamHandlersRef.current = streamHandlers ?? null;
    if (microphoneStream) streamHandlers?.onStreamReady?.(microphoneStream);

    if (offlineAudio?.enabled) {
      if (!microphoneStream) {
        startingRef.current = false;
        sessionRef.current = null;
        onError?.('Local audio recording could not start. Use the typed answer instead.');
        return false;
      }
      offlineRecorderRef.current = createOfflineAudioRecorder({
        stream: microphoneStream,
        onLimitReached: reason => onError?.(
          reason === 'duration'
            ? 'The five-minute recording limit was reached. Stop the mic to save it, then type an answer if needed.'
            : 'The 25 MB recording limit was reached. Stop the mic to save it, then type an answer if needed.',
        ),
      });
      try {
        if (!await offlineRecorderRef.current.startRecording()) {
          startingRef.current = false;
          sessionRef.current = null;
          offlineRecorderRef.current = null;
          releaseMicrophone();
          onError?.('Local audio recording is unavailable. Use the typed answer instead.');
          return false;
        }
      } catch (error) {
        startingRef.current = false;
        sessionRef.current = null;
        offlineRecorderRef.current = null;
        releaseMicrophone();
        onError?.(error instanceof Error ? error.message : 'Local audio recording could not start. Use the typed answer instead.');
        return false;
      }
    }
    if (requestGenerationRef.current !== requestGeneration) {
      offlineRecorderRef.current?.cancelRecording();
      offlineRecorderRef.current = null;
      sessionRef.current = null;
      releaseMicrophone();
      return false;
    }
    startingRef.current = false;
    listeningRef.current = true;
    setIsListening(true);

    const finishRecognitionFailure = (session: RecognitionSession, message: string) => {
      if (session.cancelled || sessionRef.current !== session) return;
      session.fatalError = true;
      session.failureMessage = message;
      listeningRef.current = false;
      clearRestart();
      clearStartTimeout();
      setIsListening(false);
      setIsRecognitionReady(false);
      setIsFinalizing(true);
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try { recognition?.abort(); } catch { /* It may already have stopped. */ }
      void deliverTranscript();
    };

    const scheduleRestart = (session: RecognitionSession, delay: number, failureMessage: string) => {
      if (!listeningRef.current || restartTimeoutRef.current || session.cancelled) return;
      session.failureMessage = failureMessage;
      session.retryCount += 1;
      if (!canRetryRecognition(
        session.retryCount,
        listeningRef.current,
        Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending),
      )) {
        finishRecognitionFailure(session, failureMessage);
        return;
      }
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null;
        if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
          finishRecognitionFailure(session, 'The audio prompt resumed while the microphone was listening. Try again after it finishes.');
        } else startRecognitionRef.current?.();
      }, delay);
    };

    const startRecognition = () => {
      const session = sessionRef.current;
      if (!listeningRef.current || !session || session.fatalError || session.cancelled || !SpeechRecognition) return;
      if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
        finishRecognitionFailure(session, 'Wait for the audio prompt to finish before starting the microphone.');
        return;
      }
      session.accumulator.beginRecognitionAttempt();
      setTranscriptState(session.accumulator.snapshot());
      let recognition: BrowserSpeechRecognition;
      try {
        recognition = new SpeechRecognition();
      } catch {
        finishRecognitionFailure(session, 'Speech recognition is unavailable in this browser. Use the typed answer instead.');
        return;
      }
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        clearStartTimeout();
        if (recognitionRef.current === recognition && listeningRef.current) {
          session.recognitionReadyEver = true;
          session.failureMessage = null;
          setIsRecognitionReady(true);
        }
      };
      recognition.onresult = event => {
        if (session.cancelled) return;
        clearStartTimeout();
        session.recognitionReadyEver = true;
        setTranscriptState(session.accumulator.applyResults(event));
      };
      recognition.onerror = event => {
        clearStartTimeout();
        setIsRecognitionReady(false);
        if (event.error === 'not-allowed') {
          session.resolvingPermission = true;
          session.fatalError = true;
          listeningRef.current = false;
          setIsListening(false);
          setIsFinalizing(true);
          recognitionRef.current = null;
          void readMicrophonePermissionState().then(permissionState => {
            session.resolvingPermission = false;
            finishRecognitionFailure(session, getMicrophoneFailureMessage(
              new DOMException('Microphone permission was not granted.', 'NotAllowedError'),
              permissionState,
            ));
          });
          return;
        }
        if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network') {
          if (recognitionRef.current === recognition) recognitionRef.current = null;
          try { recognition.abort(); } catch { /* The browser may already have ended this recognizer. */ }
          const failureMessage = event.error === 'no-speech'
            ? 'No speech was detected. Please try again or use the typed answer.'
            : getSpeechErrorMessage(event);
          const delay = event.error === 'network'
            ? Math.min(4000, 500 * (2 ** Math.min(session.retryCount, 3)))
            : 250;
          scheduleRestart(session, delay, failureMessage);
          return;
        }
        finishRecognitionFailure(session, getSpeechErrorMessage(event));
      };
      recognition.onend = () => {
        clearStartTimeout();
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setIsRecognitionReady(false);
        if (session.cancelled || session.resolvingPermission) return;
        if (listeningRef.current && !session.fatalError) {
          scheduleRestart(session, 250, 'Speech recognition stopped unexpectedly. Please try the mic again or use the typed answer.');
          return;
        }
        void deliverTranscript();
      };
      recognitionRef.current = recognition;
      startTimeoutRef.current = setTimeout(() => {
        if (recognitionRef.current !== recognition || !listeningRef.current) return;
        recognitionRef.current = null;
        try { recognition.abort(); } catch { /* The browser may have stopped. */ }
        scheduleRestart(session, 250, 'Speech recognition did not start. Try again or use the typed answer.');
      }, RECOGNITION_START_TIMEOUT_MS);
      try {
        recognition.start();
      } catch {
        clearStartTimeout();
        recognitionRef.current = null;
        scheduleRestart(session, Math.min(2000, 300 * (session.retryCount + 1)), 'Speech recognition could not start. Try again or use the typed answer.');
      }
    };

    startRecognitionRef.current = startRecognition;
    if (SpeechRecognition) startRecognition();
    else onError?.('Speech recognition is unavailable offline. Audio will still be saved; type your answer to continue.');
    return true;
  }, [clearRestart, clearStartTimeout, deliverTranscript, isFinalizing, releaseMicrophone]);

  const enableOfflineRecording = useCallback(async (offlineAudio: OfflineSpeechAudioOptions) => {
    const session = sessionRef.current;
    const stream = microphoneStreamRef.current;
    if (!offlineAudio.enabled || !session || !stream || !listeningRef.current) return false;
    session.offlineAudio = offlineAudio;
    if (offlineRecorderRef.current) return true;
    if (typeof MediaRecorder === 'undefined') {
      session.onError?.('This browser cannot record audio locally. Use the typed answer instead.');
      return false;
    }
    offlineRecorderRef.current = createOfflineAudioRecorder({
      stream,
      onLimitReached: reason => session.onError?.(
        reason === 'duration'
          ? 'The five-minute recording limit was reached. Stop the mic to save it, then type an answer if needed.'
          : 'The 25 MB recording limit was reached. Stop the mic to save it, then type an answer if needed.',
      ),
    });
    try {
      return await offlineRecorderRef.current.startRecording();
    } catch (error) {
      offlineRecorderRef.current = null;
      session.onError?.(error instanceof Error ? error.message : 'Local audio recording could not start. Use the typed answer instead.');
      return false;
    }
  }, []);

  return {
    ...transcriptState,
    isListening,
    isFinalizing,
    isRecognitionReady,
    isSupported,
    hasUnfinalizedTranscript,
    startListening,
    stopListening,
    cancelListening,
    resetTranscript,
    enableOfflineRecording,
  };
}
