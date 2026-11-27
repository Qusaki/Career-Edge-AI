import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { transcribeAnswer } from '../utils/transcribeAnswer';
import type { OfflineAudioCapture } from '../offline/offlineAudioRecorder';

export type Recommendation = {
  scores: Record<string, number>;
  priority_criterion: string | null;
  difficulty: string | null;
  confidence: 'none' | 'limited' | 'supported';
  reason: string;
  maintenance: boolean;
};
type Session = {
  id: number;
  target_criterion: string;
  difficulty: string;
  scenario_category: string | null;
  scenario: string | null;
  prompt: string | null;
  generation_authority: string | null;
  status: string;
  response_text: string | null;
  score_vocabulary: number | null;
  score_clarity: number | null;
  score_grammar: number | null;
  score_conciseness: number | null;
  score_task_completion: number | null;
  score_courtesy: number | null;
  score_total: number | null;
  passed: boolean | null;
  feedback_summary: string | null;
  scoring_authority: string | null;
  started_at: string;
  completed_at: string | null;
};
type HistoryItem = Pick<Session, 'id' | 'target_criterion' | 'difficulty' | 'status' | 'generation_authority' | 'scoring_authority' | 'score_total' | 'passed' | 'feedback_summary' | 'started_at' | 'completed_at'>;
const criteria = ['vocabulary', 'clarity', 'grammar', 'conciseness', 'task_completion', 'courtesy'] as const;
const label = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());

