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

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_THROTTLE_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const ONLINE_EVENT_DEBOUNCE_MS = 400;

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
      setNetworkAvailable(false);
      backendReachableRef.current = false;
      setBackendReachable(false);
      return Promise.resolve(false);
    }

    const now = Date.now();
    if (!force && now - lastCheckRef.current < HEALTH_CHECK_THROTTLE_MS) {
      return Promise.resolve(backendReachableRef.current === true);
    }
    if (activeCheckRef.current) return activeCheckRef.current;

    lastCheckRef.current = now;
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const healthUrl = new URL('/health', apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString();

    const check = fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(response => response.ok)
      .catch(() => false)
      .then(reachable => {
        if (abortRef.current === controller) {
          setNetworkAvailable(typeof navigator === 'undefined' ? true : navigator.onLine);
          backendReachableRef.current = reachable;
          setBackendReachable(reachable);
          setLastCheckedAt(Date.now());
        }
        return reachable;
      })
      .finally(() => {
        window.clearTimeout(timeout);
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
      if (navigator.onLine) void checkBackend(false);
    }, HEALTH_CHECK_INTERVAL_MS);

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
