import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, LoaderCircle, Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { SoundWaveInterviewer } from './SoundWaveInterviewer';
import { CameraTrackingNotice } from './CameraTrackingNotice';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME } from '../utils/speech';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';
import type { OfflineActivityBridgeProps } from '../offline/sessionFoundation';
import { createClientSessionId } from '../offline/sessionFoundation';
import { combineEyeContactSummaries, type EyeContactSummary } from '../offline/eyeContact';
import { evaluatePostTest } from '../offline/localEvaluation';
import { getPostTestQuestions, hasCurrentQuestionPack, POST_TEST_VERSION } from '../offline/questionPacks';
import { normalizeApiError } from '../utils/httpError';
import { resolveSessionExecution } from '../utils/sessionExecution';
import {
  appendOfflinePostTestAnswer,
  appendPostTestUserAnswer,
  getPostTestAnswerBoundary,
  getPostTestQuestionForProgress,
  POST_TEST_ANSWER_LIMIT,
  requireExactPostTestAnswerCount,
} from '../offline/activityRuntime';

type Session = {
  id: number | string;
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

export type ChatMessage = {
  sender: 'user' | 'ai';
  text: string;
};

export type InitialPostTestReplayResolution = {
  completedText: string;
  isHydratedReplay: boolean;
  shouldAppend: boolean;
};

export const getInitialPostTestReplayText = (messages: readonly ChatMessage[]): string | null => {
  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.sender !== 'ai') return null;
  return latestMessage.text.trim() || null;
};

export const resolveInitialPostTestReplay = (
  expectedText: string | null,
  streamedText: string,
): InitialPostTestReplayResolution => {
  const completedText = streamedText.trim();
  const isHydratedReplay = expectedText !== null && completedText === expectedText;
  return {
    completedText,
    isHydratedReplay,
    shouldAppend: completedText.length > 0 && !isHydratedReplay,
  };
};

type RealtimeConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

