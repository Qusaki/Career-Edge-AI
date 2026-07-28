import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Headphones, LoaderCircle, Mic, MicOff, RefreshCw } from 'lucide-react';
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
};

type ChatMessage = {
  sender: 'user' | 'ai';
  text: string;
};

type Exercise = {
  title: string;
  description: string;
  endpoint: string;
  kind: 'intro' | 'active-listening';
  icon: React.ReactNode;
};

const exercises: Exercise[] = [
  {
    title: 'Who Am I?',
    description: 'Practice a clear, complete, and concise personal introduction.',
    endpoint: '/pre-test-intro',
    kind: 'intro',
    icon: <BookOpen className="h-6 w-6" />,
  },
  {
    title: 'Active Listening Pairs',
    description: 'Listen carefully, summarize key details, and receive focused feedback.',
    endpoint: '/pre-test-active-listening',
    kind: 'active-listening',
    icon: <Headphones className="h-6 w-6" />,
  },
];

const getWebSocketUrl = (apiUrl: string, path: string, token: string) => {
  const url = new URL(path, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
};

const ACTIVE_LISTENING_FIRST_TOKEN_TIMEOUT_MS = 180000;

const getBasicIntroEvaluation = (transcript: string) => {
  const words = transcript.trim().toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const wordCount = words.length;
  const uniqueWordCount = new Set(words).size;
  const score = wordCount >= 60 ? 3 : wordCount >= 30 ? 2 : 1;
  const vocabularyScore = uniqueWordCount >= 45 ? 5
    : uniqueWordCount >= 32 ? 4
      : uniqueWordCount >= 20 ? 3
        : uniqueWordCount >= 10 ? 2
          : 1;
  const grammarScore = wordCount >= 60 ? 5
    : wordCount >= 45 ? 4
      : wordCount >= 30 ? 3
        : wordCount >= 15 ? 2
          : 1;

  return {
    score_clarity: score,
    score_completeness: score,
    score_courtesy: 3,
    score_correctness: score,
    score_conciseness: wordCount <= 140 ? 3 : 2,
    score_vocabulary: vocabularyScore,
    score_grammar: grammarScore,
    feedback_summary: 'Introduction submitted. Review clarity, completeness, courtesy, correctness, conciseness, and delivery.',
  };
};

const getBasicActiveListeningEvaluation = (messages: ChatMessage[]) => {
  const userText = messages.filter(message => message.sender === 'user').map(message => message.text).join(' ');
  const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;
  const score = wordCount >= 80 ? 4 : wordCount >= 40 ? 3 : 2;

  return {
    score_vocabulary: score,
    score_clarity: score,
    score_grammar: score,
    score_courtesy: 4,
    score_conciseness: score,
    feedback_summary: 'Active listening exercise completed. Review the transcript for the AI feedback and summary accuracy.',
  };
};

export function PreTestPage({ apiUrl, onSessionModeChange = () => {} }: { apiUrl: string; onSessionModeChange?: (isSessionMode: boolean) => void }) {
  const [sessions, setSessions] = useState<(Session & { exercise: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [activeExercise, setActiveExercise] = useState<Exercise | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [introTranscript, setIntroTranscript] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiMessageOpenRef = useRef(false);
  const aiSpeechBufferRef = useRef('');
  const activeListeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isListening, startListening, stopListening } = useSpeechInput();
  const eyeTracker = useEyeContactTracker(Boolean(activeExercise && activeSession));

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

  useEffect(() => () => {
    if (activeListeningTimeoutRef.current) clearTimeout(activeListeningTimeoutRef.current);
    wsRef.current?.close();
  }, []);

  const clearActiveListeningTimeout = () => {
    if (!activeListeningTimeoutRef.current) return;
    clearTimeout(activeListeningTimeoutRef.current);
    activeListeningTimeoutRef.current = null;
  };

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

  const connectActiveListeningChat = (session: Session) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    wsRef.current?.close();
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    const socket = new WebSocket(getWebSocketUrl(apiUrl, `/pre-test-active-listening/${session.id}/chat`, token));
    wsRef.current = socket;

    socket.onopen = () => {
      setNotice(`Active Listening session #${session.id} started. Listen to the story, then summarize it.`);
      setIsAiResponding(true);
      socket.send(JSON.stringify({ text: '/start_exercise' }));
      clearActiveListeningTimeout();
      activeListeningTimeoutRef.current = setTimeout(() => {
        aiMessageOpenRef.current = false;
        aiSpeechBufferRef.current = '';
        setIsAiResponding(false);
        setError('The active listening prompt is taking too long to start. Ollama is reachable, but the local model may still be loading or generating slowly. Please try again.');
        if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      }, ACTIVE_LISTENING_FIRST_TOKEN_TIMEOUT_MS);
    };

    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.type === 'turn_complete') {
        clearActiveListeningTimeout();
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        if (aiSpeechBufferRef.current.trim()) speakText(aiSpeechBufferRef.current.trim());
        aiSpeechBufferRef.current = '';
        return;
      }

      if (data.type === 'error') {
        clearActiveListeningTimeout();
        setError(data.message || 'The audio interviewer could not respond. Check that the backend service is running.');
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        aiSpeechBufferRef.current = '';
        return;
      }

      if (data.text) {
        clearActiveListeningTimeout();
        setIsAiResponding(true);
        aiSpeechBufferRef.current += data.text;
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
      clearActiveListeningTimeout();
      setError('The active listening connection failed. Check that the backend and Ollama service are running.');
      setIsAiResponding(false);
      aiSpeechBufferRef.current = '';
    };

    socket.onclose = event => {
      clearActiveListeningTimeout();
      aiMessageOpenRef.current = false;
      setIsAiResponding(false);
      aiSpeechBufferRef.current = '';
      if (event.code !== 1000) {
        setError(event.reason || 'The active listening connection closed unexpectedly.');
      }
    };
  };

  const startExercise = async (exercise: Exercise) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setStarting(exercise.endpoint);
    setError(null);
    setNotice(null);
    setIntroTranscript('');
    setMessages([]);
    setReply('');
    try {
      const existingResponse = await fetch(`${apiUrl}${exercise.endpoint}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let session: Session | null = null;

      if (existingResponse.ok) {
        const existingSessions: Session[] = await existingResponse.json();
        session = existingSessions
          .filter(item => item.status === 'active')
          .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())[0] || null;
      }

      if (!session) {
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
        session = await response.json();
      }
      setActiveExercise(exercise);
      setActiveSession(session);
      onSessionModeChange(true);
      if (exercise.kind === 'active-listening') {
        connectActiveListeningChat(session);
      } else {
        setNotice(`Who Am I? session #${session.id} started. Use the mic to introduce yourself.`);
      }
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to start ${exercise.title}.`);
    } finally {
      setStarting(null);
    }
  };

  const quitSession = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    clearActiveListeningTimeout();
    wsRef.current?.close(1000);
    wsRef.current = null;
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    setActiveExercise(null);
    setActiveSession(null);
    setIntroTranscript('');
    setMessages([]);
    setReply('');
    setIsAiResponding(false);
    setIsVoiceSpeaking(false);
    setNotice('Exercise exited. Complete the exercise later to finish it properly.');
    onSessionModeChange(false);
  };

  const sendReply = (spokenText = reply) => {
    const text = spokenText.trim();
    if (!text || isAiResponding) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    setMessages(prev => [...prev, { sender: 'user', text }]);
    wsRef.current.send(JSON.stringify({ text }));
  };

  const recordIntro = () => {
    setError(null);
    startListening(transcript => {
      setIntroTranscript(prev => [prev, transcript].filter(Boolean).join(' ').trim());
    }, setError);
  };

  const recordAndSendReply = () => {
    setError(null);
    startListening(transcript => sendReply(transcript), setError);
  };

  const completeActiveExercise = async () => {
    const token = localStorage.getItem('token');
    if (!token || !activeSession || !activeExercise) return;
    setCompleting(true);
    setError(null);
    setNotice(null);
    try {
      const isIntro = activeExercise.kind === 'intro';
      const response = await fetch(`${apiUrl}${activeExercise.endpoint}/${activeSession.id}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isIntro ? {
          transcript: introTranscript,
          evaluation: {
            ...getBasicIntroEvaluation(introTranscript),
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        } : {
          conversation: messages,
          evaluation: {
            ...getBasicActiveListeningEvaluation(messages),
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Unable to complete ${activeExercise.title}.`);
      }
      wsRef.current?.close(1000);
      const completedSession: Session = await response.json();
      setActiveExercise(null);
      setActiveSession(null);
      setMessages([]);
      setIntroTranscript('');
      setNotice(`${activeExercise.title} session #${completedSession.id} completed.`);
      onSessionModeChange(false);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to complete ${activeExercise.title}.`);
    } finally {
      setCompleting(false);
    }
  };

  const visibleActiveListeningMessages = messages.filter(message => message.sender === 'user');

  if (activeExercise && activeSession) {
    return (
      <div className="min-h-screen w-full bg-page p-4 text-ink sm:p-8">
        <CameraTrackingNotice {...eyeTracker} />
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col">
          <div className="mb-5 flex items-center justify-between gap-3">
            <button
              onClick={quitSession}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-active hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              Quit
            </button>
            <button
              onClick={completeActiveExercise}
              disabled={completing || (activeExercise.kind === 'intro' ? !introTranscript.trim() : !messages.some(message => message.sender === 'user'))}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Exercise'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4">
              <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Pre-Test Session</p>
              <h1 className="text-3xl font-bold tracking-tight text-ink">{activeExercise.title} #{activeSession.id}</h1>
              <p className="mt-1 text-sm text-muted">
                {activeExercise.kind === 'intro'
                  ? 'Introduce yourself clearly, completely, and concisely.'
                  : 'Listen first, then summarize the story or instructions accurately.'}
              </p>
            </div>

            {(error || notice) && (
              <div className={`mb-4 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
                {error || notice}
              </div>
            )}

            {activeExercise.kind === 'intro' ? (
              <div>
                <div className="rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  <p className="text-program-accent font-bold">Prompt</p>
                  <p className="mt-1">
                    Please introduce yourself. Include your name, course or department, interests, strengths, and why you are preparing for interviews.
                  </p>
                </div>
                <div className="mt-4 min-h-[35vh] rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  {introTranscript || <span className="text-muted">Press the mic and speak your self-introduction.</span>}
                </div>
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordIntro}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                  >
                    {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : 'Speak Answer'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <SoundWaveInterviewer
                  active={isVoiceSpeaking || isAiResponding}
                  label={isVoiceSpeaking ? 'Speaking...' : isAiResponding ? 'Preparing prompt...' : 'Audio interviewer ready'}
                />
                <div className="mt-3 h-36 overflow-y-auto rounded-lg border border-line bg-background p-4 sm:h-40 md:h-44">
                  {visibleActiveListeningMessages.length === 0 && error ? (
                    <div className="flex h-full items-center justify-center text-center text-sm leading-relaxed text-rose-700">
                      {error}
                    </div>
                  ) : visibleActiveListeningMessages.length === 0 ? (
                    <div className="flex h-full items-center justify-center gap-2 text-center text-muted">
                      {messages.length === 0 ? (
                        <>
                          <LoaderCircle className="h-5 w-5 animate-spin" /> Preparing audio prompt...
                        </>
                      ) : (
                        'Listen to the audio prompt, then speak your answer.'
                      )}
                    </div>
                  ) : visibleActiveListeningMessages.map((message, index) => (
                    <div key={index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'program-accent-fill' : 'border border-line bg-card text-ink'}`}>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">You</p>
                        {message.text}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordAndSendReply}
                    disabled={isAiResponding}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
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
        <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Assessment</p>
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

      {activeExercise && activeSession ? (
        <section className="rounded-lg border border-line bg-card p-5">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-bold text-ink">{activeExercise.title} #{activeSession.id}</h2>
              <p className="mt-1 text-sm text-muted">
                {activeExercise.kind === 'intro'
                  ? 'Introduce yourself clearly, completely, and concisely.'
                  : 'Listen first, then summarize the story or instructions accurately.'}
              </p>
            </div>
            <button
              onClick={completeActiveExercise}
              disabled={completing || (activeExercise.kind === 'intro' ? !introTranscript.trim() : !messages.some(message => message.sender === 'user'))}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Exercise'}
            </button>
          </div>

          {activeExercise.kind === 'intro' ? (
            <div>
              <div className="rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                <p className="text-program-accent font-bold">Prompt</p>
                <p className="mt-1">
                  Please introduce yourself. Include your name, course or department, interests, strengths, and why you are preparing for interviews.
                </p>
              </div>
              <div className="mt-4 min-h-48 rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                {introTranscript || <span className="text-muted">Press the mic and speak your self-introduction.</span>}
              </div>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={isListening ? stopListening : recordIntro}
                  className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                >
                  {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  {isListening ? 'Stop Recording' : 'Speak Answer'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="h-48 overflow-y-auto rounded-lg border border-line bg-background p-4 sm:h-56">
                {visibleActiveListeningMessages.length === 0 && error ? (
                  <div className="flex h-full items-center justify-center text-center text-sm leading-relaxed text-rose-700">
                    {error}
                  </div>
                ) : visibleActiveListeningMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center gap-2 text-center text-muted">
                    {messages.length === 0 ? (
                      <>
                        <LoaderCircle className="h-5 w-5 animate-spin" /> Preparing audio prompt...
                      </>
                    ) : (
                      'Listen to the audio prompt, then speak your answer.'
                    )}
                  </div>
                ) : visibleActiveListeningMessages.map((message, index) => (
                  <div key={index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'program-accent-fill' : 'border border-line bg-card text-ink'}`}>
                      <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">You</p>
                      {message.text}
                    </div>
                  </div>
                ))}
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
            </>
          )}
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {exercises.map(exercise => (
            <article key={exercise.endpoint} className="flex flex-col justify-between rounded-lg border border-line bg-card p-5">
              <div>
                <div className="program-accent-surface mb-4 flex h-11 w-11 items-center justify-center rounded-lg">
                  {exercise.icon}
                </div>
                <h2 className="text-xl font-bold text-ink">{exercise.title}</h2>
                <p className="mt-2 leading-relaxed text-muted">{exercise.description}</p>
              </div>
              <button
                onClick={() => startExercise(exercise)}
                disabled={starting !== null}
                className="program-accent-button mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {starting === exercise.endpoint ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                {starting === exercise.endpoint ? 'Starting…' : 'Start Exercise'}
              </button>
            </article>
          ))}
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold italic tracking-tight text-ink">Recent Pre-Tests</h2>
          <button onClick={loadSessions} className="program-accent-link flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
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
                <span className="program-accent-surface rounded-full px-2.5 py-1 text-xs font-bold capitalize">{session.status}</span>
                {session.total_score != null && (
                  <p className="mt-1 text-sm font-bold text-ink">
                    {session.eye_contact_samples
                      ? session.total_score
                      : Math.max(0, session.total_score - (session.score_eye_contact || 0))}/{session.exercise === 'Who Am I?' ? 15 : 25}
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
