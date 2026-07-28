import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, LoaderCircle, Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { SoundWaveInterviewer } from './SoundWaveInterviewer';
import { CameraTrackingNotice } from './CameraTrackingNotice';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME } from '../utils/speech';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';

type Session = {
  id: number;
  start_time: string;
  status: string;
  total_score?: number | null;
  score_eye_contact?: number | null;
  eye_contact_samples?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
  question_number?: number;
  answered_questions?: number;
};

type ChatMessage = {
  sender: 'user' | 'ai';
  text: string;
};

type RealtimeConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

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
    score_grammar: baseScore,
    score_courtesy: 4,
    score_conciseness: baseScore,
    feedback_summary: 'Post-test interview completed. Review the transcript for detailed performance notes.',
  };
};

const POST_TEST_FIRST_PROMPT_TIMEOUT_MS = 30000;
const POST_TEST_MAX_RETRIES = 1;
const POST_TEST_RETRY_BACKOFF_MS = 500;

export function PostTestPage({ apiUrl, onSessionModeChange = () => {} }: { apiUrl: string; onSessionModeChange?: (isSessionMode: boolean) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('idle');
  const [latestAiQuestion, setLatestAiQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiMessageOpenRef = useRef(false);
  const aiSpeechBufferRef = useRef('');
  const firstPromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionAttemptRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const { isListening, startListening, stopListening, cancelListening } = useSpeechInput();
  const eyeTracker = useEyeContactTracker(Boolean(activeSession));

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

  const cancelSpeech = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsVoiceSpeaking(false);
  };

  const replayLatestQuestion = () => {
    if (!latestAiQuestion.trim() || isAiResponding || isVoiceSpeaking) return;
    setError(null);
    speakText(latestAiQuestion);
  };

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

  useEffect(() => () => {
    lifecycleGenerationRef.current += 1;
    connectionAttemptRef.current += 1;
    if (firstPromptTimeoutRef.current) clearTimeout(firstPromptTimeoutRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Exercise closed.');
    cancelListening();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [cancelListening]);

  const clearFirstPromptTimeout = () => {
    if (!firstPromptTimeoutRef.current) return;
    clearTimeout(firstPromptTimeoutRef.current);
    firstPromptTimeoutRef.current = null;
  };

  function connectPostTestChat(session: Session, retryCount = 0) {
    const token = localStorage.getItem('token');
    if (!token) {
      setConnectionState('error');
      setError('Your session is no longer authenticated. Please sign in again.');
      return;
    }

    connectionAttemptRef.current += 1;
    const attemptId = connectionAttemptRef.current;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const previousSocket = wsRef.current;
    wsRef.current = null;
    if (previousSocket && previousSocket.readyState < WebSocket.CLOSING) {
      previousSocket.close(1000, 'Replaced by a new connection.');
    }
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    setLatestAiQuestion('');
    setConnectionState('connecting');
    setError(null);
    setNotice(retryCount > 0 ? 'Reconnecting the audio interviewer…' : 'Connecting the audio interviewer…');
    const socket = new WebSocket(getWebSocketUrl(apiUrl, `/post-test-interview/${session.id}/chat`, token));
    wsRef.current = socket;
    const isCurrentAttempt = () => connectionAttemptRef.current === attemptId && wsRef.current === socket;

    socket.onopen = () => {
      if (!isCurrentAttempt()) return;
      setConnectionState('ready');
      setNotice('Post-Test session started. The audio interviewer will begin shortly.');
      setIsAiResponding(true);
      socket.send(JSON.stringify({ text: '/start_interview' }));
      clearFirstPromptTimeout();
      firstPromptTimeoutRef.current = setTimeout(() => {
        if (!isCurrentAttempt()) return;
        aiMessageOpenRef.current = false;
        aiSpeechBufferRef.current = '';
        setIsAiResponding(false);
        setConnectionState('error');
        setError('The Post-Test audio prompt did not start. Please restart the backend service and try again.');
        connectionAttemptRef.current += 1;
        wsRef.current = null;
        if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      }, POST_TEST_FIRST_PROMPT_TIMEOUT_MS);
    };

    socket.onmessage = event => {
      if (!isCurrentAttempt()) return;
      const data = JSON.parse(event.data);
      if (data.type === 'turn_complete') {
        clearFirstPromptTimeout();
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        if (aiSpeechBufferRef.current.trim()) {
          const completedQuestion = aiSpeechBufferRef.current.trim();
          setLatestAiQuestion(completedQuestion);
          speakText(completedQuestion);
        }
        aiSpeechBufferRef.current = '';
        return;
      }

      if (data.type === 'error') {
        clearFirstPromptTimeout();
        setConnectionState('error');
        setError(data.message || 'The audio interviewer could not respond. Check that the backend service is running.');
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        aiSpeechBufferRef.current = '';
        return;
      }

      if (data.text) {
        clearFirstPromptTimeout();
        setIsAiResponding(true);
        aiSpeechBufferRef.current += data.text;
        setMessages(prev => {
          if (aiMessageOpenRef.current && prev[prev.length - 1]?.sender === 'ai') {
            return prev.map((message, index) =>
              index === prev.length - 1 ? { ...message, text: message.text + data.text } : message
            );
          }
          if (prev[prev.length - 1]?.sender === 'ai' && prev[prev.length - 1]?.text === data.text) {
            return prev;
          }
          aiMessageOpenRef.current = true;
          return [...prev, { sender: 'ai', text: data.text }];
        });
      }
    };

    socket.onerror = () => {
      // The close event owns retry/error handling and includes the close reason.
    };

    socket.onclose = event => {
      if (!isCurrentAttempt()) return;
      wsRef.current = null;
      clearFirstPromptTimeout();
      aiMessageOpenRef.current = false;
      setIsAiResponding(false);
      aiSpeechBufferRef.current = '';
      if (event.code === 1000) {
        setConnectionState('idle');
        return;
      }

      if (retryCount < POST_TEST_MAX_RETRIES) {
        setConnectionState('connecting');
        setNotice('Reconnecting the audio interviewer…');
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (connectionAttemptRef.current === attemptId) {
            connectPostTestChat(session, retryCount + 1);
          }
        }, POST_TEST_RETRY_BACKOFF_MS);
        return;
      }

      setConnectionState('error');
      setNotice(null);
      setError(event.reason || 'Unable to connect to the audio interviewer.');
    };
  }

  const startPostTest = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const lifecycleGeneration = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = lifecycleGeneration;
    setStarting(true);
    setError(null);
    setNotice(null);
    setMessages([]);
    setLatestAiQuestion('');
    cancelSpeech();
    cancelListening();
    setConnectionState('idle');
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
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;

      const sessionDetailResponse = await fetch(`${apiUrl}/post-test-interview/${session.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sessionDetailResponse.ok) {
        const sessionDetail: { messages?: Array<{ role: string; content: string }> } = await sessionDetailResponse.json();
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
        setMessages((sessionDetail.messages || []).map(message => ({
          sender: message.role === 'ai' ? 'ai' : 'user',
          text: message.content,
        })));
      }
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setActiveSession(session);
      onSessionModeChange(true);
      connectPostTestChat(session);
      await loadSessions();
    } catch (err) {
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setError(err instanceof Error ? err.message : 'Unable to start the post-test interview.');
    } finally {
      if (lifecycleGenerationRef.current === lifecycleGeneration) setStarting(false);
    }
  };

  const quitPostTest = () => {
    lifecycleGenerationRef.current += 1;
    cancelSpeech();
    cancelListening();
    connectionAttemptRef.current += 1;
    clearFirstPromptTimeout();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    wsRef.current?.close(1000, 'Exercise closed.');
    wsRef.current = null;
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    setActiveSession(null);
    setMessages([]);
    setReply('');
    setIsAiResponding(false);
    setIsVoiceSpeaking(false);
    setConnectionState('idle');
    setLatestAiQuestion('');
    setNotice('Post-test exited. Complete the interview later to finish it properly.');
    onSessionModeChange(false);
    void loadSessions();
  };

  const sendReply = (spokenText = reply) => {
    const text = spokenText.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isAiResponding || isVoiceSpeaking) return;
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    setMessages(prev => [...prev, { sender: 'user', text }]);
    wsRef.current.send(JSON.stringify({ text }));
    setReply('');
  };

  const recordAndSendReply = () => {
    setError(null);
    startListening(transcript => sendReply(transcript), setError);
  };

  const completePostTest = async () => {
    const token = localStorage.getItem('token');
    if (!token || !activeSession) return;
    const lifecycleGeneration = lifecycleGenerationRef.current;
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
          evaluation: {
            ...getBasicPostTestEvaluation(messages),
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || 'Unable to complete the post-test interview.');
      }
      cancelListening();
      connectionAttemptRef.current += 1;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
      wsRef.current?.close(1000, 'Exercise completed.');
      wsRef.current = null;
      setConnectionState('idle');
      cancelSpeech();
      const completedSession: Session = await response.json();
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setActiveSession(null);
      setMessages([]);
      setLatestAiQuestion('');
      setNotice(`Post-Test session ${completedSession.id} completed.`);
      onSessionModeChange(false);
      await loadSessions();
    } catch (err) {
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setError(err instanceof Error ? err.message : 'Unable to complete the post-test interview.');
    } finally {
      if (lifecycleGenerationRef.current === lifecycleGeneration) setCompleting(false);
    }
  };

  const visibleUserMessages = messages.filter(message => message.sender === 'user');
  const askedQuestionCount = messages.filter(message =>
    message.sender === 'ai' && !message.text.startsWith('You have completed all five Post-Test questions.')
  ).length;
  const currentQuestionNumber = Math.min(Math.max(askedQuestionCount, 1), 5);

  if (activeSession) {
    return (
      <div className="min-h-screen w-full bg-page p-4 text-ink sm:p-8">
        <CameraTrackingNotice {...eyeTracker} />
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col">
          <div className="mb-5 flex items-center justify-between gap-3">
            <button
              onClick={quitPostTest}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-active hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              Quit
            </button>
            <button
              onClick={completePostTest}
              disabled={completing || !messages.some(message => message.sender === 'user')}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Interview'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4">
              <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Post-Test Session</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-ink">Post-Test Interview</h1>
                <span className="program-accent-surface rounded-full px-3 py-1 text-sm font-bold">
                  Question {currentQuestionNumber} of 5
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">Answer the audio interviewer one question at a time.</p>
            </div>

            {(error || notice) && (
              <div className={`mb-4 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
                <span>{error || notice}</span>
                {error && connectionState === 'error' && (
                  <button
                    onClick={() => void startPostTest()}
                    disabled={starting}
                    className="shrink-0 rounded-md border border-current px-3 py-1.5 font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            <SoundWaveInterviewer
              active={isVoiceSpeaking || isAiResponding}
              label={
                connectionState === 'connecting'
                  ? 'Connecting audio interviewer...'
                  : connectionState === 'error'
                    ? 'Audio interviewer unavailable'
                    : isVoiceSpeaking
                      ? `Speaking Question ${currentQuestionNumber}...`
                      : isAiResponding
                        ? `Preparing Question ${currentQuestionNumber}...`
                        : connectionState === 'ready'
                          ? `Question ${currentQuestionNumber} ready`
                          : 'Preparing exercise...'
              }
            />

            <div className="mt-4 flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-line bg-background p-6 text-center">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-muted">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> Preparing audio question...
                </div>
              ) : (
                <>
                  <Volume2 className={`mb-4 h-10 w-10 ${isVoiceSpeaking ? 'text-program-accent' : 'text-muted'}`} />
                  <p className="max-w-lg text-sm leading-relaxed text-muted">
                    {isVoiceSpeaking
                      ? 'Listen carefully to the interviewer, then answer after the audio finishes.'
                      : isAiResponding
                        ? 'The interviewer is preparing the next question.'
                        : 'The question is audio-only. Replay it if you need to listen again.'}
                  </p>
                  <button
                    onClick={replayLatestQuestion}
                    disabled={!latestAiQuestion || isAiResponding || isVoiceSpeaking}
                    className="mt-5 flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-active disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Volume2 className="h-4 w-4" /> Replay Question
                  </button>
                  {visibleUserMessages.length > 0 && (
                    <div className="mt-6 w-full max-w-2xl space-y-3 border-t border-line pt-5 text-left">
                      {visibleUserMessages.map((message, index) => (
                        <div key={index} className="program-accent-fill ml-auto max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed">
                          <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">You</p>
                          {message.text}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 flex justify-center">
              <button
                onClick={isListening ? stopListening : recordAndSendReply}
                disabled={connectionState !== 'ready' || isAiResponding || isVoiceSpeaking}
                className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
              >
                {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {isListening ? 'Stop Recording' : 'Speak Answer'}
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Assessment</p>
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
              <h2 className="text-xl font-bold text-ink">Post-Test Interview</h2>
              <p className="mt-1 text-sm text-muted">Question {currentQuestionNumber} of 5</p>
            </div>
            <button
              onClick={completePostTest}
              disabled={completing || !messages.some(message => message.sender === 'user')}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Interview'}
            </button>
          </div>

          <div className="flex h-96 items-center justify-center rounded-lg border border-line bg-background p-4 text-center text-muted">
            Listen to the audio question, then speak your answer.
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={isListening ? stopListening : recordAndSendReply}
              disabled={isAiResponding}
              className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
            >
              {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {isListening ? 'Stop Recording' : 'Speak Answer'}
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-line bg-card p-5">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="flex items-start gap-4">
              <div className="program-accent-surface flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
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
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
          <button onClick={loadSessions} className="program-accent-link flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
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
                <p className="font-semibold text-ink">
                  Post-Test — Question {session.question_number || 1} of 5
                </p>
                <p className="mt-0.5 text-xs text-muted">{new Date(session.start_time).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="program-accent-surface rounded-full px-2.5 py-1 text-xs font-bold capitalize">{session.status}</span>
                {session.total_score != null && (
                  <p className="mt-1 text-sm font-bold text-ink">
                    {session.eye_contact_samples
                      ? session.total_score
                      : Math.max(0, session.total_score - (session.score_eye_contact || 0))}/25
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
