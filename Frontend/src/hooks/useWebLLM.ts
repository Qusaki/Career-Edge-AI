import { useState, useEffect, useCallback } from 'react';
import type { InitProgressReport, MLCEngine } from '@mlc-ai/web-llm';

// Global cache to survive React StrictMode double-mounting
let globalEnginePromise: Promise<MLCEngine> | null = null;
let globalEngine: MLCEngine | null = null;
let globalModelId: string | null = null;
let globalError: string | null = null;

type WebLLMLoadState = 'loading' | 'ready' | 'error';
export type OfflineAIAvailability = 'cached_ready' | 'not_cached' | 'initializing' | 'failed';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unable to initialize WebLLM.';
};

const cleanModelUrl = (modelUrl: string) => {
  let normalized = modelUrl.endsWith('/') ? modelUrl : `${modelUrl}/`;
  if (!normalized.match(/.+\/resolve\/.+\//)) normalized += 'resolve/main/';
  return new URL(normalized).href;
};

export async function getOfflineAIAvailability(
  modelId: string = "Llama-3.2-1B-Instruct-q4f16_1-MLC",
): Promise<OfflineAIAvailability> {
  if (globalEngine && globalModelId === modelId) return 'cached_ready';
  if (globalEnginePromise && globalModelId === modelId) return 'initializing';
  if (globalError && globalModelId === modelId) return 'failed';
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || typeof caches === 'undefined') {
    return 'not_cached';
  }

  try {
    const webLLM = await import('@mlc-ai/web-llm');
    const modelRecord = webLLM.prebuiltAppConfig.model_list.find(record => record.model_id === modelId);
    if (!modelRecord?.model || !modelRecord.model_lib) return 'not_cached';
    if (!await webLLM.hasModelInCache(modelId, webLLM.prebuiltAppConfig)) return 'not_cached';

    const modelUrl = cleanModelUrl(modelRecord.model);
    const configUrl = new URL('mlc-chat-config.json', modelUrl).href;
    const [configResponse, wasmResponse] = await Promise.all([
      caches.match(configUrl),
      caches.match(modelRecord.model_lib),
    ]);
    if (!configResponse || !wasmResponse) return 'not_cached';

    const config = await configResponse.clone().json() as { tokenizer_files?: unknown };
    const tokenizerFiles = Array.isArray(config.tokenizer_files)
      ? config.tokenizer_files.filter((file): file is string => typeof file === 'string')
      : [];
    const tokenizerFile = tokenizerFiles.includes('tokenizer.json')
      ? 'tokenizer.json'
      : tokenizerFiles.includes('tokenizer.model')
        ? 'tokenizer.model'
        : null;
    if (!tokenizerFile || !await caches.match(new URL(tokenizerFile, modelUrl).href)) {
      return 'not_cached';
    }
    return 'cached_ready';
  } catch (error) {
    console.warn('Unable to verify the cached WebLLM model.', error);
    return 'failed';
  }
}

export async function ensureOfflineAIReady(
  modelId: string = "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  initProgressCallback?: (report: InitProgressReport) => void,
): Promise<MLCEngine> {
  if (globalEngine && globalModelId === modelId) return globalEngine;

  if (globalModelId && globalModelId !== modelId) {
    globalEnginePromise = null;
    globalEngine = null;
    globalError = null;
  }
  globalModelId = modelId;

  if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
    globalError = 'WebGPU is not available in this browser. Please use a Chromium-based browser with hardware acceleration enabled.';
    throw new Error(globalError);
  }

  if (!globalEnginePromise) {
    globalEnginePromise = import('@mlc-ai/web-llm')
      .then(({ CreateMLCEngine }) => CreateMLCEngine(modelId, { initProgressCallback }))
      .then(engine => {
        globalEngine = engine;
        globalError = null;
        return engine;
      })
      .catch(error => {
        globalEnginePromise = null;
        globalEngine = null;
        globalError = getErrorMessage(error);
        throw error;
      });
  }

  return globalEnginePromise;
}

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

  const initializeCached = useCallback(async () => {
    const availability = await getOfflineAIAvailability(modelId);
    if (availability !== 'cached_ready') return null;
    setIsLoading(true);
    setLoadState('loading');
    setError(null);
    setStatus('Loading cached offline interview AI...');
    try {
      const cachedEngine = await ensureOfflineAIReady(modelId, report => {
        setStatus(report.text);
        setProgress(report.progress * 100);
      });
      setEngine(cachedEngine);
      setIsLoading(false);
      setLoadState('ready');
      setStatus('Cached offline interview AI is ready.');
      return cachedEngine;
    } catch (initializationError) {
      const message = getErrorMessage(initializationError);
      globalError = message;
      setEngine(null);
      setError(message);
      setIsLoading(false);
      setLoadState('error');
      setStatus(`Cached offline AI could not initialize: ${message}`);
      return null;
    }
  }, [modelId]);

  const release = useCallback(async () => {
    const engineToRelease = globalEngine;
    globalEnginePromise = null;
    globalEngine = null;
    globalModelId = null;
    globalError = null;
    setEngine(null);
    setIsLoading(false);
    setProgress(0);
    setLoadState('loading');
    setStatus('Interview AI will load when needed.');
    setError(null);
    if (!engineToRelease) return;
    try {
      await engineToRelease.interruptGenerate();
    } catch {
      // No generation may be active.
    }
    await engineToRelease.unload();
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

    const initProgressCallback = (report: InitProgressReport) => {
      if (cancelled) return;
      setStatus(report.text);
      setProgress(report.progress * 100);
    };

    setIsLoading(true);
    setLoadState('loading');
    setError(null);
    ensureOfflineAIReady(modelId, initProgressCallback).then(e => {
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
    initializeCached,
    release,
  };
}
