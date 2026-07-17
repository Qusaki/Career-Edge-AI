import { useState, useEffect, useCallback } from 'react';
import { CreateMLCEngine, MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';

// Global cache to survive React StrictMode double-mounting
let globalEnginePromise: Promise<MLCEngine> | null = null;
let globalEngine: MLCEngine | null = null;
let globalModelId: string | null = null;
let globalError: string | null = null;

type WebLLMLoadState = 'loading' | 'ready' | 'error';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unable to initialize WebLLM.';
};

export function useWebLLM(modelId: string = "Llama-3.2-1B-Instruct-q4f16_1-MLC", enabled = true) {
  const [engine, setEngine] = useState<MLCEngine | null>(globalEngine);
  const [isLoading, setIsLoading] = useState(enabled && !globalEngine);
  const [progress, setProgress] = useState(globalEngine ? 100 : 0);
  const [status, setStatus] = useState(globalEngine ? "Model loaded and ready!" : "Initializing...");
  const [error, setError] = useState<string | null>(globalError);
  const [loadState, setLoadState] = useState<WebLLMLoadState>(globalEngine ? 'ready' : globalError ? 'error' : 'loading');
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => {
    globalEnginePromise = null;
    globalEngine = null;
    globalError = null;
    setEngine(null);
    setError(null);
    setProgress(0);
    setStatus("Retrying WebLLM initialization...");
    setLoadState('loading');
    setIsLoading(true);
    setRetryNonce(nonce => nonce + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setIsLoading(false);
      setLoadState(globalEngine ? 'ready' : 'loading');
      setStatus(globalEngine ? 'Model loaded and ready!' : 'Interview AI will load when needed.');
      return;
    }

    if (globalEngine) {
      setEngine(globalEngine);
      setIsLoading(false);
      setLoadState('ready');
      setError(null);
      return;
    }

    if (globalModelId && globalModelId !== modelId) {
      globalEnginePromise = null;
      globalEngine = null;
      globalError = null;
    }
    globalModelId = modelId;

    const initProgressCallback = (report: InitProgressReport) => {
      if (cancelled) return;
      setStatus(report.text);
      setProgress(report.progress * 100);
    };

    if (!globalEnginePromise) {
      if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
        globalError = 'WebGPU is not available in this browser. Please use a Chromium-based browser with hardware acceleration enabled.';
        setError(globalError);
        setStatus(globalError);
        setIsLoading(false);
        setLoadState('error');
        return;
      }

      setIsLoading(true);
      setLoadState('loading');
      setError(null);
      globalEnginePromise = CreateMLCEngine(modelId, { initProgressCallback }).then(e => {
        globalEngine = e;
        globalError = null;
        return e;
      });
    }

    globalEnginePromise.then(e => {
      if (cancelled) return;
      setEngine(e);
      setStatus("Model loaded and ready!");
      setIsLoading(false);
      setLoadState('ready');
      setError(null);
    }).catch(e => {
      console.error("Failed to initialize WebLLM:", e);
      if (cancelled) return;
      globalEnginePromise = null;
      globalEngine = null;
      globalError = getErrorMessage(e);
      setError(globalError);
      setStatus(`Failed to load WebLLM: ${globalError}`);
      setIsLoading(false);
      setLoadState('error');
    });

    // We purposely do NOT unload() here because React StrictMode will unmount 
    // immediately in dev mode, destroying the engine and crashing WebGPU!
    return () => {
      cancelled = true;
    };
  }, [enabled, modelId, retryNonce]);

  return {
    engine,
    isLoading,
    progress,
    status,
    error,
    loadState,
    isReady: loadState === 'ready' && !!engine,
    hasError: loadState === 'error',
    retry,
  };
}
