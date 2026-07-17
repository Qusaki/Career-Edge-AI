const configuredApiUrl = String(import.meta.env.VITE_API_URL || '').trim();

const resolveConfiguredApiUrl = () => {
  if (!configuredApiUrl) return '';
  try {
    const url = new URL(configuredApiUrl);
    const configuredForThisComputer = ['localhost', '127.0.0.1'].includes(url.hostname);
    const openedFromAnotherComputer = !['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (configuredForThisComputer && openedFromAnotherComputer) {
      url.hostname = window.location.hostname;
      url.protocol = window.location.protocol;
    }
    return url.toString();
  } catch {
    return configuredApiUrl;
  }
};

const fallbackApiUrl = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:8000`
  : window.location.origin;

/**
 * Uses the configured public API in deployments. During local/LAN development,
 * it targets port 8000 on the same host that served the frontend instead of the
 * visitor's own localhost.
 */
export const API_URL = (resolveConfiguredApiUrl() || fallbackApiUrl).replace(/\/$/, '');
