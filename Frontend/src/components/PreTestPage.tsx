import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Headphones, LoaderCircle, Mic, MicOff, RefreshCw } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { SoundWaveInterviewer } from './SoundWaveInterviewer';
import { CameraTrackingNotice } from './CameraTrackingNotice';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME } from '../utils/speech';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';
import type { OfflineActivityBridgeProps } from '../offline/sessionFoundation';
import { createClientSessionId } from '../offline/sessionFoundation';
import { combineEyeContactSummaries, type EyeContactSummary } from '../offline/eyeContact';
import {
  getOfflineActiveListeningPrompt,
  getActiveListeningPromptForServerSession,
  hasCurrentQuestionPack,
  PRETEST_ACTIVE_LISTENING_VERSION,
  PRETEST_WHO_AM_I_PROMPT,
  PRETEST_WHO_AM_I_VERSION,
} from '../offline/questionPacks';
import { evaluateActiveListening, evaluateWhoAmI } from '../offline/localEvaluation';
import { normalizeApiError } from '../utils/httpError';
import { resolvePreTestSessionExecution } from '../utils/preTestSessionExecution';
import { resolveSessionExecution } from '../utils/sessionExecution';

type Session = {
  id: number | string;
  start_time: string;
  status: string;
  total_score?: number | null;
  score_eye_contact?: number | null;
  eye_contact_samples?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
  transcript?: string | null;
};

export type PreTestChatMessage = {
  id?: number;
  sender: 'user' | 'ai';
  text: string;
};

type ChatMessage = PreTestChatMessage;

export type InitialActiveListeningReplayResolution = {
  completedText: string;
  isHydratedReplay: boolean;
  shouldAppend: boolean;
};

export const getInitialActiveListeningReplay = (
  messages: readonly PreTestChatMessage[],
): PreTestChatMessage | null => {
  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.sender !== 'ai' || !latestMessage.text.trim()) return null;
  return latestMessage;
};

export const resolveInitialActiveListeningReplay = (
  expectedMessage: PreTestChatMessage | null,
  serverMessageId: number | null,
  streamedText: string,
): InitialActiveListeningReplayResolution => {
  const completedText = streamedText.trim();
  const hasComparableIds = expectedMessage?.id !== undefined && serverMessageId !== null;
  const isHydratedReplay = expectedMessage !== null && (
    hasComparableIds
      ? expectedMessage.id === serverMessageId
      : expectedMessage.text.trim() === completedText
  );
  return {
    completedText,
    isHydratedReplay,
    shouldAppend: completedText.length > 0 && !isHydratedReplay,
  };
};

export const getVisibleActiveListeningMessages = (
  messages: readonly PreTestChatMessage[],
): PreTestChatMessage[] => messages.filter((message, index) =>
  message.sender === 'user' || index > 0
);

type Exercise = {
  title: string;
  description: string;
  endpoint: string;
  kind: 'intro' | 'active-listening';
  icon: React.ReactNode;
};

type RealtimeConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

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
const ACTIVE_LISTENING_MAX_RETRIES = 1;
const ACTIVE_LISTENING_RETRY_BACKOFF_MS = 500;
const PRE_TEST_SESSION_RECOVERY_ERROR = 'Unable to verify this Pre-Test session. Please reload the activity and try again.';

type PreTestPageProps = OfflineActivityBridgeProps & {
  apiUrl: string;
  onSessionModeChange?: (isSessionMode: boolean) => void;
};