const getWebSocketUrl = (apiUrl: string, path: string, token: string) => {
  const url = new URL(path, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
};

const POST_TEST_FIRST_PROMPT_TIMEOUT_MS = 30000;
const POST_TEST_MAX_RETRIES = 1;
const POST_TEST_RETRY_BACKOFF_MS = 500;
const POST_TEST_SESSION_RECOVERY_ERROR = 'Unable to verify this Post-Test session. Please reload the activity and try again.';

type PostTestPageProps = OfflineActivityBridgeProps & {
  apiUrl: string;
  userDepartment: string;
  onSessionModeChange?: (isSessionMode: boolean) => void;
};

export function PostTestPage({
  apiUrl,
  onSessionModeChange = () => {},
  effectiveOnline,
  sessionMode,
  resumeSession,
  onActivityStart,
  onActivityCheckpoint,
  onActivityEnd,
  onOfflineAudioCaptured,
  userDepartment,
}: PostTestPageProps) {
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
  const messagesRef = useRef<ChatMessage[]>([]);
  const aiMessageOpenRef = useRef(false);
  const aiSpeechBufferRef = useRef('');
  const initialReplayExpectedTextRef = useRef<string | null>(null);
  const firstPromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionAttemptRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const resumedSessionRef = useRef<string | null>(null);
  const activeOfflineClientSessionIdRef = useRef<string | null>(null);
  const offlineEyeContactBaselineRef = useRef<EyeContactSummary | null>(null);
  const answerSubmissionInFlightRef = useRef(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
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
  const eyeTracker = useEyeContactTracker(Boolean(activeSession));
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
    if (sessionMode !== 'offline' || !isListening || !activeSession) return;
    const answerIndex = messagesRef.current.filter(message => message.sender === 'user').length + 1;
    void enableOfflineRecording({
      enabled: true,
      activityType: 'post_test',
      turnId: `post-test-${answerIndex}`,
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    });
  }, [activeSession, enableOfflineRecording, isListening, onOfflineAudioCaptured, sessionMode]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (
      !resumeSession
      || resumeSession.type !== 'post_test'
      || resumeSession.mode !== 'offline'
      || resumedSessionRef.current === resumeSession.clientSessionId
    ) return;
    resumedSessionRef.current = resumeSession.clientSessionId;
    if (!hasCurrentQuestionPack('post_test', resumeSession.questionPackVersion)) {
      setError('This saved offline activity uses an older question version. It was preserved and cannot be resumed automatically.');
      return;
    }
    const restoredMessages = resumeSession.conversationLog as ChatMessage[];
    activeOfflineClientSessionIdRef.current = resumeSession.clientSessionId;
    offlineEyeContactBaselineRef.current = resumeSession.eyeContactSummary
      ? { ...resumeSession.eyeContactSummary }
      : null;
    const questions = getPostTestQuestions(String(resumeSession.activityState.department || userDepartment));
    const boundary = getPostTestAnswerBoundary(restoredMessages);
    const currentQuestion = resumeSession.currentQuestion || getPostTestQuestionForProgress(questions, boundary.answerCount);
    messagesRef.current = restoredMessages;
    setMessages(restoredMessages);
    setLatestAiQuestion(currentQuestion);
    setActiveSession({
      id: resumeSession.clientSessionId,
      start_time: new Date(resumeSession.startedAt).toISOString(),
      status: 'active',
    });
    setConnectionState('ready');
    if (boundary.hasTooManyAnswers) {
      setError('This saved Post-Test contains more than five answers. It was preserved and requires manual recovery.');
      setNotice(null);
    } else if (boundary.canComplete) {
      setError(null);
      setNotice('All five saved Post-Test answers are ready. Complete the interview to queue it for sync.');
    } else {
      setError(null);
      setNotice('Your saved offline Post-Test has been restored from its last checkpoint.');
    }
    onSessionModeChange(true);
  }, [onSessionModeChange, resumeSession, userDepartment]);

  useEffect(() => {
    if (sessionMode !== 'offline' || !activeSession) return;
    const alignWithOfflinePack = async () => {
      const questions = getPostTestQuestions(userDepartment);
      const answerCount = messagesRef.current.filter(message => message.sender === 'user').length;
      if (answerCount >= questions.length) return;
      const expectedQuestion = questions[answerCount];
      const currentMessages = messagesRef.current;
      const lastMessage = currentMessages[currentMessages.length - 1];
      const alignedMessages: ChatMessage[] = lastMessage?.sender === 'user'
        ? [...currentMessages, { sender: 'ai', text: expectedQuestion }]
        : lastMessage?.sender === 'ai' && lastMessage.text !== expectedQuestion
          ? [...currentMessages.slice(0, -1), { sender: 'ai', text: expectedQuestion }]
          : currentMessages;
      const saved = await onActivityCheckpoint({
        currentQuestion: expectedQuestion,
        conversationLog: alignedMessages,
        currentStep: answerCount,
        responseCount: answerCount,
      });
      if (!saved) return;
      messagesRef.current = alignedMessages;
      setMessages(alignedMessages);
      setLatestAiQuestion(expectedQuestion);
    };
    void alignWithOfflinePack();
    connectionAttemptRef.current += 1;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    wsRef.current?.close(1000, 'Activity locked offline.');
    wsRef.current = null;
    setConnectionState('ready');
    setIsAiResponding(false);
    const boundary = getPostTestAnswerBoundary(messagesRef.current);
    if (boundary.hasTooManyAnswers) {
      setNotice(null);
    } else if (boundary.canComplete) {
      setNotice('All five saved Post-Test answers are ready. Complete the interview to queue it for sync.');
    } else {
      setNotice('This Post-Test remains offline until it is completed or abandoned.');
    }
  }, [activeSession, onActivityCheckpoint, sessionMode, userDepartment]);

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
    if (!effectiveOnline) {
      setLoading(false);
      return;
    }
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
  }, [apiUrl, effectiveOnline]);

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

  function connectPostTestChat(serverSessionId: number, retryCount = 0) {
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
    const initialReplayExpectedText = getInitialPostTestReplayText(messagesRef.current);
    initialReplayExpectedTextRef.current = initialReplayExpectedText;
    setLatestAiQuestion(initialReplayExpectedText || '');
    setConnectionState('connecting');
    setError(null);
    setNotice(retryCount > 0 ? 'Reconnecting the audio interviewer…' : 'Connecting the audio interviewer…');
    const socket = new WebSocket(getWebSocketUrl(apiUrl, `/post-test-interview/${serverSessionId}/chat`, token));
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
        initialReplayExpectedTextRef.current = null;
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
      const data: unknown = JSON.parse(event.data);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
      const eventType = 'type' in data && typeof data.type === 'string' ? data.type : '';
      const responseText = 'text' in data && typeof data.text === 'string' ? data.text : '';
      if (eventType === 'turn_complete') {
        clearFirstPromptTimeout();
        aiMessageOpenRef.current = false;
        setIsAiResponding(false);
        if (aiSpeechBufferRef.current.trim()) {
          const initialReplayExpectedText = initialReplayExpectedTextRef.current;
          const replayResolution = resolveInitialPostTestReplay(
            initialReplayExpectedText,
            aiSpeechBufferRef.current,
          );
          initialReplayExpectedTextRef.current = null;
          const completedQuestion = replayResolution.completedText;
          if (initialReplayExpectedText !== null && replayResolution.shouldAppend) {
            const nextMessage: ChatMessage = { sender: 'ai', text: completedQuestion };
            const nextMessages = [...messagesRef.current, nextMessage];
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
          }
          setLatestAiQuestion(completedQuestion);
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
        clearFirstPromptTimeout();
        setConnectionState('error');
        setError(normalizeApiError(data, 'The audio interviewer could not respond. Check that the backend service is running.'));
        aiMessageOpenRef.current = false;
        initialReplayExpectedTextRef.current = null;
        setIsAiResponding(false);
        aiSpeechBufferRef.current = '';
        return;
      }

      if (responseText) {
        clearFirstPromptTimeout();
        setIsAiResponding(true);
        aiSpeechBufferRef.current += responseText;
        if (initialReplayExpectedTextRef.current !== null) return;
        setMessages(prev => {
          let next: ChatMessage[];
          if (aiMessageOpenRef.current && prev[prev.length - 1]?.sender === 'ai') {
            next = prev.map((message, index) =>
              index === prev.length - 1 ? { ...message, text: message.text + responseText } : message
            );
          } else if (prev[prev.length - 1]?.sender === 'ai' && prev[prev.length - 1]?.text === responseText) {
            next = prev;
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
            connectPostTestChat(serverSessionId, retryCount + 1);
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
    const lifecycleGeneration = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = lifecycleGeneration;
    setStarting(true);
    setError(null);
    setNotice(null);
    setMessages([]);
    setLatestAiQuestion('');
    activeOfflineClientSessionIdRef.current = null;
    cancelSpeech();
    cancelListening();
    setConnectionState('idle');
    try {
      const questions = getPostTestQuestions(userDepartment);
      if (!effectiveOnline) {
        offlineEyeContactBaselineRef.current = null;
        const clientSessionId = createClientSessionId();
        const initialMessages: ChatMessage[] = [{ sender: 'ai', text: questions[0] }];
        const checkpoint = await onActivityStart({
          type: 'post_test',
          mode: 'offline',
          clientSessionId,
          questionPackVersion: POST_TEST_VERSION,
          currentQuestion: questions[0],
          conversationLog: initialMessages,
          currentStep: 0,
          activityState: { department: userDepartment },
        });
        if (!checkpoint || lifecycleGenerationRef.current !== lifecycleGeneration) return;
        activeOfflineClientSessionIdRef.current = checkpoint.clientSessionId;
        messagesRef.current = initialMessages;
        setMessages(initialMessages);
        setLatestAiQuestion(questions[0]);
        setActiveSession({
          id: checkpoint.clientSessionId,
          start_time: new Date(checkpoint.startedAt).toISOString(),
          status: 'active',
        });
        setConnectionState('ready');
        setNotice('Post-Test started offline. Complete all five questions; your provisional result will be queued for sync.');
        onSessionModeChange(true);
        speakText(questions[0]);
        return;
      }

      messagesRef.current = [];
      initialReplayExpectedTextRef.current = null;
      offlineEyeContactBaselineRef.current = null;
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(`${apiUrl}/post-test-interview/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(normalizeApiError(body, 'Unable to start the post-test interview.'));
      }
      const session: Session = await response.json();
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      const execution = resolveSessionExecution({
        sessionMode: 'online',
        activeSessionId: session.id,
        knownOfflineClientSessionId: null,
      });
      if (execution.mode !== 'online') throw new Error(POST_TEST_SESSION_RECOVERY_ERROR);
      const serverSessionId = execution.serverSessionId;

      const sessionDetailResponse = await fetch(`${apiUrl}/post-test-interview/${serverSessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!sessionDetailResponse.ok) {
        const body = await sessionDetailResponse.json().catch(() => null);
        throw new Error(normalizeApiError(body, 'Unable to restore the Post-Test conversation.'));
      }
      const sessionDetail: { messages?: Array<{ role: string; content: string }> } = await sessionDetailResponse.json();
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      const restoredMessages = (sessionDetail.messages || []).map(message => ({
        sender: message.role === 'ai' ? 'ai' : 'user',
        text: message.content,
      })) as ChatMessage[];
      messagesRef.current = restoredMessages;
      setMessages(restoredMessages);
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setActiveSession({ ...session, id: serverSessionId });
      onSessionModeChange(true);
      void onActivityStart({
        type: 'post_test',
        serverSessionId,
        questionPackVersion: POST_TEST_VERSION,
        currentQuestion: questions[0],
        activityState: { department: userDepartment },
      });
      connectPostTestChat(serverSessionId);
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
    initialReplayExpectedTextRef.current = null;
    offlineEyeContactBaselineRef.current = null;
    activeOfflineClientSessionIdRef.current = null;
    setActiveSession(null);
    setMessages([]);
    setReply('');
    setIsAiResponding(false);
    setIsVoiceSpeaking(false);
    setConnectionState('idle');
    setLatestAiQuestion('');
    setNotice('Post-test exited. Complete the interview later to finish it properly.');
    void onActivityEnd('abandoned');
    onSessionModeChange(false);
    void loadSessions();
  };

  const sendReply = async (spokenText = reply) => {
    const text = spokenText.trim();
    if (!text || isAiResponding || isVoiceSpeaking) return;
    if (sessionMode !== 'offline' && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) return;
    if (answerSubmissionInFlightRef.current) return;
    const currentMessages = messagesRef.current;
    const currentBoundary = getPostTestAnswerBoundary(currentMessages);
    if (!currentBoundary.canAcceptAnswer) {
      setReply('');
      if (currentBoundary.hasTooManyAnswers) {
        setError('This saved Post-Test contains more than five answers. It was preserved and requires manual recovery.');
        setNotice(null);
      } else {
        setError(null);
        setNotice('All five Post-Test answers are already recorded. Complete the interview to continue.');
      }
      return;
    }

    answerSubmissionInFlightRef.current = true;
    setIsSubmittingAnswer(true);
    try {
      aiMessageOpenRef.current = false;
      aiSpeechBufferRef.current = '';
      const questions = getPostTestQuestions(userDepartment);
      const offlineTurn = sessionMode === 'offline'
        ? appendOfflinePostTestAnswer(currentMessages, text, questions)
        : null;
      const onlineTurn = sessionMode === 'offline'
        ? null
        : appendPostTestUserAnswer(currentMessages, text);
      const checkpointMessages = offlineTurn?.conversationLog ?? onlineTurn?.conversationLog ?? currentMessages;
      const answerCount = offlineTurn?.answerCount ?? onlineTurn?.answerCount ?? currentBoundary.answerCount;
      const nextQuestion = offlineTurn?.nextQuestion || '';
      const saved = await onActivityCheckpoint({
        conversationLog: checkpointMessages,
        currentQuestion: offlineTurn?.currentQuestion || questions[Math.min(answerCount - 1, POST_TEST_ANSWER_LIMIT - 1)],
        currentStep: answerCount,
        responseCount: answerCount,
        answers: checkpointMessages
          .filter(message => message.sender === 'user')
          .map((message, index) => ({ step: index + 1, text: message.text, createdAt: Date.now() })),
        eyeContactSummary: getCheckpointEyeContactSummary(),
      });
      if (!saved) return;
      resetSpeechTranscript();
      messagesRef.current = checkpointMessages;
      setMessages(checkpointMessages);
      setReply('');
      if (sessionMode === 'offline') {
        setLatestAiQuestion(nextQuestion);
        if (nextQuestion) speakText(nextQuestion);
        else setNotice('All five offline Post-Test answers are saved. Complete the interview to queue it for sync.');
        return;
      }
      setIsAiResponding(true);
      wsRef.current?.send(JSON.stringify({ text }));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to save the Post-Test answer.');
    } finally {
      answerSubmissionInFlightRef.current = false;
      setIsSubmittingAnswer(false);
    }
  };

  const recordAndSendReply = () => {
    if (isVoiceSpeaking || isAiResponding || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setError('Wait for the audio interviewer to finish before starting the microphone.');
      return;
    }
    setError(null);
    const boundary = getPostTestAnswerBoundary(messagesRef.current);
    if (!boundary.canAcceptAnswer || answerSubmissionInFlightRef.current) {
      if (boundary.hasTooManyAnswers) {
        setError('This saved Post-Test contains more than five answers. It was preserved and requires manual recovery.');
      } else if (boundary.canComplete) {
        setNotice('All five Post-Test answers are already recorded. Complete the interview to continue.');
      }
      return;
    }
    const answerIndex = boundary.answerCount + 1;
    startListening(transcript => void sendReply(transcript), setError, sessionMode === 'offline' && activeSession ? {
      enabled: true,
      activityType: 'post_test',
      turnId: `post-test-${answerIndex}`,
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    } : undefined);
  };

  const completePostTest = async () => {
    if (!activeSession) return;
    const checkpointOfflineClientSessionId = resumeSession?.type === 'post_test' && resumeSession.mode === 'offline'
      ? resumeSession.clientSessionId
      : null;
    const execution = resolveSessionExecution({
      sessionMode,
      activeSessionId: activeSession.id,
      knownOfflineClientSessionId: activeOfflineClientSessionIdRef.current ?? checkpointOfflineClientSessionId,
    });
    if (execution.mode === 'invalid') {
      setError(POST_TEST_SESSION_RECOVERY_ERROR);
      return;
    }
    const currentMessages = messagesRef.current;
    try {
      requireExactPostTestAnswerCount(currentMessages);
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : 'The Post-Test answer count is invalid.');
      return;
    }
    if (execution.mode === 'offline') {
      setCompleting(true);
      setError(null);
      const result = evaluatePostTest(currentMessages);
      const rawAnswers = currentMessages.filter(message => message.sender === 'user').map((message, index) => ({
        step: index + 1,
        text: message.text,
        createdAt: Date.now(),
      }));
      const saved = await onActivityCheckpoint({
        conversationLog: currentMessages,
        answers: rawAnswers,
        responseCount: rawAnswers.length,
        currentStep: rawAnswers.length,
        localEvaluation: result.evaluation,
        localScore: result.localScore,
        evaluationAuthority: 'local_provisional',
        pendingEvaluation: null,
        eyeContactSummary: getCheckpointEyeContactSummary(),
      });
      if (!saved || !await onActivityEnd('completed_local')) {
        setCompleting(false);
        return;
      }
      cancelListening();
      cancelSpeech();
      setActiveSession(null);
      setMessages([]);
      messagesRef.current = [];
      setLatestAiQuestion('');
      offlineEyeContactBaselineRef.current = null;
      activeOfflineClientSessionIdRef.current = null;
      setConnectionState('idle');
      setNotice('Post-Test completed locally and is pending sync.');
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
      const response = await fetch(`${apiUrl}/post-test-interview/${execution.serverSessionId}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation: currentMessages,
          evaluation: {
            ...evaluatePostTest(currentMessages).evaluation,
            eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
            eye_contact_samples: eyeTracker.samples,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(normalizeApiError(body, 'Unable to complete the post-test interview.'));
      }
      cancelListening();
      connectionAttemptRef.current += 1;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
      wsRef.current?.close(1000, 'Exercise completed.');
      wsRef.current = null;
      setConnectionState('idle');
      cancelSpeech();
      if (lifecycleGenerationRef.current !== lifecycleGeneration) return;
      setActiveSession(null);
      setMessages([]);
      setLatestAiQuestion('');
      offlineEyeContactBaselineRef.current = null;
      activeOfflineClientSessionIdRef.current = null;
      setNotice('Post-Test completed.');
      void onActivityEnd('cloud_completed');
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
  const answerBoundary = getPostTestAnswerBoundary(messages);
  const askedQuestionCount = messages.filter(message =>
    message.sender === 'ai' && !message.text.startsWith('You have completed all five Post-Test questions.')
  ).length;
  const currentQuestionNumber = Math.min(Math.max(askedQuestionCount, 1), 5);

  if (activeSession) {
    return (
      <div className="min-h-screen w-full bg-page p-4 text-ink sm:p-8">
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
              disabled={completing || isSubmittingAnswer || isAiResponding || !answerBoundary.canComplete}
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing ? 'Completing…' : 'Complete Interview'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Post-Test Session</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-ink">Post-Test Interview</h1>
                  <span className="program-accent-surface rounded-full px-3 py-1 text-sm font-bold">
                    Question {currentQuestionNumber} of 5
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">Answer the audio interviewer one question at a time.</p>
              </div>
              <CameraTrackingNotice {...eyeTracker} />
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

            {(isListening || isFinalizing || hasUnfinalizedTranscript) && (
              <div className="mx-auto mt-4 w-full max-w-2xl rounded-lg border border-line bg-card p-3 text-left text-sm leading-relaxed text-ink" aria-live="polite">
                <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-wider">
                  {isFinalizing ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                </p>
                {liveTranscript || <span className="text-muted">Start speaking when you are ready.</span>}
              </div>
            )}

            <div className="mt-4 flex justify-center">
              <button
                onClick={isListening ? stopListening : recordAndSendReply}
                disabled={connectionState !== 'ready' || isAiResponding || isVoiceSpeaking || isSubmittingAnswer || isFinalizing || !answerBoundary.canAcceptAnswer}
                className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
              >
                {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                {isListening ? 'Stop Recording' : answerBoundary.canAcceptAnswer ? 'Speak Answer' : 'All Answers Recorded'}
              </button>
            </div>
            {sessionMode === 'offline' && (
              <div className="mx-auto mt-4 flex max-w-2xl gap-2">
                <textarea value={reply} onChange={event => setReply(event.target.value)} disabled={isListening || isSubmittingAnswer || !answerBoundary.canAcceptAnswer} placeholder={answerBoundary.canAcceptAnswer ? 'Or type your answer while offline.' : 'All five answers are recorded.'} className="min-h-20 flex-1 resize-y rounded-lg border border-line bg-background p-3 text-sm text-ink outline-none disabled:cursor-not-allowed disabled:opacity-60" />
                <button type="button" onClick={() => void sendReply()} disabled={!reply.trim() || isListening || isSubmittingAnswer || !answerBoundary.canAcceptAnswer} className="program-accent-button self-end rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-50">Submit</button>
              </div>
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
              disabled={completing || (sessionMode === 'offline'
                ? messages.filter(message => message.sender === 'user').length < 5
                : !messages.some(message => message.sender === 'user'))}
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
              disabled={connectionState !== 'ready' || isAiResponding || isVoiceSpeaking || isSubmittingAnswer || isFinalizing || !answerBoundary.canAcceptAnswer}
              className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
            >
              {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
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
