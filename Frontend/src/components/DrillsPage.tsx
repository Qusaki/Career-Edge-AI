import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Dumbbell, LoaderCircle, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';

type DrillSession = {
  id: number;
  drill_level: string;
  drill_type: string;
  start_time: string;
  end_time?: string | null;
  status: string;
  score?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
  evaluation_data?: string | null;
};

type Drill = {
  title: string;
  description: string;
  drillLevel: string;
  drillType: string;
  generatorEndpoint: string;
};

const drills: Drill[] = [
  {
    title: 'Just-a-Minute Speaking',
    description: 'Build fluency by speaking clearly about a surprise topic.',
    drillLevel: 'easy',
    drillType: 'jam',
    generatorEndpoint: '/drills/generate/jam',
  },
  {
    title: 'Fast Word Response',
    description: 'Practice quick, confident answers from a single cue word.',
    drillLevel: 'easy',
    drillType: 'fast_word',
    generatorEndpoint: '/drills/generate/fast-word',
  },
  {
    title: 'Emotion Delivery',
    description: 'Improve tone control by saying a sentence with a target emotion.',
    drillLevel: 'medium',
    drillType: 'emotion',
    generatorEndpoint: '/drills/generate/emotion',
  },
  {
    title: 'Positive Framing',
    description: 'Turn tense feedback into calm, professional language.',
    drillLevel: 'medium',
    drillType: 'positive_framing',
    generatorEndpoint: '/drills/generate/positive-framing',
  },
  {
    title: 'Crisis Response',
    description: 'Handle difficult questions with composure and structure.',
    drillLevel: 'hard',
    drillType: 'crisis',
    generatorEndpoint: '/drills/generate/hard/crisis',
  },
];

const formatPrompt = (prompt: unknown) => {
  if (!prompt || typeof prompt !== 'object') return String(prompt ?? '');
  return Object.entries(prompt as Record<string, unknown>).map(([key, value]) => {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    const formattedValue = Array.isArray(value) ? value.join(', ') : String(value);
    return `${label}: ${formattedValue}`;
  }).join('\n');
};

export function DrillsPage({ apiUrl }: { apiUrl: string }) {
  const [sessions, setSessions] = useState<DrillSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [completing, setCompleting] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<DrillSession | null>(null);
  const [activePrompt, setActivePrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/drills/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Unable to load drill sessions.');
      setSessions(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load drill sessions.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const startDrill = async (drill: Drill) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setStarting(drill.drillType);
    setError(null);
    setNotice(null);
    try {
      const [sessionResponse, promptResponse] = await Promise.all([
        fetch(`${apiUrl}/drills/start`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            drill_level: drill.drillLevel,
            drill_type: drill.drillType,
          }),
        }),
        fetch(`${apiUrl}${drill.generatorEndpoint}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!sessionResponse.ok) {
        const body = await sessionResponse.json().catch(() => null);
        throw new Error(body?.detail || `Unable to start ${drill.title}.`);
      }
      if (!promptResponse.ok) throw new Error(`Unable to generate a prompt for ${drill.title}.`);

      const session: DrillSession = await sessionResponse.json();
      const prompt = await promptResponse.json();
      setActiveSession(session);
      setActivePrompt(formatPrompt(prompt));
      setNotice(`${drill.title} session #${session.id} is ready.`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to start ${drill.title}.`);
    } finally {
      setStarting(null);
    }
  };

  const completeDrill = async () => {
    const token = localStorage.getItem('token');
    if (!token || !activeSession) return;
    setCompleting(activeSession.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/drills/${activeSession.id}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          evaluation_data: activePrompt ? { prompt: activePrompt } : undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || 'Unable to complete the drill session.');
      }
      const completedSession: DrillSession = await response.json();
      setNotice(`Drill session #${completedSession.id} was marked complete.`);
      setActiveSession(null);
      setActivePrompt('');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the drill session.');
    } finally {
      setCompleting(null);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gold-text">Practice</p>
        <h1 className="text-4xl font-bold tracking-tight text-ink md:text-5xl">Drills</h1>
        <p className="mt-1.5 text-lg font-medium text-muted">
          Sharpen quick speaking, framing, and response skills between assessments.
        </p>
      </header>

      {(error || notice) && (
        <div className={`mb-5 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
          {error || notice}
        </div>
      )}

      {activeSession && (
        <section className="mb-6 rounded-lg border border-line bg-card p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-active text-gold-text">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-ink">Current Drill #{activeSession.id}</h2>
              <p className="mt-1 text-sm font-bold uppercase tracking-wider text-gold-text">
                {activeSession.drill_level} · {activeSession.drill_type.replace(/_/g, ' ')}
              </p>
              <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-line bg-background p-4 font-sans text-sm leading-relaxed text-ink">
                {activePrompt || 'Prompt loaded.'}
              </pre>
            </div>
            <button
              onClick={completeDrill}
              disabled={completing !== null}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing === activeSession.id ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing === activeSession.id ? 'Completing…' : 'Mark Complete'}
            </button>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {drills.map(drill => (
          <article key={drill.drillType} className="flex flex-col justify-between rounded-lg border border-line bg-card p-5">
            <div>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-active text-gold-text">
                <Dumbbell className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-ink">{drill.title}</h2>
              <p className="mt-2 leading-relaxed text-muted">{drill.description}</p>
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-gold-text">{drill.drillLevel}</p>
            </div>
            <button
              onClick={() => startDrill(drill)}
              disabled={starting !== null || completing !== null}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting === drill.drillType ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              {starting === drill.drillType ? 'Starting…' : 'Start Drill'}
            </button>
          </article>
        ))}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold italic tracking-tight text-ink">Recent Drills</h2>
          <button onClick={loadSessions} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold-text hover:text-accent-ink">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-muted"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted">No drill sessions yet.</p>
          ) : sessions.slice(0, 8).map(session => (
            <div key={session.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="font-semibold text-ink capitalize">{session.drill_type.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(session.start_time).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-active px-2.5 py-1 text-xs font-bold capitalize text-gold-text">{session.status}</span>
                {session.score != null && <p className="mt-1 text-sm font-bold text-ink">{session.score} points</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
