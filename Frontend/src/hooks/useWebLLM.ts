import { useState, useEffect } from 'react';
import { CreateMLCEngine, MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';

// Global cache to survive React StrictMode double-mounting
let globalEnginePromise: Promise<MLCEngine> | null = null;
let globalEngine: MLCEngine | null = null;

export function useWebLLM(modelId: string = "Llama-3-8B-Instruct-q4f16_1-MLC") {
  const [engine, setEngine] = useState<MLCEngine | null>(globalEngine);
  const [isLoading, setIsLoading] = useState(!globalEngine);
  const [progress, setProgress] = useState(globalEngine ? 100 : 0);
  const [status, setStatus] = useState(globalEngine ? "Model loaded and ready!" : "Initializing...");

  useEffect(() => {
    if (globalEngine) {
      setEngine(globalEngine);
      setIsLoading(false);
      return;
    }

    const initProgressCallback = (report: InitProgressReport) => {
      setStatus(report.text);
      setProgress(report.progress * 100);
    };

    if (!globalEnginePromise) {
      globalEnginePromise = CreateMLCEngine(modelId, { initProgressCallback }).then(e => {
        globalEngine = e;
        return e;
      });
    }

    globalEnginePromise.then(e => {
      setEngine(e);
      setStatus("Model loaded and ready!");
      setIsLoading(false);
    }).catch(e => {
      console.error("Failed to initialize WebLLM:", e);
      setStatus("Failed to load model. Your browser may not support WebGPU.");
      setIsLoading(false);
    });

    // We purposely do NOT unload() here because React StrictMode will unmount 
    // immediately in dev mode, destroying the engine and crashing WebGPU!
  }, [modelId]);

  return { engine, isLoading, progress, status };
}
