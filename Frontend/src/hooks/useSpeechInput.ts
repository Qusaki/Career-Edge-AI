import { useCallback, useEffect, useRef, useState } from 'react';

type TranscriptHandler = (transcript: string) => void;
type ErrorHandler = (message: string) => void;

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
      return 'Speech recognition needs a working internet connection in this browser. Check your connection and try again.';
    case 'no-speech':
      return 'No speech was detected. Try again and speak clearly after pressing the mic.';
    default:
      return 'Speech recognition stopped unexpectedly. Please try the mic again.';
  }
};

export function useSpeechInput() {
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(!getSpeechSupportMessage());

    return () => {
      if (!recognitionRef.current || !listeningRef.current) return;
      try {
        recognitionRef.current.stop();
      } catch {
        // Chrome can throw when recognition already ended.
      }
    };
  }, []);

  const stopListening = useCallback(() => {
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (err: any) {
      const message = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
        ? 'Microphone access was blocked. Allow microphone permission for this site, then try again.'
        : err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError'
          ? 'No microphone was found. Check that your microphone is connected and available.'
          : 'Unable to access the microphone. Check browser permissions and try again.';
      onError?.(message);
      setIsListening(false);
      listeningRef.current = false;
      return false;
    }

    const SpeechRecognition = getSpeechRecognition();
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

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

      if (transcript) onTranscript(transcript);
    };

    recognition.onerror = (event: any) => {
      listeningRef.current = false;
      setIsListening(false);
      onError?.(getSpeechErrorMessage(event));
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setIsListening(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      return true;
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setIsListening(false);
      onError?.('Unable to start the microphone. Please wait a moment and try again.');
      return false;
    }
  }, [stopListening]);

  return { isListening, isSupported, startListening, stopListening };
}
