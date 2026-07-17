import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Dumbbell, LoaderCircle, Mic, MicOff, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { SoundWaveInterviewer } from './SoundWaveInterviewer';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME } from '../utils/speech';

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
  generatorEndpoint?: string;
  isNegotiation?: boolean;
};

type NegotiationMessage = {
  sender: 'user' | 'bot';
  text: string;
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
    title: 'Synonym Sprint',
    description: 'Quickly give alternatives for a word to widen your vocabulary.',
    drillLevel: 'medium',
    drillType: 'synonym',
    generatorEndpoint: '/drills/generate/synonym',
  },
  {
    title: 'Fake Profile Pitch',
    description: 'Create a short introduction from a generated profile.',
    drillLevel: 'medium',
    drillType: 'fake_profile',
    generatorEndpoint: '/drills/generate/fake-profile',
  },
  {
    title: 'Emoji Story',
    description: 'Turn random emojis into a coherent spoken story.',
    drillLevel: 'medium',
    drillType: 'emoji_story',
    generatorEndpoint: '/drills/generate/emojis',
  },
  {
    title: 'Taboo Explainer',
    description: 'Explain a topic clearly without using the banned words.',
    drillLevel: 'hard',
    drillType: 'taboo',
    generatorEndpoint: '/drills/generate/taboo',
  },
  {
    title: 'Elevator Pitch',
    description: 'Practice a persuasive answer under pressure.',
    drillLevel: 'hard',
    drillType: 'elevator_pitch',
    generatorEndpoint: '/drills/generate/elevator-pitch',
  },
  {
    title: 'Plain-Language Rephrase',
    description: 'Rewrite complex language into something clear and professional.',
    drillLevel: 'hard',
    drillType: 'rephrase',
    generatorEndpoint: '/drills/generate/rephrase',
  },
  {
    title: 'Positive Framing',
    description: 'Turn tense feedback into calm, professional language.',
    drillLevel: 'medium',
    drillType: 'positive_framing',
    generatorEndpoint: '/drills/generate/positive-framing',
  },
  {
    title: 'Salary Negotiation',
    description: 'Practice responding to a strict offer and negotiating professionally.',
    drillLevel: 'hard',
    drillType: 'negotiation',
    isNegotiation: true,
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

export function DrillsPage({ apiUrl, onSessionModeChange = () => {} }: { apiUrl: string; onSessionModeChange?: (isSessionMode: boolean) => void }) {
  const [sessions, setSessions] = useState<DrillSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [completing, setCompleting] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<DrillSession | null>(null);
  const [activePrompt, setActivePrompt] = useState('');
  const [spokenResponse, setSpokenResponse] = useState('');
  const [negotiationMessages, setNegotiationMessages] = useState<NegotiationMessage[]>([]);
  const [negotiationReply, setNegotiationReply] = useState('');
  const [negotiationTurn, setNegotiationTurn] = useState(0);
  const [currentOffer, setCurrentOffer] = useState(35000);
  const [negotiationGameOver, setNegotiationGameOver] = useState(false);
  const [negotiationLoading, setNegotiationLoading] = useState(false);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { isListening, startListening, stopListening } = useSpeechInput();

  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = CLEAR_AI_SPEECH_RATE;
    utterance.pitch = CLEAR_AI_SPEECH_PITCH;
    utterance.volume = CLEAR_AI_SPEECH_VOLUME;
    utterance.onstart = () => setIsVoiceSpeaking(true);
    utterance.onend = () => setIsVoiceSpeaking(false);
    utterance.onerror = () => setIsVoiceSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

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
    setSpokenResponse('');
    setNegotiationMessages([]);
    setNegotiationReply('');
    setNegotiationTurn(0);
    setCurrentOffer(35000);
    setNegotiationGameOver(false);
    try {
      const existingResponse = await fetch(`${apiUrl}/drills/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (existingResponse.ok) {
        const existingSessions: DrillSession[] = await existingResponse.json();
        const existingSession = existingSessions
          .filter(item =>
            item.status === 'active' &&
            item.drill_level === drill.drillLevel &&
            item.drill_type === drill.drillType
          )
          .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())[0];

        if (existingSession) {
          setActiveSession(existingSession);
          setActivePrompt('Continue this unfinished drill, then mark it complete when you are done.');
          setNotice(`${drill.title} session #${existingSession.id} is ready.`);
          onSessionModeChange(true);
          await loadSessions();
          return;
        }
      }

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
        drill.generatorEndpoint ? fetch(`${apiUrl}${drill.generatorEndpoint}`, {
          headers: { Authorization: `Bearer ${token}` },
        }) : Promise.resolve(null),
      ]);

      if (!sessionResponse.ok) {
        const body = await sessionResponse.json().catch(() => null);
        throw new Error(body?.detail || `Unable to start ${drill.title}.`);
      }
      if (promptResponse && !promptResponse.ok) throw new Error(`Unable to generate a prompt for ${drill.title}.`);

      const session: DrillSession = await sessionResponse.json();
      const prompt = promptResponse ? await promptResponse.json() : {
        scenario: 'You are negotiating a starting salary. The employer opens with ₱35,000 and is strict about the budget.',
        instruction: 'Reply professionally. You can accept, negotiate salary, or ask about benefits.',
      };
      const formattedPrompt = formatPrompt(prompt);
      setActiveSession(session);
      setActivePrompt(formattedPrompt);
      if (drill.isNegotiation) {
        const openingOffer = 'We can offer ₱35,000 for this role. Given our budget constraint, that is already a competitive starting offer. What do you think?';
        setNegotiationMessages([
          {
            sender: 'bot',
            text: openingOffer,
          },
        ]);
        speakText(openingOffer);
      } else {
        speakText(formattedPrompt);
      }
      setNotice(`${drill.title} session #${session.id} is ready.`);
      onSessionModeChange(true);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to start ${drill.title}.`);
    } finally {
      setStarting(null);
    }
  };

  const quitDrill = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setActiveSession(null);
    setActivePrompt('');
    setSpokenResponse('');
    setNegotiationMessages([]);
    setNegotiationReply('');
    setNegotiationTurn(0);
    setCurrentOffer(35000);
    setNegotiationGameOver(false);
    setIsVoiceSpeaking(false);
    setNotice('Drill exited. Mark it complete later to finish it properly.');
    onSessionModeChange(false);
  };

  const sendNegotiationReply = async (spokenText = negotiationReply) => {
    const text = spokenText.trim();
    if (!text || negotiationLoading || negotiationGameOver) return;

    setNegotiationLoading(true);
    setError(null);
    setNegotiationReply('');
    setNegotiationMessages(prev => [...prev, { sender: 'user', text }]);

    try {
      const response = await fetch(`${apiUrl}/drills/hard/negotiation/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message: text,
          turn_number: negotiationTurn,
          current_offer: currentOffer,
        }),
      });
      if (!response.ok) throw new Error('Unable to process negotiation turn.');
      const data: {
        response: string;
        agreement_reached: boolean;
        new_offer: number;
        is_game_over: boolean;
      } = await response.json();
      setCurrentOffer(data.new_offer);
      setNegotiationTurn(prev => prev + 1);
      setNegotiationGameOver(data.is_game_over);
      setNegotiationMessages(prev => [...prev, { sender: 'bot', text: data.response }]);
      speakText(data.response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process negotiation turn.');
    } finally {
      setNegotiationLoading(false);
    }
  };

  const recordDrillResponse = () => {
    setError(null);
    startListening(transcript => {
      setSpokenResponse(prev => [prev, transcript].filter(Boolean).join(' ').trim());
    }, setError);
  };

  const recordNegotiationReply = () => {
    setError(null);
    startListening(transcript => sendNegotiationReply(transcript), setError);
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
          evaluation_data: {
            prompt: activePrompt,
            spoken_response: spokenResponse || undefined,
            negotiation_messages: negotiationMessages.length > 0 ? negotiationMessages : undefined,
            current_offer: negotiationMessages.length > 0 ? currentOffer : undefined,
          },
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
      setSpokenResponse('');
      setNegotiationMessages([]);
      setNegotiationReply('');
      setNegotiationTurn(0);
      setCurrentOffer(35000);
      setNegotiationGameOver(false);
      onSessionModeChange(false);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the drill session.');
    } finally {
      setCompleting(null);
    }
  };

  if (activeSession) {
    return (
      <div className="min-h-screen w-full bg-page p-4 text-ink sm:p-8">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col">
          <div className="mb-5 flex items-center justify-between gap-3">
            <button
              onClick={quitDrill}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-active hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              Quit
            </button>
            <button
              onClick={completeDrill}
              disabled={completing !== null || (activeSession.drill_type === 'negotiation' ? !negotiationMessages.some(message => message.sender === 'user') : !spokenResponse.trim())}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing === activeSession.id ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing === activeSession.id ? 'Completing…' : 'Mark Complete'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-active text-gold-text">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gold-text">Drill Session</p>
              <h1 className="text-3xl font-bold tracking-tight text-ink">Current Drill #{activeSession.id}</h1>
              <p className="mt-1 text-sm font-bold uppercase tracking-wider text-gold-text">
                {activeSession.drill_level} · {activeSession.drill_type.replace(/_/g, ' ')}
              </p>
            </div>

            {(error || notice) && (
              <div className={`mb-4 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
                {error || notice}
              </div>
            )}

            <SoundWaveInterviewer
              active={isVoiceSpeaking || negotiationLoading}
              label={isVoiceSpeaking ? 'Speaking...' : negotiationLoading ? 'Preparing reply...' : 'Audio prompt ready'}
            />

            {activeSession.drill_type === 'negotiation' ? (
              <>
                <div className="mb-4 mt-4 rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  <p className="mb-2 font-bold text-gold-text">Scenario</p>
                  <p className="whitespace-pre-wrap">{activePrompt || 'Prompt loaded.'}</p>
                </div>

                <div className="h-[44vh] overflow-y-auto rounded-lg border border-line bg-background p-4">
                  {negotiationMessages.map((message, index) => (
                    <div key={index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'bg-accent text-accent-ink' : 'border border-line bg-card text-ink'}`}>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">{message.sender === 'user' ? 'You' : 'Employer'}</p>
                        {message.text}
                      </div>
                    </div>
                  ))}
                  {negotiationLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <LoaderCircle className="h-4 w-4 animate-spin" /> Employer is responding…
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordNegotiationReply}
                    disabled={negotiationLoading || negotiationGameOver}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-accent text-accent-ink hover:bg-gold-text'}`}
                  >
                    {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : negotiationGameOver ? 'Negotiation Ended' : 'Speak Reply'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <pre className="whitespace-pre-wrap rounded-lg border border-line bg-background p-4 font-sans text-base leading-relaxed text-ink">
                  {activePrompt || 'Prompt loaded.'}
                </pre>
                <div className="mt-4 min-h-[28vh] rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  <p className="mb-2 font-bold text-gold-text">Your spoken response</p>
                  {spokenResponse || <span className="text-muted">Press the mic and answer the drill out loud.</span>}
                </div>
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordDrillResponse}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-accent text-accent-ink hover:bg-gold-text'}`}
                  >
                    {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : 'Speak Answer'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

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
                {session.score != null && <p className="mt-1 text-sm font-bold text-ink">{Math.round(session.score)}%</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
