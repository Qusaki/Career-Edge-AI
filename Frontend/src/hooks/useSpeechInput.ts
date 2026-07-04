import { useCallback, useEffect, useRef, useState } from 'react';

type TranscriptHandler = (transcript: string) => void;
type ErrorHandler = (message: string) => void;

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
    case 'no-speech':
      return 'No speech was detected. Try again and speak clearly after pressing the mic.';
    default:
      return 'Speech recognition stopped unexpectedly. Please try the mic again.';
  }
};

export function useSpeechInput() {
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(!getSpeechSupportMessage());

    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (!recognitionRef.current || !listeningRef.current) return;
      try {
        recognitionRef.current.stop();
      } catch {
        // Chrome can throw when recognition already ended.
      }
    };
  }, []);

  const stopListening = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (!recognitionRef.current || !listeningRef.current) {
      setIsListening(false);
      listeningRef.current = false;
      return;
    }

    try {
      recognitionRef.current.stop();
    } catch {
      // The recognizer may already be stopped by the browser.
    }
    setIsListening(false);
    listeningRef.current = false;
  }, []);

  const startListening = useCallback(async (onTranscript: TranscriptHandler, onError?: ErrorHandler) => {
    const supportMessage = getSpeechSupportMessage();
    if (supportMessage) {
      setIsSupported(false);
      onError?.(supportMessage);
      return false;
    }

    stopListening();

    const SpeechRecognition = getSpeechRecognition();
    let retryCount = 0;
    let lastTranscript = '';
    let deliveredTranscript = false;

    const startRecognition = () => {
      retryTimeoutRef.current = null;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        listeningRef.current = true;
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .slice(event.resultIndex ?? 0)
          .map((result: any) => result[0]?.transcript || '')
          .join(' ')
          .trim();

        if (transcript) lastTranscript = transcript;

        const hasFinalResult = Array.from(event.results)
          .slice(event.resultIndex ?? 0)
          .some((result: any) => result.isFinal);

        if (hasFinalResult && lastTranscript) {
          deliveredTranscript = true;
          onTranscript(lastTranscript);
          try {
            recognition.stop();
          } catch {
            // The browser may already be stopping recognition.
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error === 'network' && retryCount < MAX_RECOGNITION_RETRIES) {
          retryCount += 1;
          try {
            recognition.abort();
          } catch {
            // Recognition may already be aborted.
          }
          retryTimeoutRef.current = setTimeout(startRecognition, 800);
          return;
        }

        listeningRef.current = false;
        setIsListening(false);
        onError?.(getSpeechErrorMessage(event));
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (retryTimeoutRef.current) return;

        listeningRef.current = false;
        setIsListening(false);
        if (!deliveredTranscript && lastTranscript) {
          deliveredTranscript = true;
          onTranscript(lastTranscript);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        listeningRef.current = false;
        setIsListening(false);
        onError?.('Unable to start the microphone. Please wait a moment and try again.');
      }
    };

    startRecognition();
    return true;
  }, [stopListening]);

  return { isListening, isSupported, startListening, stopListening };
}
