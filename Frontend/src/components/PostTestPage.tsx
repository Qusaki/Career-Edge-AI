import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ClipboardCheck, LoaderCircle, RefreshCw } from 'lucide-react';

type Session = {
  id: number;
  start_time: string;
  status: string;
  total_score?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
};

export function PostTestPage({ apiUrl }: { apiUrl: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/post-test-interview/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Unable to load post-test sessions.');
      setSessions(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load post-test sessions.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const startPostTest = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/post-test-interview/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || 'Unable to start the post-test interview.');
      }
      const session: Session = await response.json();
      setNotice(`Post-test interview #${session.id} is ready.`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start the post-test interview.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gold-text">Assessment</p>
        <h1 className="text-4xl font-bold tracking-tight text-ink md:text-5xl">Post-Test</h1>
        <p className="mt-1.5 text-lg font-medium text-muted">
          Measure your progress with a final department-specific interview.
        </p>
      </header>

      {(error || notice) && (
        <div className={`mb-5 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
          {error || notice}
        </div>
      )}

      <section className="rounded-lg border border-line bg-card p-5">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-active text-gold-text">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-ink">Final Interview Assessment</h2>
              <p className="mt-1 max-w-2xl leading-relaxed text-muted">
                Complete five focused questions tailored to your department, then review your score and feedback.
              </p>
            </div>
          </div>
          <button
            onClick={startPostTest}
            disabled={starting}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            {starting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            {starting ? 'Starting…' : 'Start Post-Test'}
          </button>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold italic tracking-tight text-ink">Recent Post-Tests</h2>
          <button onClick={loadSessions} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold-text hover:text-accent-ink">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-muted"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted">No post-test sessions yet.</p>
          ) : sessions.slice(0, 8).map(session => (
            <div key={session.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="font-semibold text-ink">Post-Test Interview #{session.id}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(session.start_time).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-active px-2.5 py-1 text-xs font-bold capitalize text-gold-text">{session.status}</span>
                {session.total_score != null && <p className="mt-1 text-sm font-bold text-ink">{session.total_score}/30</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
