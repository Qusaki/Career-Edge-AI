import { useEffect, useRef, useState } from 'react';
import { hasCurrentLegalAccess, LEGAL_BUNDLE_VERSION, type LegalConsentState } from '../utils/legalConsent';
import { PrivacyPolicyView, TermsAgreementView } from './LegalDocuments';

export function LegalConsentModal({ apiUrl, userId, token, onAccepted, onSignOut }: {
  apiUrl: string;
  userId: number;
  token: string;
  onAccepted: (user: LegalConsentState) => void;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<'consent' | 'privacy' | 'terms'>('consent');
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (view !== 'consent') setView('consent');
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) dialog.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
    };
  }, [view]);

  const accept = async () => {
    if (!privacyChecked || !termsChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/users/me/legal-consent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: LEGAL_BUNDLE_VERSION, privacy_acknowledged: true, terms_agreed: true }),
      });
      if (!response.ok) throw new Error('Your acceptance could not be saved. Check your connection and try again.');
      const user = await response.json() as LegalConsentState;
      if (user.id !== userId || !hasCurrentLegalAccess(user)) {
        throw new Error('Your acceptance could not be verified. Please try again.');
      }
      onAccepted(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your acceptance could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-5">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="legal-consent-title"
      tabIndex={-1} className="max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-card p-4 text-ink shadow-2xl outline-none sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="legal-consent-title" className="text-xl font-bold sm:text-2xl">Welcome to Career Edge AI</h1>
        <button type="button" onClick={onSignOut} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-active">Sign Out</button>
      </div>
      {view === 'privacy' ? <PrivacyPolicyView onBack={() => setView('consent')} />
        : view === 'terms' ? <TermsAgreementView onBack={() => setView('consent')} />
          : <div className="space-y-5">
            <p className="text-sm leading-relaxed text-muted">Review the Privacy Policy and Terms and Agreement, then acknowledge and accept both before continuing to Career Edge AI.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setView('privacy')} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-active">View Privacy Policy</button>
              <button type="button" onClick={() => setView('terms')} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-active">View Terms &amp; Agreement</button>
            </div>
            <div className="space-y-3 border-t border-line pt-5">
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={privacyChecked} onChange={event => setPrivacyChecked(event.target.checked)} className="program-accent-focus-ring mt-1 h-4 w-4 shrink-0" />I acknowledge that I have read the Career Edge AI Privacy Policy.</label>
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={termsChecked} onChange={event => setTermsChecked(event.target.checked)} className="program-accent-focus-ring mt-1 h-4 w-4 shrink-0" />I agree to the Career Edge AI Terms and Agreement.</label>
            </div>
            {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
            <button type="button" disabled={!privacyChecked || !termsChecked || submitting} onClick={() => void accept()}
              className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-5 py-2.5 text-sm font-bold hover:bg-active disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Saving acceptance...' : 'I Agree & Continue'}
            </button>
          </div>}
    </div>
  </div>;
}