export function AdaptiveRecommendationCard({ recommendation, effectiveOnline, loading, starting, onStart }: {
  recommendation: Recommendation | null;
  effectiveOnline: boolean;
  loading: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  if (!effectiveOnline) return <p className="mt-3 text-sm text-muted">Personalized Practice is available when you're online. You can continue using the regular Drills offline.</p>;
  if (loading) return <p role="status" className="mt-3 text-sm text-muted">Loading your recommendation...</p>;
  if (!recommendation?.priority_criterion) return <p className="mt-3 text-sm text-muted">{recommendation?.reason || 'Complete an assessment to get a personalized recommendation.'}</p>;
  return <div className="mt-3 space-y-2 text-sm">
    <p>{recommendation.maintenance ? 'Maintenance Focus' : 'Focus'}: <strong>{label(recommendation.priority_criterion)}</strong></p>
    <p>Difficulty: <strong>{label(recommendation.difficulty || '')}</strong></p>
    <p className="text-muted">{recommendation.reason}</p>
    <button type="button" onClick={onStart} disabled={starting} className="program-accent-button program-accent-focus-ring min-h-11 rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{starting ? 'Generating practice...' : 'Start Personalized Practice'}</button>
  </div>;
}

export function AdaptivePracticePage({ apiUrl, effectiveOnline, onActiveChange }: {
  apiUrl: string;
  effectiveOnline: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [responseText, setResponseText] = useState('');
  const [pendingAudio, setPendingAudio] = useState<OfflineAudioCapture | null>(null);
  const [working, setWorking] = useState<'loading' | 'starting' | 'submitting' | 'transcribing' | 'abandoning' | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const { isListening, isFinalizing, liveTranscript, startListening, stopListening, cancelListening } = useSpeechInput({ cumulativeResultProtection: true });
  const headers = useCallback(() => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` }), []);
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const result = await fetch(`${apiUrl}/adaptive-practice${path}`, {
      ...init, headers: { ...headers(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!result.ok) {
      const body: unknown = await result.json().catch(() => null);
      const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : null;
      throw new Error(detail || 'Personalized Practice is unavailable. Please try again.');
    }
    return result.json() as Promise<T>;
  }, [apiUrl, headers]);

  const load = useCallback(async (resumeActive = false) => {
    if (!effectiveOnline) { setWorking(null); return; }
    setWorking('loading');
    try {
      const [nextRecommendation, nextHistory] = await Promise.all([
        request<Recommendation>('/recommendation'), request<HistoryItem[]>('/'),
      ]);
      setRecommendation(nextRecommendation);
      setHistory(nextHistory);
      const active = resumeActive ? nextHistory.find(item => item.status === 'in_progress' || item.status === 'generating' || item.status === 'evaluating') : null;
      if (active) {
        const restored = await request<Session>(`/${active.id}`);
        setSession(restored);
        setResponseText(restored.response_text || '');
      }
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Personalized Practice is unavailable.');
    } finally { setWorking(null); }
  }, [effectiveOnline, request]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { onActiveChange(session !== null); }, [onActiveChange, session]);
  useEffect(() => () => cancelListening(), [cancelListening]);
  useEffect(() => {
    if (!session || !['generating', 'evaluating'].includes(session.status) || !effectiveOnline) return;
    const timer = window.setInterval(() => {
      void request<Session>(`/${session.id}`).then(next => {
        setSession(next);
        if (next.status === 'in_progress' || next.status === 'completed') attemptIdRef.current = null;
        if (next.status === 'completed') void load();
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [effectiveOnline, load, request, session]);

  const start = async () => {
    if (!effectiveOnline || !recommendation?.priority_criterion || inFlightRef.current) return;
    inFlightRef.current = true;
    setWorking('starting'); setError(null);
    attemptIdRef.current ||= crypto.randomUUID();
    try {
      const created = await request<Session>('/start', {
        method: 'POST', body: JSON.stringify({ client_attempt_id: attemptIdRef.current }),
      });
      setSession(created); setResponseText(created.response_text || '');
      if (created.status === 'in_progress') attemptIdRef.current = null;
      void load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to start Personalized Practice.');
    } finally { inFlightRef.current = false; setWorking(null); }
  };
  const openHistory = async (id: number) => {
    if (!effectiveOnline || inFlightRef.current) return;
    setError(null);
    try {
      const detail = await request<Session>(`/${id}`);
      setSession(detail); setResponseText(detail.response_text || '');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load this practice.'); }
  };
  const leave = () => { cancelListening(); attemptIdRef.current = null; setSession(null); setResponseText(''); setPendingAudio(null); void load(); };
  const abandon = async () => {
    if (!session || inFlightRef.current) return;
    inFlightRef.current = true; setWorking('abandoning');
    try {
      await request<Session>(`/${session.id}/abandon`, { method: 'POST' });
      leave();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to abandon this practice.'); }
    finally { inFlightRef.current = false; setWorking(null); }
  };
  const capture = () => {
    if (isListening) { stopListening(); return; }
    if (!effectiveOnline || isFinalizing || working) return;
    setError(null);
    void startListening(text => setResponseText(text), message => setError(message), {
      enabled: true,
      transcribeCapture: async (audio) => {
        setPendingAudio(audio);
        try {
          const transcript = await transcribeAnswer(apiUrl, audio);
          setPendingAudio(null);
          return transcript;
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Speech processing failed. Retry your saved recording.');
          return null;
        }
      },
    });
  };
  const retryAudio = async () => {
    if (!pendingAudio || working || !effectiveOnline) return;
    setWorking('transcribing');
    try {
      const transcript = await transcribeAnswer(apiUrl, pendingAudio);
      setResponseText(transcript); setPendingAudio(null); setError(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Speech processing failed.'); }
    finally { setWorking(null); }
  };
  const submit = async () => {
    if (!session || !responseText.trim() || isListening || isFinalizing || inFlightRef.current || !effectiveOnline) return;
    inFlightRef.current = true; setWorking('submitting'); setError(null);
    try {
      const result = await request<{ session: Session; next_recommendation: Recommendation }>(`/${session.id}/complete`, {
        method: 'POST', body: JSON.stringify({ response_text: responseText }),
      });
      setSession(result.session); setRecommendation(result.next_recommendation);
      void load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to evaluate your answer. Reconnect and retry.'); }
    finally { inFlightRef.current = false; setWorking(null); }
  };

  if (session) return <section className="mb-6 rounded-xl border border-line bg-card p-5 text-ink sm:p-7" aria-label="Personalized Practice">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-program-accent text-xs font-bold uppercase tracking-wider">Adaptive Practice</p><h2 className="text-2xl font-bold">Personalized Practice{session.status === 'completed' ? ' Result' : ''}</h2></div>
      <button type="button" onClick={leave} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold">Back to Drills</button>
    </div>
    {!effectiveOnline && <p role="status" className="mb-4 text-sm text-muted">Connection lost. Your server-saved prompt will be available when you reconnect; offline completion is not supported.</p>}
    {error && <p role="alert" className="mb-4 text-sm text-rose-700">{error}</p>}
    <div className="mb-4 flex flex-wrap gap-3 text-sm"><span>Target Skill: <strong>{label(session.target_criterion)}</strong></span><span>Difficulty: <strong>{label(session.difficulty)}</strong></span></div>
    {session.status === 'generating' && <div className="space-y-3"><p role="status">Generating one personalized scenario...</p><button type="button" onClick={() => void abandon()} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2">Abandon Practice</button></div>}
    {session.scenario && <div className="space-y-3 rounded-lg border border-line bg-background p-4"><p><strong>Scenario:</strong> {session.scenario}</p><p><strong>Prompt:</strong> {session.prompt}</p><p className="text-xs text-muted">{session.generation_authority === 'deterministic_fallback' ? 'Deterministic fallback practice prompt' : 'AI-generated practice prompt'}</p></div>}
    {session.status === 'in_progress' && <div className="mt-5 space-y-4">
      <button type="button" onClick={capture} disabled={!effectiveOnline || Boolean(working) || isFinalizing}
        className="program-accent-button program-accent-focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
        {isListening ? <Mic aria-hidden="true" className="h-5 w-5" /> : <MicOff aria-hidden="true" className="h-5 w-5" />}{isListening ? 'Stop Answer' : isFinalizing ? 'Finalizing...' : 'Speak Answer'}
      </button>
      {isListening && <div className="rounded-lg border border-line bg-background p-4" role="status"><p className="font-semibold">Listening... You can speak now</p><p className="mt-2">{liveTranscript || 'Your words will appear here.'}</p></div>}
      {pendingAudio && <button type="button" onClick={() => void retryAudio()} disabled={!effectiveOnline || Boolean(working)} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 disabled:opacity-60">Retry Speech Processing</button>}
      <div className="rounded-lg border border-line bg-background p-4"><p className="text-sm font-semibold">Your finalized response</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{responseText || 'Record a response to continue.'}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void submit()} disabled={!effectiveOnline || !responseText.trim() || isListening || isFinalizing || Boolean(working)} className="program-accent-button program-accent-focus-ring min-h-11 rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{working === 'submitting' ? 'Evaluating...' : 'Submit Answer'}</button><button type="button" onClick={() => void abandon()} disabled={Boolean(working)} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-60">Abandon Practice</button></div>
    </div>}
    {session.status === 'evaluating' && <p role="status" className="mt-4">Evaluating your response...</p>}
    {session.status === 'abandoned' && <p className="mt-4 text-sm text-muted">This practice was abandoned. Its original prompt remains in your history.</p>}
    {session.status === 'completed' && <div className="mt-5 space-y-4">
      <p className="text-sm font-semibold">{session.passed ? 'Practice completed' : 'More practice recommended'} · {session.score_total?.toFixed(1)} / 30</p>
      <div className="grid gap-2 sm:grid-cols-2">{criteria.map(key => <div key={key} className="flex justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{label(key)}</span><strong>{session[`score_${key}`]?.toFixed(1) ?? '—'} / 5</strong></div>)}</div>
      <p className="whitespace-pre-wrap break-words text-sm">{session.feedback_summary}</p>
      {session.scoring_authority === 'deterministic_fallback' && <p className="text-sm text-muted">Limited deterministic evaluation: this result does not drive your next personalized focus.</p>}
      <p className="text-sm"><strong>Next Recommended Focus:</strong> {recommendation?.priority_criterion ? `${label(recommendation.priority_criterion)} — ${recommendation.reason}` : 'Complete an assessment for a recommendation.'}</p>
    </div>}
  </section>;

  return <section aria-label="Recommended for You" className="mb-6 rounded-xl border border-line bg-card p-5 text-ink sm:p-6">
    <h2 className="text-xl font-bold">Recommended for You</h2>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <AdaptiveRecommendationCard recommendation={recommendation} effectiveOnline={effectiveOnline} loading={working === 'loading'} starting={working === 'starting'} onStart={() => void start()} />
    <div className="mt-6 border-t border-line pt-4"><h3 className="text-base font-bold">Adaptive Practice History</h3>
      {!effectiveOnline ? <p className="mt-2 text-sm text-muted">Reconnect to view your server-saved practice history.</p> : history.length === 0 ? <p className="mt-2 text-sm text-muted">No Personalized Practice sessions yet.</p> : <ul className="mt-3 space-y-2">{history.map(item => <li key={item.id}><button type="button" onClick={() => void openHistory(item.id)} className="program-accent-focus-ring w-full rounded-lg border border-line p-3 text-left text-sm hover:bg-active"><span className="font-semibold">{label(item.target_criterion)} · {label(item.difficulty)}</span><span className="ml-2 text-muted">{new Date(item.started_at).toLocaleString()} · {label(item.status)}</span><span className="mt-1 block text-xs text-muted">{item.generation_authority === 'deterministic_fallback' ? 'Fallback prompt' : item.generation_authority === 'ai_generated' ? 'AI-generated prompt' : 'Generating'}{item.scoring_authority ? ` · ${item.scoring_authority === 'deterministic_fallback' ? 'Limited deterministic evaluation' : 'AI-assisted evaluation'}` : ''}{item.score_total !== null ? ` · ${item.passed ? 'Practice completed' : 'More practice recommended'} · ${item.score_total.toFixed(1)} / 30` : ''}</span></button></li>)}</ul>}
    </div>
  </section>;
}
