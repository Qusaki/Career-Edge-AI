import { useCallback, useEffect, useRef, useState } from 'react';

declare const __CAREER_EDGE_BUILD_ID__: string;

const CURRENT_BUILD_ID = typeof __CAREER_EDGE_BUILD_ID__ === 'string'
  ? __CAREER_EDGE_BUILD_ID__
  : 'development';
const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
const UPDATE_FOCUS_THROTTLE_MS = 60_000;
const VERSION_CHECK_TIMEOUT_MS = 10_000;
const ACTIVATION_WAIT_MS = 30_000;

const waitAtMost = async <T,>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error('The update is still preparing.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

export const isNewDeployment = (currentBuildId: string, candidate: unknown): boolean => {
  if (typeof candidate !== 'object' || candidate === null || !('buildId' in candidate)) return false;
  return typeof candidate.buildId === 'string'
    && candidate.buildId.length > 0
    && candidate.buildId !== currentBuildId;
};

const waitForNewController = (original: ServiceWorker, timeoutMs: number): Promise<void> => (
  new Promise((resolve, reject) => {
    if (navigator.serviceWorker.controller !== original) {
      resolve();
      return;
    }
    const finish = (updated: boolean) => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      if (updated) resolve();
      else reject(new Error('The new version is still preparing.'));
    };
    const onChange = () => {
      if (navigator.serviceWorker.controller !== original) finish(true);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    onChange();
  })
);

export function usePwaUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageControllerRef = useRef<ServiceWorker | null>(null);
  const observedControllerRef = useRef<ServiceWorker | null>(null);
  const checkInFlightRef = useRef<Promise<void> | null>(null);
  const refreshingRef = useRef(false);
  const lastFocusCheckRef = useRef(0);

  const checkForUpdate = useCallback(async (): Promise<void> => {
    if (!import.meta.env.PROD || checkInFlightRef.current) return checkInFlightRef.current ?? undefined;
    const check = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);
      try {
        // This generated file is intentionally excluded from the PWA precache.
        const response = await fetch(`/version.json?check=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok && isNewDeployment(CURRENT_BUILD_ID, await response.json())) {
          setUpdateAvailable(true);
        }
      } catch {
        // A failed background check must not interrupt the current session.
      } finally {
        window.clearTimeout(timeout);
      }
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) void registration.update().catch(() => undefined);
        } catch {
          // The next focus or periodic check can retry safely.
        }
      }
    })();
    checkInFlightRef.current = check;
    try {
      await check;
    } finally {
      if (checkInFlightRef.current === check) checkInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if ('serviceWorker' in navigator) {
      pageControllerRef.current = navigator.serviceWorker.controller;
      observedControllerRef.current = navigator.serviceWorker.controller;
    }
    const onControllerChange = () => {
      const next = navigator.serviceWorker.controller;
      if (!pageControllerRef.current && next) pageControllerRef.current = next;
      if (observedControllerRef.current && next && next !== observedControllerRef.current) {
        setUpdateAvailable(true);
      }
      observedControllerRef.current = next;
    };
    const onFocus = () => {
      onControllerChange();
      if (Date.now() - lastFocusCheckRef.current < UPDATE_FOCUS_THROTTLE_MS) return;
      lastFocusCheckRef.current = Date.now();
      void checkForUpdate();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
    void checkForUpdate();
    return () => {
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [checkForUpdate]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!updateAvailable || refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    setError(null);
    try {
      const original = pageControllerRef.current;
      if (original && 'serviceWorker' in navigator && navigator.serviceWorker.controller === original) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error('The update is not ready.');
        await waitAtMost(registration.update(), ACTIVATION_WAIT_MS);
        await waitForNewController(original, ACTIVATION_WAIT_MS);
      }
      window.location.reload();
    } catch {
      setError('The update is not ready yet. Keep working and try again when connected.');
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [updateAvailable]);

  return { updateAvailable, isRefreshing, error, refresh, checkForUpdate };
}