export function PreTestPage({
  apiUrl,
  onSessionModeChange = () => {},
  effectiveOnline,
  sessionMode,
  resumeSession,
  onActivityStart,
  onActivityCheckpoint,
  onActivityEnd,
  onOfflineAudioCaptured,
}: PreTestPageProps) {
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
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versionMismatch, setVersionMismatch] = useState(false);
  const resumedSessionRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const aiMessageOpenRef = useRef(false);
  const aiSpeechBufferRef = useRef('');
  const initialActiveListeningReplayRef = useRef<PreTestChatMessage | null>(null);
  const answerSubmissionInFlightRef = useRef(false);
  const activeListeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionAttemptRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const offlineEyeContactBaselineRef = useRef<EyeContactSummary | null>(null);
  const activeOfflineClientSessionIdRef = useRef<string | null>(null);
  const introTranscriptRef = useRef('');
  const introPersistenceInFlightRef = useRef(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isPersistingIntro, setIsPersistingIntro] = useState(false);
  const {
    isListening,
    isFinalizing,
    hasUnfinalizedTranscript,
    liveTranscript,
    startListening,
    stopListening,
    cancelListening,
    resetTranscript: resetSpeechTranscript,
    enableOfflineRecording,
  } = useSpeechInput();
  const eyeTracker = useEyeContactTracker(Boolean(activeExercise && activeSession));
  const getCheckpointEyeContactSummary = (): EyeContactSummary => {
    const liveWindow: EyeContactSummary = {
      score: eyeTracker.samples > 0 ? eyeTracker.score : null,
      samples: eyeTracker.samples,
    };
    return sessionMode === 'offline'
      ? combineEyeContactSummaries(offlineEyeContactBaselineRef.current, liveWindow)
      : liveWindow;
  };

  useEffect(() => {
    if (sessionMode !== 'offline' || !isListening || !activeSession || !activeExercise) return;
    const isIntro = activeExercise.kind === 'intro';
    const answerIndex = isIntro ? 1 : messagesRef.current.filter(message => message.sender === 'user').length + 1;
    void enableOfflineRecording({
      enabled: true,
      activityType: isIntro ? 'pre_test_intro' : 'pre_test_active_listening',
      turnId: isIntro ? 'intro-1' : `active-listening-${answerIndex}`,
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    });
  }, [activeExercise, activeSession, enableOfflineRecording, isListening, onOfflineAudioCaptured, sessionMode]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { introTranscriptRef.current = introTranscript; }, [introTranscript]);

  useEffect(() => {
    if (!resumeSession || resumeSession.mode !== 'offline' || resumedSessionRef.current === resumeSession.clientSessionId) return;
    if (!['pre_test_intro', 'pre_test_active_listening'].includes(resumeSession.type)) return;
    resumedSessionRef.current = resumeSession.clientSessionId;
    if (!hasCurrentQuestionPack(resumeSession.type, resumeSession.questionPackVersion)) {
      setVersionMismatch(true);
      setError('This saved offline activity uses an older question version. It was preserved and cannot be resumed automatically.');
      return;
    }

    const exercise = exercises.find(item =>
      resumeSession.type === 'pre_test_intro' ? item.kind === 'intro' : item.kind === 'active-listening'
    );
    if (!exercise) return;
    const restoredMessages = resumeSession.conversationLog as ChatMessage[];
    activeOfflineClientSessionIdRef.current = resumeSession.clientSessionId;
    offlineEyeContactBaselineRef.current = resumeSession.eyeContactSummary
      ? { ...resumeSession.eyeContactSummary }
      : null;
    setVersionMismatch(false);
    setActiveExercise(exercise);
    setActiveSession({
      id: resumeSession.clientSessionId,
      start_time: new Date(resumeSession.startedAt).toISOString(),
      status: 'active',
    });
    setIntroTranscript(resumeSession.type === 'pre_test_intro' ? (resumeSession.answers[0]?.text || '') : '');
    messagesRef.current = restoredMessages;
    setMessages(restoredMessages);
    setConnectionState(resumeSession.type === 'pre_test_active_listening' ? 'ready' : 'idle');
    setNotice('Your saved offline Pre-Test activity has been restored from its last checkpoint.');
    onSessionModeChange(true);
  }, [onSessionModeChange, resumeSession]);

  useEffect(() => {
    if (sessionMode !== 'offline' || !activeSession || !activeExercise) return;
    if (activeExercise.kind === 'active-listening') {
      const answerCount = messagesRef.current.filter(message => message.sender === 'user').length;
      if (answerCount === 0 && resumeSession) {
        const canonicalPrompt = resumeSession.serverSessionId
          ? getActiveListeningPromptForServerSession(resumeSession.serverSessionId)
          : getOfflineActiveListeningPrompt(resumeSession.clientSessionId);
        const alignedMessages: ChatMessage[] = [{ sender: 'ai', text: canonicalPrompt }];
        void onActivityCheckpoint({
          currentQuestion: canonicalPrompt,
          conversationLog: alignedMessages,
          currentStep: 0,
          responseCount: 0,
        }).then(saved => {
          if (!saved) return;
          messagesRef.current = alignedMessages;
          setMessages(alignedMessages);
        });
      }
    }
    connectionAttemptRef.current += 1;
    clearActiveListeningTimeout();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    wsRef.current?.close(1000, 'Activity locked offline.');
    wsRef.current = null;
    setConnectionState(activeExercise.kind === 'active-listening' ? 'ready' : 'idle');
    setIsAiResponding(false);
    setNotice('Connection restored later will not switch this activity back to cloud AI. Progress is saved locally.');
  }, [activeExercise, activeSession, onActivityCheckpoint, resumeSession, sessionMode]);

  const loadSessions = useCallback(async () => {
    if (!effectiveOnline) {
      setLoading(false);
      return;
    }
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
  }, [apiUrl, effectiveOnline]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => () => {
    lifecycleGenerationRef.current += 1;
    connectionAttemptRef.current += 1;
    if (activeListeningTimeoutRef.current) clearTimeout(activeListeningTimeoutRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Exercise closed.');
    cancelListening();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [cancelListening]);

  const clearActiveListeningTimeout = () => {
    if (!activeListeningTimeoutRef.current) return;
    clearTimeout(activeListeningTimeoutRef.current);
    activeListeningTimeoutRef.current = null;
  };

  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setIsVoiceSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = CLEAR_AI_SPEECH_RATE;
    utterance.pitch = CLEAR_AI_SPEECH_PITCH;
    utterance.volume = CLEAR_AI_SPEECH_VOLUME;
    utterance.onstart = () => setIsVoiceSpeaking(true);
    utterance.onend = () => setIsVoiceSpeaking(false);
    utterance.onerror = () => setIsVoiceSpeaking(false);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsVoiceSpeaking(false);
    }
  }, []);

  function connectActiveListeningChat(serverSessionId: number, retryCount = 0) {
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
    initialActiveListeningReplayRef.current = getInitialActiveListeningReplay(messagesRef.current);
    setConnectionState('connecting');
    setError(null);
    setNotice(retryCount > 0 ? 'Reconnecting the audio interviewer…' : 'Connecting the audio interviewer…');
    const socket = new WebSocket(getWebSocketUrl(apiUrl, `/pre-test-active-listening/${serverSessionId}/chat`, token));
    wsRef.current = socket;
    const isCurrentAttempt = () => connectionAttemptRef.current === attemptId && wsRef.current === socket;

    socket.onopen = () => {
      if (!isCurrentAttempt()) return;
      setConnectionState('ready');
      setNotice('Active Listening started. Listen to the story, then summarize it.');
      setIsAiResponding(true);
      socket.send(JSON.stringify({ text: '/start_exercise' }));
      clearActiveListeningTimeout();
      activeListeningTimeoutRef.current = setTimeout(() => {
        if (!isCurrentAttempt()) return;
        aiMessageOpenRef.current = false;
        aiSpeechBufferRef.current = '';
        initialActiveListeningReplayRef.current = null;
        answerSubmissionInFlightRef.current = false;
        setIsSubmittingAnswer(false);
        setIsAiResponding(false);
        setConnectionState('error');
        setError('The AI service is taking longer than expected. Please try again.');
        connectionAttemptRef.current += 1;
        wsRef.current = null;
        if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      }, ACTIVE_LISTENING_FIRST_TOKEN_TIMEOUT_MS);
    };

    socket.onmessage = event => {
      if (!isCurrentAttempt()) return;
      const data: unknown = JSON.parse(event.data);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
      const eventType = 'type' in data && typeof data.type === 'string' ? data.type : '';
      const responseText = 'text' in data && typeof data.text === 'string' ? data.text : '';
      const serverMessageId = 'message_id' in data && typeof data.message_id === 'number'
        ? data.message_id
        : null;
      if (eventType === 'turn_complete') {
        clearActiveListeningTimeout();
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        answerSubmissionInFlightRef.current = false;
        setIsSubmittingAnswer(false);
        const initialReplay = initialActiveListeningReplayRef.current;
        const replayResolution = resolveInitialActiveListeningReplay(
          initialReplay,
          serverMessageId,
          aiSpeechBufferRef.current,
        );
        initialActiveListeningReplayRef.current = null;
        const completedQuestion = replayResolution.completedText;
        if (initialReplay !== null && replayResolution.shouldAppend) {
          const nextMessage: ChatMessage = {
            id: serverMessageId ?? undefined,
            sender: 'ai',
            text: completedQuestion,
          };
          const nextMessages = [...messagesRef.current, nextMessage];
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
        } else if (initialReplay === null && serverMessageId !== null) {
          const currentMessages = messagesRef.current;
          const latestMessage = currentMessages[currentMessages.length - 1];
          if (latestMessage?.sender === 'ai') {
            const nextMessages = currentMessages.map((message, index) =>
              index === currentMessages.length - 1 ? { ...message, id: serverMessageId } : message
            );
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
          }
        }
        if (completedQuestion) {
          speakText(completedQuestion);
          onActivityCheckpoint({
            conversationLog: messagesRef.current,
            currentQuestion: completedQuestion,
            responseCount: messagesRef.current.filter(message => message.sender === 'user').length,
            eyeContactSummary: getCheckpointEyeContactSummary(),
          });
        }
        aiSpeechBufferRef.current = '';
        return;
      }

      if (eventType === 'error') {
        clearActiveListeningTimeout();
        setConnectionState('error');
        setError(normalizeApiError(data, 'The audio interviewer could not respond. Check that the backend service is running.'));
        aiMessageOpenRef.current = false;
        initialActiveListeningReplayRef.current = null;
        answerSubmissionInFlightRef.current = false;
        setIsSubmittingAnswer(false);
        setIsAiResponding(false);
        aiSpeechBufferRef.current = '';
        return;
      }

      if (responseText) {
        clearActiveListeningTimeout();
        setIsAiResponding(true);
        aiSpeechBufferRef.current += responseText;
        if (initialActiveListeningReplayRef.current !== null) return;
        setMessages(prev => {
          let next: ChatMessage[];
          if (aiMessageOpenRef.current && prev[prev.length - 1]?.sender === 'ai') {
            next = prev.map((message, index) =>
              index === prev.length - 1 ? { ...message, text: message.text + responseText } : message
            );
          } else {
            aiMessageOpenRef.current = true;
            next = [...prev, { sender: 'ai', text: responseText }];
          }
          messagesRef.current = next;
          return next;
        });
      }
    };

    socket.onerror = () => {
      // The close event owns retry/error handling and includes the close reason.
    };

    socket.onclose = event => {
      if (!isCurrentAttempt()) return;
      wsRef.current = null;
      clearActiveListeningTimeout();
      aiMessageOpenRef.current = false;
      initialActiveListeningReplayRef.current = null;
      answerSubmissionInFlightRef.current = false;
      setIsSubmittingAnswer(false);
      setIsAiResponding(false);
      aiSpeechBufferRef.current = '';
      if (event.code === 1000) {
        setConnectionState('idle');
        return;
      }

      if (retryCount < ACTIVE_LISTENING_MAX_RETRIES) {
        setConnectionState('connecting');
        setNotice('Reconnecting the audio interviewer…');
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (connectionAttemptRef.current === attemptId) {
            connectActiveListeningChat(serverSessionId, retryCount + 1);
          }
        }, ACTIVE_LISTENING_RETRY_BACKOFF_MS);
        return;
      }

      setConnectionState('error');
      setNotice(null);
      setError(event.reason || 'Unable to connect to the audio interviewer.');
    };
  }

  const startExercise = async (exercise: Exercise) => {
    const lifecycleGeneration = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = lifecycleGeneration;
    setStarting(exercise.endpoint);
    setError(null);
    setNotice(null);
    setIntroTranscript('');
    introTranscriptRef.current = '';
    introPersistenceInFlightRef.current = false;
    setIsPersistingIntro(false);
    setMessages([]);
    setReply('');
    setConnectionState('idle');
    cancelListening();
    try {
      if (!effectiveOnline) {
        offlineEyeContactBaselineRef.current = null;
        const type = exercise.kind === 'intro' ? 'pre_test_intro' : 'pre_test_active_listening';
        const clientSessionId = createClientSessionId();
        const questionPackVersion = exercise.kind === 'intro'
          ? PRETEST_WHO_AM_I_VERSION
          : PRETEST_ACTIVE_LISTENING_VERSION;
        const prompt = exercise.kind === 'intro'
          ? PRETEST_WHO_AM_I_PROMPT
          : getOfflineActiveListeningPrompt(clientSessionId);
        const initialMessages: ChatMessage[] = exercise.kind === 'active-listening'
          ? [{ sender: 'ai', text: prompt }]
          : [];
        const checkpoint = await onActivityStart({
          type,
          mode: 'offline',
          clientSessionId,
          questionPackVersion,
          currentQuestion: prompt,
          conversationLog: initialMessages,
          currentStep: 0,
          activityState: { exerciseKind: exercise.kind, exerciseTitle: exercise.title },
        });
        if (!checkpoint || lifecycleGenerationRef.current !== lifecycleGeneration) return;
        activeOfflineClientSessionIdRef.current = checkpoint.clientSessionId;
        setActiveExercise(exercise);
        setActiveSession({
          id: checkpoint.clientSessionId,
          start_time: new Date(checkpoint.startedAt).toISOString(),
          status: 'active',
        });
        messagesRef.current = initialMessages;
        setMessages(initialMessages);
        setConnectionState(exercise.kind === 'active-listening' ? 'ready' : 'idle');
        setNotice(`${exercise.title} started offline. Your progress will be saved on this device.`);
        onSessionModeChange(true);
        if (exercise.kind === 'active-listening') speakText(prompt);
        return;
      }

      offlineEyeContactBaselineRef.current = null;
      activeOfflineClientSessionIdRef.current = null;
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(`${apiUrl}${exercise.endpoint}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(normalizeApiError(body, `Unable to start ${exercise.title}.`));
      }
      const session: Session = await response.json();
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      let activeListeningServerSessionId: number | null = null;
      if (exercise.kind === 'intro') {
        const execution = resolvePreTestSessionExecution({
          sessionMode: 'online',
          activeSessionId: session.id,
          knownOfflineClientSessionId: null,
        });
        if (execution.mode !== 'online') throw new Error(PRE_TEST_SESSION_RECOVERY_ERROR);
      } else {
        const execution = resolveSessionExecution({
          sessionMode: 'online',
          activeSessionId: session.id,
          knownOfflineClientSessionId: null,
        });
        if (execution.mode !== 'online') throw new Error(PRE_TEST_SESSION_RECOVERY_ERROR);
        activeListeningServerSessionId = execution.serverSessionId;
      }
      const restoredIntroTranscript = exercise.kind === 'intro'
        ? (session.transcript?.trim() || '')
        : '';
      if (exercise.kind === 'active-listening') {
        if (activeListeningServerSessionId === null) throw new Error(PRE_TEST_SESSION_RECOVERY_ERROR);
        messagesRef.current = [];
        initialActiveListeningReplayRef.current = null;
        const sessionDetailResponse = await fetch(`${apiUrl}${exercise.endpoint}/${activeListeningServerSessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!sessionDetailResponse.ok) {
          const body = await sessionDetailResponse.json().catch(() => null);
          throw new Error(normalizeApiError(body, 'Unable to restore the Active Listening conversation.'));
        }
        const sessionDetail: {
          messages?: Array<{ id: number; role: string; content: string }>;
        } = await sessionDetailResponse.json();
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
        const restoredMessages: ChatMessage[] = (sessionDetail.messages || []).map(message => {
          const sender: ChatMessage['sender'] = message.role === 'ai' ? 'ai' : 'user';
          return { id: message.id, sender, text: message.content };
        });
        messagesRef.current = restoredMessages;
        setMessages(restoredMessages);
      }
      setActiveExercise(exercise);
      setActiveSession(exercise.kind === 'active-listening'
        ? { ...session, id: activeListeningServerSessionId }
        : session);
      if (exercise.kind === 'intro') {
        introTranscriptRef.current = restoredIntroTranscript;
        setIntroTranscript(restoredIntroTranscript);
      }
      onSessionModeChange(true);
      const type = exercise.kind === 'intro' ? 'pre_test_intro' : 'pre_test_active_listening';
      let canonicalPrompt = PRETEST_WHO_AM_I_PROMPT;
      if (exercise.kind === 'active-listening') {
        if (activeListeningServerSessionId === null) throw new Error(PRE_TEST_SESSION_RECOVERY_ERROR);
        canonicalPrompt = getActiveListeningPromptForServerSession(activeListeningServerSessionId);
      }
      void onActivityStart({
        type,
        serverSessionId: exercise.kind === 'intro'
          ? (typeof session.id === 'number' ? session.id : null)
          : activeListeningServerSessionId,
        questionPackVersion: exercise.kind === 'intro' ? PRETEST_WHO_AM_I_VERSION : PRETEST_ACTIVE_LISTENING_VERSION,
        currentQuestion: canonicalPrompt,
        ...(exercise.kind === 'intro' ? {
          currentStep: restoredIntroTranscript ? 1 : 0,
          responseCount: restoredIntroTranscript ? 1 : 0,
          answers: restoredIntroTranscript
            ? [{ step: 1, text: restoredIntroTranscript, createdAt: Date.now() }]
            : [],
        } : {}),
        activityState: { exerciseKind: exercise.kind, exerciseTitle: exercise.title },
      });
      if (exercise.kind === 'active-listening') {
        if (activeListeningServerSessionId === null) throw new Error(PRE_TEST_SESSION_RECOVERY_ERROR);
        connectActiveListeningChat(activeListeningServerSessionId);
      } else if (restoredIntroTranscript) {
        setNotice('Your saved Who Am I? response was restored. You can complete the exercise when ready.');
      } else {
        setNotice('Who Am I? started. Use the mic to introduce yourself.');
      }
      await loadSessions();
    } catch (err) {
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setError(err instanceof Error ? err.message : `Unable to start ${exercise.title}.`);
    } finally {
      if (lifecycleGenerationRef.current === lifecycleGeneration) setStarting(null);
    }
  };

  const quitSession = () => {
    lifecycleGenerationRef.current += 1;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    cancelListening();
    connectionAttemptRef.current += 1;
    clearActiveListeningTimeout();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    wsRef.current?.close(1000, 'Exercise closed.');
    wsRef.current = null;
    aiMessageOpenRef.current = false;
    aiSpeechBufferRef.current = '';
    initialActiveListeningReplayRef.current = null;
    answerSubmissionInFlightRef.current = false;
    offlineEyeContactBaselineRef.current = null;
    activeOfflineClientSessionIdRef.current = null;
    introTranscriptRef.current = '';
    introPersistenceInFlightRef.current = false;
    setIsSubmittingAnswer(false);
    setIsPersistingIntro(false);
    setActiveExercise(null);
    setActiveSession(null);
    setIntroTranscript('');
    setMessages([]);
    setReply('');
    setIsAiResponding(false);
    setIsVoiceSpeaking(false);
    setConnectionState('idle');
    setNotice('Exercise exited. Complete the exercise later to finish it properly.');
    void onActivityEnd('abandoned');
    onSessionModeChange(false);
  };

  const sendReply = async (spokenText = reply) => {
    const text = spokenText.trim();
    if (!text || isAiResponding) return;
    if (sessionMode !== 'offline' && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) return;
    const isOnlineSubmission = sessionMode !== 'offline';
    if (isOnlineSubmission && answerSubmissionInFlightRef.current) return;
    if (isOnlineSubmission) {
      answerSubmissionInFlightRef.current = true;
      setIsSubmittingAnswer(true);
    }
    let sentToServer = false;
    try {
      aiMessageOpenRef.current = false;
      aiSpeechBufferRef.current = '';
      const nextMessage: ChatMessage = { sender: 'user', text };
      const nextMessages = [...messagesRef.current, nextMessage];
      const saved = await onActivityCheckpoint({
        conversationLog: nextMessages,
        responseCount: nextMessages.filter(message => message.sender === 'user').length,
        answers: nextMessages
          .filter(message => message.sender === 'user')
          .map((message, index) => ({ step: index + 1, text: message.text, createdAt: Date.now() })),
        eyeContactSummary: getCheckpointEyeContactSummary(),
        pendingEvaluation: sessionMode === 'offline'
          ? { aiFeedback: true, reason: 'Active Listening feedback requires server evaluation after sync.' }
          : null,
      });
      if (!saved) return;
      resetSpeechTranscript();
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setReply('');
      if (sessionMode === 'offline') {
        setNotice('Response saved locally. Detailed AI feedback is pending until this activity is synchronized.');
        return;
      }
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('The audio interviewer disconnected before the response could be submitted.');
      }
      setIsAiResponding(true);
      socket.send(JSON.stringify({ text }));
      sentToServer = true;
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit the Active Listening response.');
    } finally {
      if (isOnlineSubmission && !sentToServer) {
        answerSubmissionInFlightRef.current = false;
        setIsSubmittingAnswer(false);
      }
    }
  };

  const recordIntro = () => {
    if (!activeExercise || !activeSession) return;
    if (isVoiceSpeaking || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setError('Wait for the audio prompt to finish before starting the microphone.');
      return;
    }
    setError(null);
    startListening(async transcript => {
      const nextTranscript = [introTranscriptRef.current, transcript].filter(Boolean).join(' ').trim();
      if (!nextTranscript) return;
      const execution = resolvePreTestSessionExecution({
        sessionMode,
        activeSessionId: activeSession.id,
        knownOfflineClientSessionId: activeOfflineClientSessionIdRef.current,
      });
      if (execution.mode === 'invalid') {
        introTranscriptRef.current = nextTranscript;
        setIntroTranscript(nextTranscript);
        setError(PRE_TEST_SESSION_RECOVERY_ERROR);
        return;
      }
      if (execution.mode === 'online') {
        if (introPersistenceInFlightRef.current) return;
        introPersistenceInFlightRef.current = true;
        setIsPersistingIntro(true);
        const lifecycleGeneration = lifecycleGenerationRef.current;
        try {
          const token = localStorage.getItem('token');
          if (!token) return;
          const response = await fetch(`${apiUrl}${activeExercise.endpoint}/${execution.serverSessionId}/response`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transcript: nextTranscript }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(normalizeApiError(body, 'Unable to save your Who Am I? response.'));
          }
          const persistedSession: Session = await response.json();
          if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
          const canonicalTranscript = persistedSession.transcript?.trim() || nextTranscript;
          introTranscriptRef.current = canonicalTranscript;
          setIntroTranscript(canonicalTranscript);
          resetSpeechTranscript();
          await onActivityCheckpoint({
            currentStep: 1,
            responseCount: 1,
            answers: [{ step: 1, text: canonicalTranscript, createdAt: Date.now() }],
            eyeContactSummary: getCheckpointEyeContactSummary(),
          });
          setNotice('Your Who Am I? response is saved. You can complete the exercise when ready.');
        } catch (persistenceError) {
          if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
          setError(persistenceError instanceof Error ? persistenceError.message : 'Unable to save your Who Am I? response.');
        } finally {
          if (lifecycleGenerationRef.current === lifecycleGeneration) {
            introPersistenceInFlightRef.current = false;
            setIsPersistingIntro(false);
          }
        }
        return;
      }

      const saved = await onActivityCheckpoint({
        currentStep: 1,
        responseCount: 1,
        answers: [{ step: 1, text: nextTranscript, createdAt: Date.now() }],
        eyeContactSummary: getCheckpointEyeContactSummary(),
      });
      if (saved) {
        introTranscriptRef.current = nextTranscript;
        setIntroTranscript(nextTranscript);
        resetSpeechTranscript();
      }
    }, setError, sessionMode === 'offline' && activeSession ? {
      enabled: true,
      activityType: activeExercise.kind === 'intro' ? 'pre_test_intro' : 'pre_test_active_listening',
      turnId: 'intro-1',
      answerIndex: 1,
      persistAudio: onOfflineAudioCaptured,
    } : undefined);
  };

  const saveTypedIntro = async () => {
    const text = introTranscript.trim();
    if (!text) return;
    const saved = await onActivityCheckpoint({
      currentStep: 1,
      responseCount: 1,
      answers: [{ step: 1, text, createdAt: Date.now() }],
      eyeContactSummary: getCheckpointEyeContactSummary(),
    });
    if (saved) resetSpeechTranscript();
  };

  const recordAndSendReply = () => {
    if (isVoiceSpeaking || isAiResponding || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setError('Wait for the audio interviewer to finish before starting the microphone.');
      return;
    }
    setError(null);
    const answerIndex = messagesRef.current.filter(message => message.sender === 'user').length + 1;
    startListening(transcript => void sendReply(transcript), setError, sessionMode === 'offline' && activeSession ? {
      enabled: true,
      activityType: 'pre_test_active_listening',
      turnId: `active-listening-${answerIndex}`,
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    } : undefined);
  };

  const completeActiveExercise = async () => {
    if (!activeSession || !activeExercise) return;
    if (activeExercise.kind === 'intro' && introPersistenceInFlightRef.current) return;
    const introExecution = activeExercise.kind === 'intro'
      ? resolvePreTestSessionExecution({
          sessionMode,
          activeSessionId: activeSession.id,
          knownOfflineClientSessionId: activeOfflineClientSessionIdRef.current,
        })
      : null;
    const activeListeningExecution = activeExercise.kind === 'active-listening'
      ? resolveSessionExecution({
          sessionMode,
          activeSessionId: activeSession.id,
          knownOfflineClientSessionId: activeOfflineClientSessionIdRef.current,
        })
      : null;
    if (introExecution?.mode === 'invalid') {
      setError(PRE_TEST_SESSION_RECOVERY_ERROR);
      return;
    }
    if (activeListeningExecution?.mode === 'invalid') {
      setError(PRE_TEST_SESSION_RECOVERY_ERROR);
      return;
    }
    if (introExecution?.mode === 'offline' || activeListeningExecution?.mode === 'offline') {
      setCompleting(true);
      setError(null);
      const isIntro = activeExercise.kind === 'intro';
      const result = isIntro ? evaluateWhoAmI(introTranscript) : evaluateActiveListening(messages);
      const checkpointSaved = await onActivityCheckpoint({
        conversationLog: isIntro ? [] : messages,
        responseCount: isIntro ? (introTranscript.trim() ? 1 : 0) : messages.filter(message => message.sender === 'user').length,
        currentStep: isIntro ? 1 : messages.filter(message => message.sender === 'user').length,
        answers: isIntro
          ? [{ step: 1, text: introTranscript.trim(), createdAt: Date.now() }]
          : messages.filter(message => message.sender === 'user').map((message, index) => ({ step: index + 1, text: message.text, createdAt: Date.now() })),
        localEvaluation: result.evaluation,
        localScore: result.localScore,
        evaluationAuthority: 'local_provisional',
        pendingEvaluation: isIntro ? null : {
          aiFeedback: true,
          reason: 'Summary accuracy and detailed AI feedback require server evaluation after sync.',
        },
        eyeContactSummary: getCheckpointEyeContactSummary(),
      });
      if (!checkpointSaved || !await onActivityEnd('completed_local')) {
        setCompleting(false);
        return;
      }
      cancelListening();
      setActiveExercise(null);
      setActiveSession(null);
      setMessages([]);
      messagesRef.current = [];
      offlineEyeContactBaselineRef.current = null;
      activeOfflineClientSessionIdRef.current = null;
      introTranscriptRef.current = '';
      setIntroTranscript('');
      setConnectionState('idle');
      setNotice(`${activeExercise.title} completed locally and is pending sync.`);
      onSessionModeChange(false);
      setCompleting(false);
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    setCompleting(true);
    setError(null);
    setNotice(null);
    try {
      const isIntro = activeExercise.kind === 'intro';
      const serverSessionId = introExecution?.mode === 'online'
        ? introExecution.serverSessionId
        : activeListeningExecution?.mode === 'online'
          ? activeListeningExecution.serverSessionId
          : null;
      if (serverSessionId === null) {
        setError(PRE_TEST_SESSION_RECOVERY_ERROR);
        return;
      }
      const response = await fetch(`${apiUrl}${activeExercise.endpoint}/${serverSessionId}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isIntro ? {
          transcript: introTranscript,
          evaluation: {
            ...evaluateWhoAmI(introTranscript).evaluation,
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        } : {
          conversation: messages,
          evaluation: {
            ...evaluateActiveListening(messages).evaluation,
            feedback_summary: 'Active listening exercise completed. Review the transcript for the AI feedback and summary accuracy.',
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(normalizeApiError(body, `Unable to complete ${activeExercise.title}.`));
      }
      cancelListening();
      connectionAttemptRef.current += 1;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
      wsRef.current?.close(1000, 'Exercise completed.');
      wsRef.current = null;
      initialActiveListeningReplayRef.current = null;
      answerSubmissionInFlightRef.current = false;
      offlineEyeContactBaselineRef.current = null;
      activeOfflineClientSessionIdRef.current = null;
      introTranscriptRef.current = '';
      introPersistenceInFlightRef.current = false;
      setIsSubmittingAnswer(false);
      setIsPersistingIntro(false);
      setConnectionState('idle');
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setActiveExercise(null);
      setActiveSession(null);
      setMessages([]);
      setIntroTranscript('');
      setNotice(`${activeExercise.title} completed.`);
      void onActivityEnd('cloud_completed');
      onSessionModeChange(false);
      await loadSessions();
    } catch (err) {
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setError(err instanceof Error ? err.message : `Unable to complete ${activeExercise.title}.`);
    } finally {
      if (lifecycleGenerationRef.current === lifecycleGeneration) setCompleting(false);
    }
  };

  const visibleActiveListeningMessages = getVisibleActiveListeningMessages(messages);

  if (activeExercise && activeSession) {
    return (
      <div className="min-h-screen w-full bg-page p-4 text-ink sm:p-8">
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
              disabled={completing || (activeExercise.kind === 'intro'
                ? isPersistingIntro || !introTranscript.trim()
                : isSubmittingAnswer || isAiResponding || !messages.some(message => message.sender === 'user'))}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Exercise'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Pre-Test Session</p>
                <h1 className="text-3xl font-bold tracking-tight text-ink">{activeExercise.kind === 'active-listening' ? 'Active Listening' : activeExercise.title}</h1>
                <p className="mt-1 text-sm text-muted">
                  {activeExercise.kind === 'intro'
                    ? 'Introduce yourself clearly, completely, and concisely.'
                    : 'Listen first, then summarize the story or instructions accurately.'}
                </p>
              </div>
              <CameraTrackingNotice {...eyeTracker} />
            </div>

            {(error || notice) && (
              <div className={`mb-4 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-success'}`}>
                <span>{error || notice}</span>
                {error && activeExercise.kind === 'active-listening' && connectionState === 'error' && (
                  <button
                    onClick={() => void startExercise(activeExercise)}
                    disabled={starting !== null}
                    className="shrink-0 rounded-md border border-current px-3 py-1.5 font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {activeExercise.kind === 'intro' ? (
              <div>
                <div className="rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  <p className="text-program-accent font-bold">Prompt</p>
                  <p className="mt-1">
                    {PRETEST_WHO_AM_I_PROMPT}
                  </p>
                </div>
                <div className="mt-4 min-h-[35vh] rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  {sessionMode === 'offline' ? (
                    <textarea
                      value={introTranscript}
                      onChange={event => setIntroTranscript(event.target.value)}
                      placeholder="Speak with the mic or type your self-introduction here."
                      className="min-h-[30vh] w-full resize-y bg-transparent text-ink outline-none placeholder:text-muted"
                    />
                  ) : introTranscript || <span className="text-muted">Press the mic and speak your self-introduction.</span>}
                </div>
                {(isListening || isFinalizing || hasUnfinalizedTranscript) && (
                  <div className="mt-3 rounded-lg border border-line bg-card p-3 text-sm leading-relaxed text-ink" aria-live="polite">
                    <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-wider">
                      {isFinalizing ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                    </p>
                    {liveTranscript || <span className="text-muted">Start speaking when you are ready.</span>}
                  </div>
                )}
                {sessionMode === 'offline' && (
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => void saveTypedIntro()} disabled={!introTranscript.trim()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50">Save Typed Answer</button>
                  </div>
                )}
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordIntro}
                    disabled={isPersistingIntro || isFinalizing || isVoiceSpeaking}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                  >
                    {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : 'Speak Answer'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <SoundWaveInterviewer
                  active={isVoiceSpeaking || isAiResponding}
                  label={
                    connectionState === 'connecting'
                      ? 'Connecting audio interviewer...'
                      : connectionState === 'error'
                        ? 'Audio interviewer unavailable'
                        : isVoiceSpeaking
                          ? 'Speaking...'
                          : isAiResponding
                            ? 'Preparing prompt...'
                            : connectionState === 'ready'
                              ? 'Audio interviewer ready'
                              : 'Preparing exercise...'
                  }
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
                    <div key={message.id ?? index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'program-accent-fill' : 'border border-line bg-card text-ink'}`}>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">
                          {message.sender === 'user' ? 'You' : 'Professor Maxiel'}
                        </p>
                        {message.text}
                      </div>
                    </div>
                  ))}
                </div>

                {(isListening || isFinalizing || hasUnfinalizedTranscript) && (
                  <div className="mt-3 rounded-lg border border-line bg-card p-3 text-sm leading-relaxed text-ink" aria-live="polite">
                    <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-wider">
                      {isFinalizing ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                    </p>
                    {liveTranscript || <span className="text-muted">Start speaking when you are ready.</span>}
                  </div>
                )}

                <div className="mt-3 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordAndSendReply}
                    disabled={connectionState !== 'ready' || isAiResponding || isVoiceSpeaking || isSubmittingAnswer}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                  >
                    {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : 'Speak Answer'}
                  </button>
                </div>
                {sessionMode === 'offline' && (
                  <div className="mx-auto mt-4 flex max-w-2xl gap-2">
                    <textarea value={reply} onChange={event => setReply(event.target.value)} placeholder="Or type your summary while offline." className="min-h-20 flex-1 resize-y rounded-lg border border-line bg-background p-3 text-sm text-ink outline-none" />
                    <button type="button" onClick={() => void sendReply()} disabled={!reply.trim()} className="program-accent-button self-end rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-50">Submit</button>
                  </div>
                )}
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
              <h2 className="text-xl font-bold text-ink">{activeExercise.kind === 'active-listening' ? 'Active Listening' : activeExercise.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {activeExercise.kind === 'intro'
                  ? 'Introduce yourself clearly, completely, and concisely.'
                  : 'Listen first, then summarize the story or instructions accurately.'}
              </p>
            </div>
            <button
              onClick={completeActiveExercise}
              disabled={completing || (activeExercise.kind === 'intro'
                ? isPersistingIntro || !introTranscript.trim()
                : isSubmittingAnswer || isAiResponding || !messages.some(message => message.sender === 'user'))}
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
                  {PRETEST_WHO_AM_I_PROMPT}
                </p>
              </div>
              <div className="mt-4 min-h-48 rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                {introTranscript || <span className="text-muted">Press the mic and speak your self-introduction.</span>}
              </div>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={isListening ? stopListening : recordIntro}
                  disabled={isPersistingIntro || isFinalizing || isVoiceSpeaking}
                  className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                >
                  {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
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
                  <div key={message.id ?? index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'program-accent-fill' : 'border border-line bg-card text-ink'}`}>
                      <p className="mb-1 text-xs font-bold uppercase tracking-wider opacity-70">
                        {message.sender === 'user' ? 'You' : 'Professor Maxiel'}
                      </p>
                      {message.text}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-center">
                <button
                  onClick={isListening ? stopListening : recordAndSendReply}
                  disabled={connectionState !== 'ready' || isAiResponding || isVoiceSpeaking || isSubmittingAnswer || isFinalizing}
                  className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                >
                  {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
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
