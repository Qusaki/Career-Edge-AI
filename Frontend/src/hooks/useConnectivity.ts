import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionState = 'online' | 'offline' | 'checking' | 'degraded';

export interface ConnectivitySnapshot {
  networkAvailable: boolean;
  backendReachable: boolean | null;
  effectiveOnline: boolean;
  connectionState: ConnectionState;
  lastCheckedAt: number | null;
}

export const deriveConnectionState = (
  networkAvailable: boolean,
  backendReachable: boolean | null,
): ConnectionState => {
  if (!networkAvailable) return 'offline';
  if (backendReachable === null) return 'checking';
  return backendReachable ? 'online' : 'degraded';
};

// /health only confirms that the API process answered, not database or AI availability.
export const HEALTH_ATTEMPT_TIMEOUTS_MS = [5_000, 20_000, 45_000] as const;
export const HEALTH_RETRY_DELAYS_MS = [1_500, 3_500] as const;
const HEALTH_CHECK_THROTTLE_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const HEALTH_RECOVERY_INTERVAL_MS = 30_000;
const ONLINE_EVENT_DEBOUNCE_MS = 400;

type ReachabilityCheck = {
  signal: AbortSignal;
  probe: (timeoutMs: number, signal: AbortSignal) => Promise<boolean>;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  onFirstFailure?: () => void;
};

export async function confirmBackendReachability({
  signal,
  probe,
  wait,
  onFirstFailure,
}: ReachabilityCheck): Promise<boolean | null> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPT_TIMEOUTS_MS.length; attempt += 1) {
    if (signal.aborted) return null;
    let reachable = false;
    try {
      reachable = await probe(HEALTH_ATTEMPT_TIMEOUTS_MS[attempt], signal);
    } catch {
      // A failed health probe is provisional until the bounded checks finish.
    }
    if (signal.aborted) return null;
    if (reachable) return true;
    if (attempt === 0) onFirstFailure?.();
    if (attempt < HEALTH_RETRY_DELAYS_MS.length) {
      await wait(HEALTH_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  return signal.aborted ? null : false;
}

const waitForRetry = (delayMs: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) {
    resolve();
    return;
  }
  const onAbort = () => {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
    resolve();
  };
  const timeout = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, delayMs);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
});

export function useConnectivity(apiUrl: string) {
  const initialNetworkAvailable = typeof navigator === 'undefined' ? true : navigator.onLine;
  const [networkAvailable, setNetworkAvailable] = useState(initialNetworkAvailable);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(
    initialNetworkAvailable ? null : false,
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const backendReachableRef = useRef<boolean | null>(initialNetworkAvailable ? null : false);
  const lastCheckRef = useRef(0);
  const activeCheckRef = useRef<Promise<boolean> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkBackend = useCallback((force = false): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      abortRef.current?.abort();
      setNetworkAvailable(false);
      backendReachableRef.current = false;
      setBackendReachable(false);
      return Promise.resolve(false);
    }

    if (!force && activeCheckRef.current) return activeCheckRef.current;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < HEALTH_CHECK_THROTTLE_MS) {
      return Promise.resolve(backendReachableRef.current === true);
    }
    if (force) abortRef.current?.abort();
    lastCheckRef.current = now;
    const controller = new AbortController();
    abortRef.current = controller;
    if (backendReachableRef.current === false) {
      backendReachableRef.current = null;
      setBackendReachable(null);
    }
    const healthUrl = new URL('/health', apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString();

    const check = confirmBackendReachability({
      signal: controller.signal,
      probe: async (timeoutMs, signal) => {
        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        const timeout = window.setTimeout(() => attemptController.abort(), timeoutMs);
        try {
          const response = await fetch(healthUrl, {
            method: 'GET',
            cache: 'no-store',
            signal: attemptController.signal,
          });
          return !attemptController.signal.aborted && response.ok;
        } catch {
          return false;
        } finally {
          window.clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
        }
      },
      wait: waitForRetry,
      onFirstFailure: () => {
        if (abortRef.current !== controller || !navigator.onLine) return;
        backendReachableRef.current = null;
        setBackendReachable(null);
      },
    })
      .then(reachable => {
        if (abortRef.current === controller && reachable !== null) {
          const browserOnline = navigator.onLine;
          setNetworkAvailable(browserOnline);
          if (!browserOnline) return false;
          backendReachableRef.current = reachable;
          setBackendReachable(reachable);
          setLastCheckedAt(Date.now());
        }
        return reachable === true;
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        if (activeCheckRef.current === check) activeCheckRef.current = null;
      });

    activeCheckRef.current = check;
    return check;
  }, [apiUrl]);

  useEffect(() => {
    let onlineDebounce: number | null = null;

    const handleOffline = () => {
      if (onlineDebounce) window.clearTimeout(onlineDebounce);
      abortRef.current?.abort();
      setNetworkAvailable(false);
      backendReachableRef.current = false;
      setBackendReachable(false);
    };
    const handleOnline = () => {
      abortRef.current?.abort();
      setNetworkAvailable(true);
      backendReachableRef.current = null;
      setBackendReachable(null);
      if (onlineDebounce) window.clearTimeout(onlineDebounce);
      onlineDebounce = window.setTimeout(() => void checkBackend(true), ONLINE_EVENT_DEBOUNCE_MS);
    };
    const handleFocus = () => {
      if (navigator.onLine) void checkBackend(false);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    if (navigator.onLine) void checkBackend(true);

    const interval = window.setInterval(() => {
      if (
        navigator.onLine
        && (backendReachableRef.current === false || Date.now() - lastCheckRef.current >= HEALTH_CHECK_INTERVAL_MS)
      ) void checkBackend(false);
    }, HEALTH_RECOVERY_INTERVAL_MS);

    return () => {
      if (onlineDebounce) window.clearTimeout(onlineDebounce);
      window.clearInterval(interval);
      abortRef.current?.abort();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkBackend]);

  const connectionState = deriveConnectionState(networkAvailable, backendReachable);
  const effectiveOnline = connectionState === 'online';

  return {
    networkAvailable,
    backendReachable,
    effectiveOnline,
    connectionState,
    lastCheckedAt,
    retryConnection: () => checkBackend(true),
  } satisfies ConnectivitySnapshot & { retryConnection: () => Promise<boolean> };
}
