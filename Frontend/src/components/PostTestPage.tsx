import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, LoaderCircle, RefreshCw, Send } from 'lucide-react';

type Session = {
  id: number;
  start_time: string;
  status: string;
  total_score?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
};

type ChatMessage = {
  sender: 'user' | 'ai';
  text: string;
};

const getWebSocketUrl = (apiUrl: string, path: string, token: string) => {
  const url = new URL(path, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
};

const getBasicPostTestEvaluation = (messages: ChatMessage[]) => {
  const userTurns = messages.filter(message => message.sender === 'user' && message.text.trim()).length;
  const baseScore = userTurns >= 5 ? 4 : userTurns >= 3 ? 3 : 2;

  return {
    score_vocabulary: baseScore,
    score_clarity: baseScore,
    score_eye_contact: 3,
    score_grammar: baseScore,
    score_courtesy: 4,
    score_conciseness: baseScore,
    feedback_summary: 'Post-test interview completed. Review the transcript for detailed performance notes.',
  };
};

export function PostTestPage({ apiUrl }: { apiUrl: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiMessageOpenRef = useRef(false);

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

  useEffect(() => () => wsRef.current?.close(), []);

  const connectPostTestChat = (session: Session) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    wsRef.current?.close();
    aiMessageOpenRef.current = false;
    const socket = new WebSocket(getWebSocketUrl(apiUrl, `/post-test-interview/${session.id}/chat`, token));
    wsRef.current = socket;

    socket.onopen = () => {
      setNotice(`Post-test interview #${session.id} started. Professor Maxiel will begin shortly.`);
      socket.send(JSON.stringify({ text: 'Hello Professor Maxiel, I am ready to begin the post-test interview.' }));
    };

    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.type === 'turn_complete') {
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        return;
      }

      if (data.text) {
        setIsAiResponding(true);
        setMessages(prev => {
          if (aiMessageOpenRef.current && prev[prev.length - 1]?.sender === 'ai') {
            return prev.map((message, index) =>
              index === prev.length - 1 ? { ...message, text: message.text + data.text } : message
            );
          }
          aiMessageOpenRef.current = true;
          return [...prev, { sender: 'ai', text: data.text }];
        });
      }
    };

    socket.onerror = () => {
      setError('The post-test chat connection failed. Check that the backend and Ollama service are running.');
      setIsAiResponding(false);
    };

    socket.onclose = event => {
      aiMessageOpenRef.current = false;
      setIsAiResponding(false);
      if (event.code !== 1000 && activeSession?.status !== 'completed') {
        setError(event.reason || 'The post-test chat connection closed unexpectedly.');
      }
    };
  };

  const startPostTest = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setStarting(true);
    setError(null);
    setNotice(null);
    setMessages([]);
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
      setActiveSession(session);
      connectPostTestChat(session);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start the post-test interview.');
    } finally {
      setStarting(false);
    }
  };

  const sendReply = () => {
    const text = reply.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isAiResponding) return;
    aiMessageOpenRef.current = false;
    setMessages(prev => [...prev, { sender: 'user', text }]);
    wsRef.current.send(JSON.stringify({ text }));
    setReply('');
  };

  const completePostTest = async () => {
    const token = localStorage.getItem('token');
    if (!token || !activeSession) return;
    setCompleting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/post-test-interview/${activeSession.id}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation: messages,
          evaluation: getBasicPostTestEvaluation(messages),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || 'Unable to complete the post-test interview.');
      }
      wsRef.current?.close(1000);
      const completedSession: Session = await response.json();
      setActiveSession(null);
      setMessages([]);
      setNotice(`Post-test interview #${completedSession.id} completed.`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the post-test interview.');
    } finally {
      setCompleting(false);
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

      {activeSession ? (
        <section className="rounded-lg border border-line bg-card p-5">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-bold text-ink">Post-Test Interview #{activeSession.id}</h2>
              <p className="mt-1 text-sm text-muted">Answer Professor Maxiel one question at a time.</p>
            </div>
            <button
              onClick={completePostTest}
              disabled={completing || messages.length === 0}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Interview'}
            </button>
          </div>

          <div className="h-96 overflow-y-auto rounded-lg border border-line bg-background p-4">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-muted">
                <LoaderCircle className="h-5 w-5 animate-spin" /> Waiting for Professor Maxiel…
              </div>
            ) : messages.map((message, index) => (
              <div key={index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'bg-accent text-accent-ink' : 'border border-line bg-card text-ink'}`}>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">{message.sender === 'user' ? 'You' : 'Professor Maxiel'}</p>
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <textarea
              value={reply}
              onChange={event => setReply(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendReply();
                }
              }}
              disabled={isAiResponding}
              placeholder={isAiResponding ? 'Professor Maxiel is responding…' : 'Type your answer…'}
              className="min-h-12 flex-1 resize-none rounded-lg border border-line bg-background px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
            />
            <button
              onClick={sendReply}
              disabled={!reply.trim() || isAiResponding}
              className="flex items-center justify-center rounded-lg bg-accent px-4 font-semibold text-accent-ink transition-colors hover:bg-gold-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </section>
      ) : (
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
      )}

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
