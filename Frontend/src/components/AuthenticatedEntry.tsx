import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { accountStorage } from '../db';
import { getVerifiedAccountForToken, rememberVerifiedAccount } from '../offline/accountBinding';
import { API_URL } from '../config/api';
import { getProgramAccentTheme } from '../config/programTheme';
import { hasCurrentLegalAccess, LEGAL_BUNDLE_VERSION, type LegalConsentState } from '../utils/legalConsent';
import { bindNewSignupToVerifiedUser } from '../utils/onboardingState';
import { Dashboard } from './Dashboard';
import { LegalConsentModal } from './LegalConsentModal';

type AccountResponse = LegalConsentState & {
  email: string;
  firstname: string;
  middlename: string | null;
  lastname: string;
  department: string;
  profile_picture_url: string | null;
};

type EntryState = { kind: 'checking' | 'error' } | { kind: 'required'; user: AccountResponse } | { kind: 'ready'; userId: number };

export function AuthenticatedEntry({ isNewSignupSession, onLogout, updateAvailable, updateRefreshing, updateError, onRefreshUpdate }: {
  isNewSignupSession: boolean;
  onLogout: () => void;
  updateAvailable: boolean;
  updateRefreshing: boolean;
  updateError: string | null;
  onRefreshUpdate: () => Promise<void>;
}) {
  const [state, setState] = useState<EntryState>({ kind: 'checking' });
  const token = localStorage.getItem('token') || '';

  const cacheVerifiedAccess = useCallback(async (user: AccountResponse) => {
    if (!hasCurrentLegalAccess(user)) return;
    await rememberVerifiedAccount(token, user.id);
    await accountStorage.putCachedProfile({
      userId: user.id,
      email: user.email,
      name: [user.firstname, user.middlename, user.lastname].filter(Boolean).join(' '),
      department: user.department,
      profilePicture: user.profile_picture_url || '',
      legalConsentVerifiedBundleVersion: LEGAL_BUNDLE_VERSION,
    });
  }, [token]);

  const inspect = useCallback(async () => {
    if (!token) { onLogout(); return; }
    setState({ kind: 'checking' });
    try {
      const response = await fetch(`${API_URL}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) { onLogout(); return; }
      if (!response.ok) throw new Error('Profile verification is unavailable.');
      const user = await response.json() as AccountResponse;
      if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Profile verification is incomplete.');
      // Preserve signup intent before consent; the guide itself is not mounted yet.
      bindNewSignupToVerifiedUser(user.id, isNewSignupSession);
      if (!hasCurrentLegalAccess(user)) {
        setState({ kind: 'required', user });
        return;
      }
      try { await cacheVerifiedAccess(user); } catch { /* Online server state remains authoritative. */ }
      setState({ kind: 'ready', userId: user.id });
    } catch {
      // Offline access uses only a prior server-verified, token-bound account cache.
      const userId = await getVerifiedAccountForToken(token);
      if (userId !== null) {
        const cached = await accountStorage.getCachedProfile(userId).catch(() => undefined);
        if (cached?.legalConsentVerifiedBundleVersion === LEGAL_BUNDLE_VERSION) {
          setState({ kind: 'ready', userId });
          return;
        }
      }
      setState({ kind: 'error' });
    }
  }, [cacheVerifiedAccess, isNewSignupSession, onLogout, token]);

  useEffect(() => { void inspect(); }, [inspect]);

  const accent = getProgramAccentTheme(state.kind === 'required' ? state.user.department : null);
  const accentStyle = { '--program-accent': accent.primary, '--program-accent-on-dark': accent.onDark } as CSSProperties;
  const themeClass = localStorage.getItem('career-edge-theme') === 'dark' ? 'dashboard-theme-dark' : '';

  if (state.kind === 'ready') return <Dashboard key={state.userId}
    isNewSignupSession={isNewSignupSession}
    onLogout={onLogout}
    updateAvailable={updateAvailable}
    updateRefreshing={updateRefreshing}
    updateError={updateError}
    onRefreshUpdate={onRefreshUpdate}
  />;

  if (state.kind === 'required') return <div style={accentStyle} className={`${themeClass} min-h-dvh bg-page text-ink`}>
    <div className="mx-auto max-w-5xl px-5 pt-8" aria-hidden="true">
      <span className="text-lg font-bold">Career Edge AI</span>
      <p className="mt-12 text-3xl font-bold">Dashboard</p>
    </div>
    <LegalConsentModal key={state.user.id} apiUrl={API_URL} userId={state.user.id} token={token}
      onSignOut={onLogout}
      onAccepted={accepted => {
        const user = { ...state.user, ...accepted };
        void cacheVerifiedAccess(user).catch(() => undefined);
        setState({ kind: 'ready', userId: user.id });
      }} />
  </div>;

  return <div style={accentStyle} className={`${themeClass} flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-5 text-center text-ink`} role="status">
    <p>{state.kind === 'checking' ? 'Checking your account...' : 'Your account consent status could not be verified. Reconnect and try again.'}</p>
    {state.kind === 'error' && <div className="flex gap-3">
      <button type="button" onClick={() => void inspect()} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2">Retry</button>
      <button type="button" onClick={onLogout} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2">Sign Out</button>
    </div>}
  </div>;
}
