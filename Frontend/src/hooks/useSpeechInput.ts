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
}
type RecognitionSession = {
  onTranscript: TranscriptHandler;
  onError?: ErrorHandler;
  finalParts: string[];
  interimTranscript: string;
  delivered: boolean;
  retryCount: number;
  fatalError: boolean;
  offlineAudio?: OfflineSpeechAudioOptions;
};

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

const getSpeechSupportMessage = () => {
  if (typeof window === 'undefined') {
    return 'Speech recognition is only available in the browser.';
  }

  if (!window.isSecureContext) {
    return 'Microphone access requires HTTPS or localhost. Open this app with https:// or http://localhost, then try again.';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot access the microphone from this page. Use Chrome or Edge on HTTPS or localhost.';
  }

  if (!getSpeechRecognition()) {
    return 'Speech recognition is not supported in this browser. Please use Chrome or Edge.';
  }

  return null;
};

const getSpeechErrorMessage = (event: any) => {
  switch (event?.error) {
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
  const recognitionRef = useRef<any>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const offlineRecorderRef = useRef<OfflineAudioRecorderController | null>(null);
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  const sessionRef = useRef<RecognitionSession | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRecognitionRef = useRef<(() => void) | null>(null);
  const requestGenerationRef = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const clearRestart = useCallback(() => {
    if (!restartTimeoutRef.current) return;
    clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = null;
  }, []);

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
  }, []);

  const deliverTranscript = useCallback(async () => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    const session = sessionRef.current;
    if (!session) return;
    if (session.delivered) {
      sessionRef.current = null;
      return;
    }

    session.delivered = true;
    const transcript = [...session.finalParts, session.interimTranscript]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    sessionRef.current = null;
    if (session.offlineAudio) {
      const capture = await offlineRecorderRef.current?.stopRecording() ?? null;
      if (capture) {
        const persisted = await session.offlineAudio.persistAudio({
          activityType: session.offlineAudio.activityType,
          turnId: session.offlineAudio.turnId,
          answerIndex: session.offlineAudio.answerIndex,
          capture,
          transcriptText: transcript || undefined,
        });
        if (!persisted) {
          session.onError?.('The recording could not be saved locally. Your answer was not advanced; retry or use the typed answer.');
          releaseMicrophone();
          return;
        }
      }
    }
    offlineRecorderRef.current?.releaseRecorder();
    offlineRecorderRef.current = null;
    releaseMicrophone();
    if (transcript) session.onTranscript(transcript);
    else if (session.offlineAudio) session.onError?.('Your audio was saved locally, but no transcript was produced. Type your answer to continue.');
  }, [releaseMicrophone]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    clearRestart();

    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      void deliverTranscript();
      return;
    }

    try {
      // stop() asks the browser to flush its last result before onend.
      recognition.stop();
      stopTimeoutRef.current = setTimeout(() => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setIsListening(false);
        void deliverTranscript();
      }, 1500);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      void deliverTranscript();
    }
  }, [clearRestart, deliverTranscript]);

  const cancelListening = useCallback(() => {
    requestGenerationRef.current += 1;
    listeningRef.current = false;
    startingRef.current = false;
    clearRestart();
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    sessionRef.current = null;
    offlineRecorderRef.current?.cancelRecording();
    offlineRecorderRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.abort();
    } catch {
      // Chrome can throw when recognition already ended.
    }
    releaseMicrophone();
    setIsListening(false);
  }, [clearRestart, releaseMicrophone]);

  useEffect(() => {
    setIsSupported(!getSpeechSupportMessage());

    const resumeAfterVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        listeningRef.current &&
        !recognitionRef.current &&
        !restartTimeoutRef.current
      ) {
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
      sessionRef.current = null;
      offlineRecorderRef.current?.cancelRecording();
      offlineRecorderRef.current = null;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Chrome can throw when recognition already ended.
      }
      recognitionRef.current = null;
      releaseMicrophone();
    };
  }, [clearRestart, releaseMicrophone]);

  const startListening = useCallback(async (
    onTranscript: TranscriptHandler,
    onError?: ErrorHandler,
    offlineAudio?: OfflineSpeechAudioOptions,
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

    // A second click is handled by stopListening through the UI. Do not replace
    // an active session and lose the transcript already collected.
    if (listeningRef.current || startingRef.current) return true;

    clearRestart();
    const SpeechRecognition = getSpeechRecognition();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    startingRef.current = true;
    let microphoneStream: MediaStream;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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
    microphoneStreamRef.current = microphoneStream;
    startingRef.current = false;

    sessionRef.current = {
      onTranscript,
      onError,
      finalParts: [],
      interimTranscript: '',
      delivered: false,
      retryCount: 0,
      fatalError: false,
      offlineAudio: offlineAudio?.enabled ? offlineAudio : undefined,
    };
    listeningRef.current = true;
    setIsListening(true);

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
      if (!listeningRef.current || !session || session.fatalError) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (listeningRef.current) setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        session.retryCount = 0;
        let currentInterim = '';
        for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
          const text = (event.results[index][0]?.transcript || '').trim();
          if (!text) continue;
          if (event.results[index].isFinal) session.finalParts.push(text);
          else currentInterim = [currentInterim, text].filter(Boolean).join(' ');
        }
        session.interimTranscript = currentInterim;
      };

      recognition.onerror = (event: any) => {
        // Mobile and desktop browsers may stop their speech service after silence,
        // a temporary network interruption, or an internal recognition timeout.
        // These conditions must not turn off a user-controlled recording session.
        if (event?.error === 'no-speech' || event?.error === 'aborted' || event?.error === 'network') {
          if (recognitionRef.current === recognition) recognitionRef.current = null;
          session.retryCount += 1;
          try {
            recognition.abort();
          } catch {
            // The browser may already have ended this recognizer.
          }
          const delay = event?.error === 'network'
            ? Math.min(4000, 500 * (2 ** Math.min(session.retryCount, 3)))
            : 250;
          scheduleRestart(delay);
          return;
        }

        session.fatalError = true;
        session.onError?.(getSpeechErrorMessage(event));
        if (!session.offlineAudio) {
          session.delivered = true;
          listeningRef.current = false;
          setIsListening(false);
          releaseMicrophone();
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;

        if (listeningRef.current && !session.fatalError) {
          scheduleRestart(250);
          return;
        }

        if (session.offlineAudio && session.fatalError && listeningRef.current) return;
        setIsListening(false);
        void deliverTranscript();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        // A recognizer can remain temporarily busy after onend, especially on
        // mobile browsers. Keep retrying until the user explicitly presses Stop.
        session.retryCount += 1;
        scheduleRestart(Math.min(2000, 300 * session.retryCount));
      }
    };

    startRecognitionRef.current = startRecognition;
    if (SpeechRecognition) startRecognition();
    else onError?.('Speech recognition is unavailable offline. Audio will still be saved; type your answer to continue.');
    return true;
  }, [clearRestart, deliverTranscript, releaseMicrophone]);

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

  return { isListening, isSupported, startListening, stopListening, cancelListening, enableOfflineRecording };
}
