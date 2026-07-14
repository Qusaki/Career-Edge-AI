import { useCallback, useEffect, useRef, useState } from 'react';

type TranscriptHandler = (transcript: string) => void;
type ErrorHandler = (message: string) => void;
type RecognitionSession = {
  onTranscript: TranscriptHandler;
  onError?: ErrorHandler;
  finalParts: string[];
  interimTranscript: string;
  delivered: boolean;
  retryCount: number;
  fatalError: boolean;
};

const MAX_RECOGNITION_RETRIES = 2;

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
  const listeningRef = useRef(false);
  const sessionRef = useRef<RecognitionSession | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRecognitionRef = useRef<(() => void) | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const clearRestart = useCallback(() => {
    if (!restartTimeoutRef.current) return;
    clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = null;
  }, []);

  const deliverTranscript = useCallback(() => {
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
    if (transcript) session.onTranscript(transcript);
  }, []);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    clearRestart();

    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      deliverTranscript();
      return;
    }

    try {
      // stop() asks the browser to flush its last result before onend.
      recognition.stop();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      deliverTranscript();
    }
  }, [clearRestart, deliverTranscript]);

  useEffect(() => {
    setIsSupported(!getSpeechSupportMessage());

    return () => {
      listeningRef.current = false;
      clearRestart();
      sessionRef.current = null;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Chrome can throw when recognition already ended.
      }
      recognitionRef.current = null;
    };
  }, [clearRestart]);

  const startListening = useCallback(async (onTranscript: TranscriptHandler, onError?: ErrorHandler) => {
    const supportMessage = getSpeechSupportMessage();
    if (supportMessage) {
      setIsSupported(false);
      onError?.(supportMessage);
      return false;
    }

    // A second click is handled by stopListening through the UI. Do not replace
    // an active session and lose the transcript already collected.
    if (listeningRef.current) return true;

    clearRestart();
    const SpeechRecognition = getSpeechRecognition();
    sessionRef.current = {
      onTranscript,
      onError,
      finalParts: [],
      interimTranscript: '',
      delivered: false,
      retryCount: 0,
      fatalError: false,
    };
    listeningRef.current = true;
    setIsListening(true);

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
        // Chrome may end recognition after silence even in continuous mode.
        // Keep the requested recording session alive until the user stops it.
        if (event?.error === 'no-speech' || event?.error === 'aborted') return;

        if (event?.error === 'network' && session.retryCount < MAX_RECOGNITION_RETRIES) {
          session.retryCount += 1;
          scheduleRestart(800);
          return;
        }

        session.fatalError = true;
        session.delivered = true;
        listeningRef.current = false;
        setIsListening(false);
        session.onError?.(getSpeechErrorMessage(event));
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;

        if (listeningRef.current && !session.fatalError) {
          scheduleRestart(250);
          return;
        }

        setIsListening(false);
        deliverTranscript();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        if (session.retryCount < MAX_RECOGNITION_RETRIES) {
          session.retryCount += 1;
          scheduleRestart(500);
        } else {
          session.fatalError = true;
          listeningRef.current = false;
          setIsListening(false);
          session.onError?.('Unable to start the microphone. Please wait a moment and try again.');
          deliverTranscript();
        }
      }
    };

    startRecognitionRef.current = startRecognition;
    startRecognition();
    return true;
  }, [clearRestart, deliverTranscript]);

  return { isListening, isSupported, startListening, stopListening };
}
