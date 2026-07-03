import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Headphones, LoaderCircle, RefreshCw } from 'lucide-react';

type Session = {
  id: number;
  start_time: string;
  status: string;
  total_score?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
};

type Exercise = {
  title: string;
  description: string;
  endpoint: string;
  icon: React.ReactNode;
};

const exercises: Exercise[] = [
  {
    title: 'Who Am I?',
    description: 'Practice a clear, complete, and concise personal introduction.',
    endpoint: '/pre-test-intro',
    icon: <BookOpen className="h-6 w-6" />,
  },
  {
    title: 'Active Listening Pairs',
    description: 'Listen carefully, summarize key details, and receive focused feedback.',
    endpoint: '/pre-test-active-listening',
    icon: <Headphones className="h-6 w-6" />,
  },
];

export function PreTestPage({ apiUrl }: { apiUrl: string }) {
  const [sessions, setSessions] = useState<(Session & { exercise: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(exercises.map(async exercise => {
        const response = await fetch(`${apiUrl}${exercise.endpoint}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`Unable to load ${exercise.title} sessions.`);
        const data: Session[] = await response.json();
        return data.map(session => ({ ...session, exercise: exercise.title }));
      }));
      setSessions(results.flat().sort((a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pre-test sessions.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const startExercise = async (exercise: Exercise) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setStarting(exercise.endpoint);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}${exercise.endpoint}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Unable to start ${exercise.title}.`);
      }
      const session: Session = await response.json();
      setNotice(`${exercise.title} session #${session.id} is ready.`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to start ${exercise.title}.`);
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gold-text">Assessment</p>
        <h1 className="text-4xl font-bold tracking-tight text-ink md:text-5xl">Pre-Test</h1>
        <p className="mt-1.5 text-lg font-medium text-muted">
          Establish your baseline before beginning interview practice.
        </p>
      </header>

      {(error || notice) && (
        <div className={`mb-5 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
          {error || notice}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {exercises.map(exercise => (
          <article key={exercise.endpoint} className="flex flex-col justify-between rounded-lg border border-line bg-card p-5">
            <div>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-active text-gold-text">
                {exercise.icon}
              </div>
              <h2 className="text-xl font-bold text-ink">{exercise.title}</h2>
              <p className="mt-2 leading-relaxed text-muted">{exercise.description}</p>
            </div>
            <button
              onClick={() => startExercise(exercise)}
              disabled={starting !== null}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting === exercise.endpoint ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              {starting === exercise.endpoint ? 'Starting…' : 'Start Exercise'}
            </button>
          </article>
        ))}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold italic tracking-tight text-ink">Recent Pre-Tests</h2>
          <button onClick={loadSessions} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold-text hover:text-accent-ink">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-muted"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted">No pre-test sessions yet.</p>
          ) : sessions.slice(0, 8).map(session => (
            <div key={`${session.exercise}-${session.id}`} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="font-semibold text-ink">{session.exercise}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(session.start_time).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-active px-2.5 py-1 text-xs font-bold capitalize text-gold-text">{session.status}</span>
                {session.total_score != null && <p className="mt-1 text-sm font-bold text-ink">{session.total_score} points</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
