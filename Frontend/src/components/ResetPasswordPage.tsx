import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, Lock } from 'lucide-react';

import { API_URL } from '../config/api';
import { getNewPasswordError, NEW_PASSWORD_GUIDANCE } from '../utils/passwordPolicy';


const INVALID_LINK_MESSAGE = 'This password reset link is invalid or has expired. Request a new link.';

interface ResetPasswordPageProps {
  token: string | null;
  onSuccess: () => void;
  onBackToSignIn: () => void;
  onRequestNewLink: () => void;
}

export function ResetPasswordPage({ token, onSuccess, onBackToSignIn, onRequestNewLink }: ResetPasswordPageProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !token) return;
    setError(null);
    const policyError = getNewPasswordError(newPassword);
    if (policyError) { setError(policyError); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      if (!response.ok) {
        if (response.status === 400) { setError(INVALID_LINK_MESSAGE); return; }
        if (response.status === 422) {
          const data: { detail?: unknown } = await response.json().catch(() => ({}));
          setError(typeof data.detail === 'string' ? data.detail : 'Please check your new password.');
          return;
        }
        setError("We couldn't reset your password right now. Please try again.");
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      setComplete(true);
      onSuccess();
    } catch {
      setError("We couldn't reset your password right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-theme-dark flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <h1 className="mb-2 text-3xl font-bold">Reset password</h1>
        {complete ? (
          <>
            <p role="status" className="mt-4 text-sm text-slate-300">Your password has been reset successfully.</p>
            <button type="button" onClick={onBackToSignIn} className="mt-6 flex min-h-11 items-center gap-2 text-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
              <ArrowLeft className="h-4 w-4" /> Back to Sign In
            </button>
          </>
        ) : !token ? (
          <>
            <p role="alert" className="mt-4 text-sm text-rose-400">{INVALID_LINK_MESSAGE}</p>
            <button type="button" onClick={onRequestNewLink} className="mt-6 min-h-11 text-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">Request New Link</button>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-slate-400">Choose a new password for your Career Edge AI account.</p>
            {error && <p role="alert" className="mb-4 text-sm text-rose-400">{error}</p>}
            <form onSubmit={submit} className="space-y-5">
              <div>
                <label htmlFor="reset-new-password" className="mb-2 block text-sm font-medium text-slate-300">New Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-500" />
                  <input id="reset-new-password" type={showNewPassword ? 'text' : 'password'} value={newPassword}
                    onChange={event => setNewPassword(event.target.value)} required autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/50 py-2.5 pl-10 pr-12 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
                  <button type="button" aria-label={showNewPassword ? 'Hide new password' : 'Show new password'} aria-pressed={showNewPassword}
                    onClick={() => setShowNewPassword(value => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
                    {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">{NEW_PASSWORD_GUIDANCE}</p>
              </div>
              <div>
                <label htmlFor="reset-confirm-password" className="mb-2 block text-sm font-medium text-slate-300">Confirm New Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-500" />
                  <input id="reset-confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)} required autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/50 py-2.5 pl-10 pr-12 text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
                  <button type="button" aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmPassword}
                    onClick={() => setShowConfirmPassword(value => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-black hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? 'Resetting password...' : 'Reset Password'}
              </button>
            </form>
            {error === INVALID_LINK_MESSAGE && <button type="button" onClick={onRequestNewLink} className="mt-4 min-h-11 text-sm text-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">Request New Link</button>}
            <button type="button" onClick={onBackToSignIn} className="mt-4 flex min-h-11 items-center gap-2 text-sm text-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
              <ArrowLeft className="h-4 w-4" /> Back to Sign In
            </button>
          </>
        )}
      </div>
    </main>
  );
}
