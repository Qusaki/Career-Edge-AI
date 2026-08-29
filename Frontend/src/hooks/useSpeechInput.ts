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
  cancelled: boolean;
  offlineAudio?: OfflineSpeechAudioOptions;
};

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
};

const getSpeechSupportMessage = () => {
  if (typeof window === 'undefined') return 'Speech recognition is only available in the browser.';
  if (!window.isSecureContext) {
    return 'Microphone access requires HTTPS or localhost. Open this app with https:// or http://localhost, then try again.';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot access the microphone from this page. Use Chrome or Edge on HTTPS or localhost.';
  }
  if (!getSpeechRecognition()) return 'Speech recognition is not supported in this browser. Please use Chrome or Edge.';
  return null;
};

const getSpeechErrorMessage = (event: BrowserSpeechRecognitionErrorEvent) => {
  switch (event.error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow microphone permission for this site, then try again.';
    case 'audio-capture':
      return 'No microphone was found. Check that your microphone is connected and available.';
    case 'network':
      return 'The browser speech service is unavailable right now. Check your internet connection, then try again in Chrome or Edge.';
    default:
      return 'Speech recognition stopped unexpectedly. Please try the mic again.';
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
    } else if (session.offlineAudio) {
      session.onError?.('Your audio was saved locally, but no transcript was produced. Type your answer to continue.');
    } else session.onError?.('No speech was detected. Please try again.');
  }, [releaseMicrophone]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current && !startingRef.current) return;
    listeningRef.current = false;
    startingRef.current = false;
    clearRestart();
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
      }, 1500);
    } catch {
      recognitionRef.current = null;
      void deliverTranscript();
    }
  }, [clearRestart, deliverTranscript]);

  const cancelListening = useCallback(() => {
    requestGenerationRef.current += 1;
    listeningRef.current = false;
    startingRef.current = false;
    clearRestart();
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
  }, [clearRestart, releaseMicrophone]);

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
  }, [clearRestart, releaseMicrophone]);

  const startListening = useCallback(async (
    onTranscript: TranscriptHandler,
    onError?: ErrorHandler,
    offlineAudio?: OfflineSpeechAudioOptions,
    streamHandlers?: SpeechInputStreamHandlers,
  ) => {
    const supportMessage = getSpeechSupportMessage();
    if (supportMessage && !offlineAudio?.enabled) {
      setIsSupported(false);
      onError?.(supportMessage);
      return false;
    }
    if (offlineAudio?.enabled && typeof MediaRecorder === 'undefined') {
      onError?.('This browser cannot record audio locally. Use the typed answer instead.');
      return false;
    }
    if (listeningRef.current || startingRef.current || isFinalizing) return false;

    clearRestart();
    setTranscriptState(EMPTY_TRANSCRIPT_STATE);
    setHasUnfinalizedTranscript(false);
    setIsRecognitionReady(false);
    const SpeechRecognition = getSpeechRecognition();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    startingRef.current = true;
    let microphoneStream: MediaStream;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return false;
      startingRef.current = false;
      onError?.(getMicrophoneErrorMessage(error));
      return false;
    }
    if (requestGenerationRef.current !== requestGeneration) {
      microphoneStream.getTracks().forEach(track => track.stop());
      return false;
    }

    const accumulator = new SpeechTranscriptAccumulator();
    sessionRef.current = {
      onTranscript,
      onError,
      accumulator,
      retryCount: 0,
      fatalError: false,
      cancelled: false,
      offlineAudio: offlineAudio?.enabled ? offlineAudio : undefined,
    };
    microphoneStreamRef.current = microphoneStream;
    streamHandlersRef.current = streamHandlers ?? null;
    startingRef.current = false;
    listeningRef.current = true;
    setIsListening(true);
    streamHandlers?.onStreamReady?.(microphoneStream);

    if (offlineAudio?.enabled) {
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
          listeningRef.current = false;
          setIsListening(false);
          releaseMicrophone();
          onError?.('Local audio recording is unavailable. Use the typed answer instead.');
          return false;
        }
      } catch (error) {
        listeningRef.current = false;
        setIsListening(false);
        offlineRecorderRef.current = null;
        releaseMicrophone();
        onError?.(error instanceof Error ? error.message : 'Local audio recording could not start. Use the typed answer instead.');
        return false;
      }
    }

    const scheduleRestart = (delay: number) => {
      if (!listeningRef.current || restartTimeoutRef.current) return;
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null;
        startRecognitionRef.current?.();
      }, delay);
    };

    const startRecognition = () => {
      const session = sessionRef.current;
      if (!listeningRef.current || !session || session.fatalError || session.cancelled || !SpeechRecognition) return;
      session.accumulator.beginRecognitionAttempt();
      setTranscriptState(session.accumulator.snapshot());
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (recognitionRef.current === recognition && listeningRef.current) setIsRecognitionReady(true);
      };
      recognition.onresult = event => {
        if (session.cancelled) return;
        session.retryCount = 0;
        setTranscriptState(session.accumulator.applyResults(event));
      };
      recognition.onerror = event => {
        setIsRecognitionReady(false);
        if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network') {
          if (recognitionRef.current === recognition) recognitionRef.current = null;
          session.retryCount += 1;
          try { recognition.abort(); } catch { /* The browser may already have ended this recognizer. */ }
          const delay = event.error === 'network'
            ? Math.min(4000, 500 * (2 ** Math.min(session.retryCount, 3)))
            : 250;
          scheduleRestart(delay);
          return;
        }
        session.fatalError = true;
        session.onError?.(getSpeechErrorMessage(event));
        if (!session.offlineAudio) {
          session.cancelled = true;
          sessionRef.current = null;
          listeningRef.current = false;
          setIsListening(false);
          setIsFinalizing(false);
          releaseMicrophone();
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setIsRecognitionReady(false);
        if (session.cancelled) return;
        if (listeningRef.current && !session.fatalError) {
          scheduleRestart(250);
          return;
        }
        if (session.offlineAudio && session.fatalError && listeningRef.current) return;
        void deliverTranscript();
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        session.retryCount += 1;
        scheduleRestart(Math.min(2000, 300 * session.retryCount));
      }
    };

    startRecognitionRef.current = startRecognition;
    if (SpeechRecognition) startRecognition();
    else onError?.('Speech recognition is unavailable offline. Audio will still be saved; type your answer to continue.');
    return true;
  }, [clearRestart, deliverTranscript, isFinalizing, releaseMicrophone]);

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
