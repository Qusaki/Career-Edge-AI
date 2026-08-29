import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Dumbbell, LoaderCircle, Mic, MicOff, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { SoundWaveInterviewer } from './SoundWaveInterviewer';
import { CameraTrackingNotice } from './CameraTrackingNotice';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME } from '../utils/speech';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';
import type { OfflineActivityBridgeProps } from '../offline/sessionFoundation';
import { createClientSessionId } from '../offline/sessionFoundation';
import { combineEyeContactSummaries, type EyeContactSummary } from '../offline/eyeContact';
import { evaluateDrill, getOfflineNegotiationTurn } from '../offline/localEvaluation';
import { DRILLS_VERSION, getOfflineDrillPrompt, hasCurrentQuestionPack, NEGOTIATION_OPENING_PROMPT } from '../offline/questionPacks';
import { normalizeApiError } from '../utils/httpError';

type DrillSession = {
  id: number | string;
  drill_level: string;
  drill_type: string;
  start_time: string;
  end_time?: string | null;
  status: string;
  score?: number | null;
  passed?: boolean | null;
  feedback_summary?: string | null;
  score_eye_contact?: number | null;
  eye_contact_samples?: number | null;
  canonical_prompt?: Record<string, string | number | string[]> | null;
  evaluation_data?: string | null;
};

type Drill = {
  title: string;
  description: string;
  drillLevel: string;
  drillType: string;
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
  },
  {
    title: 'Fast Word Response',
    description: 'Practice quick, confident answers from a single cue word.',
    drillLevel: 'easy',
    drillType: 'fast_word',
  },
  {
    title: 'Emotion Delivery',
    description: 'Improve tone control by saying a sentence with a target emotion.',
    drillLevel: 'medium',
    drillType: 'emotion',
  },
  {
    title: 'Synonym Sprint',
    description: 'Quickly give alternatives for a word to widen your vocabulary.',
    drillLevel: 'medium',
    drillType: 'synonym',
  },
  {
    title: 'Fake Profile Pitch',
    description: 'Create a short introduction from a generated profile.',
    drillLevel: 'medium',
    drillType: 'fake_profile',
  },
  {
    title: 'Emoji Story',
    description: 'Turn random emojis into a coherent spoken story.',
    drillLevel: 'medium',
    drillType: 'emoji_story',
  },
  {
    title: 'Taboo Explainer',
    description: 'Explain a topic clearly without using the banned words.',
    drillLevel: 'hard',
    drillType: 'taboo',
  },
  {
    title: 'Elevator Pitch',
    description: 'Practice a persuasive answer under pressure.',
    drillLevel: 'hard',
    drillType: 'elevator_pitch',
  },
  {
    title: 'Plain-Language Rephrase',
    description: 'Rewrite complex language into something clear and professional.',
    drillLevel: 'hard',
    drillType: 'rephrase',
  },
  {
    title: 'Positive Framing',
    description: 'Turn tense feedback into calm, professional language.',
    drillLevel: 'medium',
    drillType: 'positive_framing',
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
  },
];

const formatPrompt = (prompt: Record<string, unknown>) => {
  return Object.entries(prompt).map(([key, value]) => {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    const formattedValue = Array.isArray(value) ? value.join(', ') : String(value);
    return `${label}: ${formattedValue}`;
  }).join('\n');
};

type DrillsPageProps = OfflineActivityBridgeProps & {
  apiUrl: string;
  onSessionModeChange?: (isSessionMode: boolean) => void;
};

export function DrillsPage({
  apiUrl,
  onSessionModeChange = () => {},
  effectiveOnline,
  sessionMode,
  resumeSession,
  onActivityStart,
  onActivityCheckpoint,
  onActivityEnd,
  onOfflineAudioCaptured,
}: DrillsPageProps) {
  const [sessions, setSessions] = useState<DrillSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [completing, setCompleting] = useState<number | string | null>(null);
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
  const exerciseGenerationRef = useRef(0);
  const resumedSessionRef = useRef<string | null>(null);
  const sessionModeRef = useRef(sessionMode);
  const offlineEyeContactBaselineRef = useRef<EyeContactSummary | null>(null);
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
    const isNegotiation = activeSession.drill_type === 'negotiation';
    const answerIndex = isNegotiation
      ? negotiationMessages.filter(message => message.sender === 'user').length + 1
      : 1;
    void enableOfflineRecording({
      enabled: true,
      activityType: 'drill',
      turnId: isNegotiation ? `negotiation-${answerIndex}` : 'drill-response-1',
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    });
  }, [activeSession, enableOfflineRecording, isListening, negotiationMessages, onOfflineAudioCaptured, sessionMode]);

  useEffect(() => { sessionModeRef.current = sessionMode; }, [sessionMode]);

  useEffect(() => {
    if (!resumeSession || resumeSession.type !== 'drill' || resumedSessionRef.current === resumeSession.clientSessionId) return;
    resumedSessionRef.current = resumeSession.clientSessionId;
    if (!hasCurrentQuestionPack('drill', resumeSession.questionPackVersion)) {
      setError('This saved offline activity uses an older question version. It was preserved and cannot be resumed automatically.');
      return;
    }
    const drillType = String(resumeSession.activityState.drillType || '');
    const drill = drills.find(item => item.drillType === drillType);
    if (!drill) {
      setError('The saved Drill type is not available in the current offline question pack.');
      return;
    }
    const restoredNegotiationMessages = resumeSession.conversationLog.map(message => ({
      sender: message.sender === 'ai' ? 'bot' as const : 'user' as const,
      text: message.text,
    }));
    offlineEyeContactBaselineRef.current = resumeSession.eyeContactSummary
      ? { ...resumeSession.eyeContactSummary }
      : null;
    setActiveSession({
      id: resumeSession.clientSessionId,
      drill_level: drill.drillLevel,
      drill_type: drill.drillType,
      start_time: new Date(resumeSession.startedAt).toISOString(),
      status: 'active',
    });
    setActivePrompt(String(resumeSession.activityState.prompt || resumeSession.currentQuestion));
    setSpokenResponse(String(resumeSession.activityState.spokenResponse || resumeSession.answers[0]?.text || ''));
    setNegotiationMessages(drill.isNegotiation ? restoredNegotiationMessages : []);
    setNegotiationTurn(Number(resumeSession.activityState.negotiationTurn || 0));
    setCurrentOffer(Number(resumeSession.activityState.currentOffer || 35000));
    setNegotiationGameOver(Boolean(resumeSession.activityState.negotiationGameOver));
    setNotice('Your saved offline Drill has been restored from its last checkpoint.');
    onSessionModeChange(true);
  }, [onSessionModeChange, resumeSession]);

  useEffect(() => {
    if (sessionMode === 'offline' && activeSession) {
      setNegotiationLoading(false);
      setNotice('This Drill remains offline until completion. Local prompts, checkpoints, and provisional scoring are active.');
    }
  }, [activeSession, sessionMode]);

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
  }, [apiUrl, effectiveOnline]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => () => {
    exerciseGenerationRef.current += 1;
    cancelListening();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [cancelListening]);

  const startDrill = async (drill: Drill) => {
    const attemptId = exerciseGenerationRef.current + 1;
    exerciseGenerationRef.current = attemptId;
    setStarting(drill.drillType);
    setError(null);
    setNotice(null);
    setSpokenResponse('');
    setNegotiationMessages([]);
    setNegotiationReply('');
    setNegotiationTurn(0);
    setCurrentOffer(35000);
    setNegotiationGameOver(false);
    offlineEyeContactBaselineRef.current = null;
    cancelListening();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try {
      if (!effectiveOnline) {
        const clientSessionId = createClientSessionId();
        const prompt = getOfflineDrillPrompt(drill.drillType, clientSessionId);
        const formattedPrompt = formatPrompt(prompt);
        const openingOffer = NEGOTIATION_OPENING_PROMPT;
        const initialNegotiationMessages: NegotiationMessage[] = drill.isNegotiation
          ? [{ sender: 'bot', text: openingOffer }]
          : [];
        const checkpoint = await onActivityStart({
          type: 'drill',
          mode: 'offline',
          clientSessionId,
          questionPackVersion: DRILLS_VERSION,
          currentQuestion: drill.isNegotiation ? openingOffer : formattedPrompt,
          conversationLog: initialNegotiationMessages.map(message => ({ sender: 'ai' as const, text: message.text })),
          currentStep: 0,
          activityState: {
            drillType: drill.drillType,
            drillLevel: drill.drillLevel,
            prompt: formattedPrompt,
            spokenResponse: '',
            negotiationTurn: 0,
            currentOffer: 35000,
            negotiationGameOver: false,
          },
        });
        if (!checkpoint || exerciseGenerationRef.current !== attemptId) return;
        setActiveSession({
          id: checkpoint.clientSessionId,
          drill_level: drill.drillLevel,
          drill_type: drill.drillType,
          start_time: new Date(checkpoint.startedAt).toISOString(),
          status: 'active',
        });
        setActivePrompt(formattedPrompt);
        setNegotiationMessages(initialNegotiationMessages);
        setNotice(`${drill.title} started offline. Your provisional result will be queued for sync.`);
        onSessionModeChange(true);
        speakText(drill.isNegotiation ? openingOffer : formattedPrompt);
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) return;
      const sessionResponse = await fetch(`${apiUrl}/drills/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          drill_level: drill.drillLevel,
          drill_type: drill.drillType,
        }),
      });
      if (exerciseGenerationRef.current !== attemptId) return;
      if (!sessionResponse.ok) {
        const body = await sessionResponse.json().catch(() => null);
        throw new Error(normalizeApiError(body, `Unable to start ${drill.title}.`));
      }

      const session: DrillSession = await sessionResponse.json();
      if (exerciseGenerationRef.current !== attemptId) return;
      if (!session.canonical_prompt) {
        throw new Error(`The server did not return a canonical prompt for ${drill.title}.`);
      }
      const formattedPrompt = formatPrompt(session.canonical_prompt);
      setActiveSession(session);
      setActivePrompt(formattedPrompt);
      if (drill.isNegotiation) {
        const openingOffer = NEGOTIATION_OPENING_PROMPT;
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
      setNotice(`${drill.title} is ready.`);
      void onActivityStart({
        type: 'drill',
        serverSessionId: typeof session.id === 'number' ? session.id : null,
        questionPackVersion: DRILLS_VERSION,
        currentQuestion: drill.isNegotiation ? NEGOTIATION_OPENING_PROMPT : formattedPrompt,
        conversationLog: drill.isNegotiation ? [{ sender: 'ai', text: NEGOTIATION_OPENING_PROMPT }] : [],
        currentStep: 0,
        activityState: {
          drillType: drill.drillType,
          drillLevel: drill.drillLevel,
          prompt: formattedPrompt,
          spokenResponse: '',
          negotiationTurn: 0,
          currentOffer: 35000,
          negotiationGameOver: false,
        },
      });
      onSessionModeChange(true);
      await loadSessions();
    } catch (err) {
      if (exerciseGenerationRef.current !== attemptId) return;
      setError(err instanceof Error ? err.message : `Unable to start ${drill.title}.`);
    } finally {
      if (exerciseGenerationRef.current === attemptId) setStarting(null);
    }
  };

  const quitDrill = () => {
    exerciseGenerationRef.current += 1;
    cancelListening();
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setStarting(null);
    setCompleting(null);
    setActiveSession(null);
    setActivePrompt('');
    setSpokenResponse('');
    setNegotiationMessages([]);
    setNegotiationReply('');
    setNegotiationTurn(0);
    setCurrentOffer(35000);
    setNegotiationGameOver(false);
    setIsVoiceSpeaking(false);
    offlineEyeContactBaselineRef.current = null;
    setNotice('Drill exited. Mark it complete later to finish it properly.');
    void onActivityEnd('abandoned');
    onSessionModeChange(false);
  };

  const sendNegotiationReply = async (spokenText = negotiationReply) => {
    const text = spokenText.trim();
    if (!text || negotiationLoading || negotiationGameOver) return;

    setNegotiationLoading(true);
    setError(null);
    const userMessages = [...negotiationMessages, { sender: 'user' as const, text }];
    const userCheckpointSaved = await onActivityCheckpoint({
      conversationLog: userMessages.map(message => ({
        sender: message.sender === 'bot' ? 'ai' as const : 'user' as const,
        text: message.text,
      })),
      responseCount: userMessages.filter(message => message.sender === 'user').length,
      currentStep: negotiationTurn + 1,
      answers: userMessages
        .filter(message => message.sender === 'user')
        .map((message, index) => ({ step: index + 1, text: message.text, createdAt: Date.now() })),
      eyeContactSummary: getCheckpointEyeContactSummary(),
      activityState: {
        drillType: activeSession?.drill_type,
        drillLevel: activeSession?.drill_level,
        prompt: activePrompt,
        spokenResponse,
        negotiationTurn,
        currentOffer,
        negotiationGameOver,
      },
    });
    if (!userCheckpointSaved) {
      setNegotiationLoading(false);
      return;
    }
    resetSpeechTranscript();
    setNegotiationReply('');
    setNegotiationMessages(userMessages);

    try {
      let data: { response: string; new_offer: number; is_game_over: boolean };
      if (sessionModeRef.current === 'offline') {
        const localTurn = getOfflineNegotiationTurn(text, negotiationTurn, currentOffer);
        data = {
          response: localTurn.response,
          new_offer: localTurn.newOffer,
          is_game_over: localTurn.isGameOver,
        };
      } else {
        const response = await fetch(`${apiUrl}/drills/hard/negotiation/turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_message: text, turn_number: negotiationTurn, current_offer: currentOffer }),
        });
        if (!response.ok) throw new Error('Unable to process negotiation turn.');
        data = await response.json();
        if (String(sessionModeRef.current) === 'offline') {
          const localTurn = getOfflineNegotiationTurn(text, negotiationTurn, currentOffer);
          data = {
            response: localTurn.response,
            new_offer: localTurn.newOffer,
            is_game_over: localTurn.isGameOver,
          };
        }
      }
      const nextTurn = negotiationTurn + 1;
      const nextMessages = [...userMessages, { sender: 'bot' as const, text: data.response }];
      const responseSaved = await onActivityCheckpoint({
        conversationLog: nextMessages.map(message => ({
          sender: message.sender === 'bot' ? 'ai' as const : 'user' as const,
          text: message.text,
        })),
        currentQuestion: data.response,
        responseCount: nextMessages.filter(message => message.sender === 'user').length,
        currentStep: nextTurn,
        eyeContactSummary: getCheckpointEyeContactSummary(),
        activityState: {
          drillType: activeSession?.drill_type,
          drillLevel: activeSession?.drill_level,
          prompt: activePrompt,
          spokenResponse,
          negotiationTurn: nextTurn,
          currentOffer: data.new_offer,
          negotiationGameOver: data.is_game_over,
        },
      });
      if (!responseSaved) return;
      setCurrentOffer(data.new_offer);
      setNegotiationTurn(nextTurn);
      setNegotiationGameOver(data.is_game_over);
      setNegotiationMessages(nextMessages);
      speakText(data.response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process negotiation turn.');
    } finally {
      setNegotiationLoading(false);
    }
  };

  const recordDrillResponse = () => {
    if (isVoiceSpeaking || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setError('Wait for the audio prompt to finish before starting the microphone.');
      return;
    }
    setError(null);
    startListening(async transcript => {
        const nextResponse = [spokenResponse, transcript].filter(Boolean).join(' ').trim();
        const saved = await onActivityCheckpoint({
          currentQuestion: activePrompt,
          currentStep: 1,
          responseCount: nextResponse ? 1 : 0,
          answers: nextResponse ? [{ step: 1, text: nextResponse, createdAt: Date.now() }] : [],
          eyeContactSummary: getCheckpointEyeContactSummary(),
          activityState: {
            drillType: activeSession?.drill_type,
            drillLevel: activeSession?.drill_level,
            prompt: activePrompt,
            spokenResponse: nextResponse,
            negotiationTurn,
            currentOffer,
            negotiationGameOver,
          },
        });
        if (saved) {
          setSpokenResponse(nextResponse);
          resetSpeechTranscript();
        }
    }, setError, sessionMode === 'offline' && activeSession ? {
      enabled: true,
      activityType: 'drill',
      turnId: 'drill-response-1',
      answerIndex: 1,
      persistAudio: onOfflineAudioCaptured,
    } : undefined);
  };

  const recordNegotiationReply = () => {
    if (isVoiceSpeaking || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setError('Wait for the employer audio to finish before starting the microphone.');
      return;
    }
    setError(null);
    const answerIndex = negotiationMessages.filter(message => message.sender === 'user').length + 1;
    startListening(transcript => void sendNegotiationReply(transcript), setError, sessionMode === 'offline' && activeSession ? {
      enabled: true,
      activityType: 'drill',
      turnId: `negotiation-${answerIndex}`,
      answerIndex,
      persistAudio: onOfflineAudioCaptured,
    } : undefined);
  };

  const saveTypedDrillResponse = async () => {
    const text = spokenResponse.trim();
    if (!text) return;
    await onActivityCheckpoint({
      currentQuestion: activePrompt,
      currentStep: 1,
      responseCount: 1,
      answers: [{ step: 1, text, createdAt: Date.now() }],
      eyeContactSummary: getCheckpointEyeContactSummary(),
      activityState: {
        drillType: activeSession?.drill_type,
        drillLevel: activeSession?.drill_level,
        prompt: activePrompt,
        spokenResponse: text,
        negotiationTurn,
        currentOffer,
        negotiationGameOver,
      },
    });
  };

  const completeDrill = async () => {
    if (!activeSession) return;
    if (sessionMode === 'offline') {
      setCompleting(activeSession.id);
      setError(null);
      try {
        const result = evaluateDrill(activeSession.drill_type, { spokenResponse, negotiationMessages });
        const rawAnswers = activeSession.drill_type === 'negotiation'
          ? negotiationMessages.filter(message => message.sender === 'user').map((message, index) => ({ step: index + 1, text: message.text, createdAt: Date.now() }))
          : [{ step: 1, text: spokenResponse.trim(), createdAt: Date.now() }];
        const saved = await onActivityCheckpoint({
          conversationLog: activeSession.drill_type === 'negotiation'
            ? negotiationMessages.map(message => ({ sender: message.sender === 'bot' ? 'ai' as const : 'user' as const, text: message.text }))
            : [],
          answers: rawAnswers,
          responseCount: rawAnswers.length,
          currentStep: rawAnswers.length,
          localEvaluation: result.evaluation,
          localScore: result.localScore,
          evaluationAuthority: 'local_provisional',
          pendingEvaluation: null,
          eyeContactSummary: getCheckpointEyeContactSummary(),
          activityState: {
            drillType: activeSession.drill_type,
            drillLevel: activeSession.drill_level,
            prompt: activePrompt,
            spokenResponse,
            negotiationTurn,
            currentOffer,
            negotiationGameOver,
          },
        });
        if (!saved || !await onActivityEnd('completed_local')) return;
        cancelListening();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setActiveSession(null);
        setActivePrompt('');
        setSpokenResponse('');
        setNegotiationMessages([]);
        setNegotiationReply('');
        setNegotiationTurn(0);
        setCurrentOffer(35000);
        setNegotiationGameOver(false);
        offlineEyeContactBaselineRef.current = null;
        setNotice('Drill completed locally and is pending sync.');
        onSessionModeChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to calculate the provisional Drill score.');
      } finally {
        setCompleting(null);
      }
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    const attemptId = exerciseGenerationRef.current;
    setCompleting(activeSession.id);
    setError(null);
    setNotice(null);
    try {
      const eyeContactSummary = getCheckpointEyeContactSummary();
      const response = await fetch(`${apiUrl}/drills/${activeSession.id}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eye_contact_score: eyeContactSummary.samples > 0 ? eyeContactSummary.score : null,
          eye_contact_samples: eyeContactSummary.samples,
          evaluation_data: {
            spoken_response: spokenResponse || undefined,
            negotiation_messages: negotiationMessages.length > 0 ? negotiationMessages : undefined,
            current_offer: negotiationMessages.length > 0 ? currentOffer : undefined,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(normalizeApiError(body, 'Unable to complete the drill session.'));
      }
      await response.json();
      if (exerciseGenerationRef.current !== attemptId) return;
      cancelListening();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setNotice('Drill was marked complete.');
      void onActivityEnd('cloud_completed');
      setActiveSession(null);
      setActivePrompt('');
      setSpokenResponse('');
      setNegotiationMessages([]);
      setNegotiationReply('');
      setNegotiationTurn(0);
      setCurrentOffer(35000);
      setNegotiationGameOver(false);
      offlineEyeContactBaselineRef.current = null;
      onSessionModeChange(false);
      await loadSessions();
    } catch (err) {
      if (exerciseGenerationRef.current !== attemptId) return;
      setError(err instanceof Error ? err.message : 'Unable to complete the drill session.');
    } finally {
      if (exerciseGenerationRef.current === attemptId) setCompleting(null);
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
              className="program-accent-button flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completing === activeSession.id ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {completing === activeSession.id ? 'Completing…' : 'Mark Complete'}
            </button>
          </div>

          <section className="flex-1 rounded-lg border border-line bg-card p-5">
            <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <div className="program-accent-surface mb-3 flex h-11 w-11 items-center justify-center rounded-lg">
                  <Sparkles className="h-6 w-6" />
                </div>
                <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Drill Session</p>
                <h1 className="text-3xl font-bold tracking-tight text-ink">Current Drill</h1>
                <p className="text-program-accent mt-1 text-sm font-bold uppercase tracking-wider">
                  {activeSession.drill_level} · {activeSession.drill_type.replace(/_/g, ' ')}
                </p>
              </div>
              <CameraTrackingNotice {...eyeTracker} />
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
                  <p className="text-program-accent mb-2 font-bold">Scenario</p>
                  <p className="whitespace-pre-wrap">{activePrompt || 'Prompt loaded.'}</p>
                </div>

                <div className="h-[44vh] overflow-y-auto rounded-lg border border-line bg-background p-4">
                  {negotiationMessages.map((message, index) => (
                    <div key={index} className={`mb-3 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'program-accent-fill' : 'border border-line bg-card text-ink'}`}>
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

                {(isListening || isFinalizing || hasUnfinalizedTranscript) && (
                  <div className="mt-3 rounded-lg border border-line bg-card p-3 text-sm leading-relaxed text-ink" aria-live="polite">
                    <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-wider">
                      {isFinalizing ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                    </p>
                    {liveTranscript || <span className="text-muted">Start speaking when you are ready.</span>}
                  </div>
                )}

                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordNegotiationReply}
                    disabled={negotiationLoading || negotiationGameOver || isVoiceSpeaking || isFinalizing}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                  >
                    {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : negotiationGameOver ? 'Negotiation Ended' : 'Speak Reply'}
                  </button>
                </div>
                {sessionMode === 'offline' && !negotiationGameOver && (
                  <div className="mx-auto mt-4 flex max-w-2xl gap-2">
                    <textarea value={negotiationReply} onChange={event => setNegotiationReply(event.target.value)} placeholder="Or type your negotiation reply while offline." className="min-h-20 flex-1 resize-y rounded-lg border border-line bg-background p-3 text-sm text-ink outline-none" />
                    <button type="button" onClick={() => void sendNegotiationReply()} disabled={!negotiationReply.trim() || negotiationLoading} className="program-accent-button self-end rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-50">Submit</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <pre className="whitespace-pre-wrap rounded-lg border border-line bg-background p-4 font-sans text-base leading-relaxed text-ink">
                  {activePrompt || 'Prompt loaded.'}
                </pre>
                <div className="mt-4 min-h-[28vh] rounded-lg border border-line bg-background p-4 text-sm leading-relaxed text-ink">
                  <p className="text-program-accent mb-2 font-bold">Your spoken response</p>
                  {spokenResponse || <span className="text-muted">Press the mic and answer the drill out loud.</span>}
                </div>
                {(isListening || isFinalizing || hasUnfinalizedTranscript) && (
                  <div className="mt-3 rounded-lg border border-line bg-card p-3 text-sm leading-relaxed text-ink" aria-live="polite">
                    <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-wider">
                      {isFinalizing ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                    </p>
                    {liveTranscript || <span className="text-muted">Start speaking when you are ready.</span>}
                  </div>
                )}
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={isListening ? stopListening : recordDrillResponse}
                    disabled={isVoiceSpeaking || isFinalizing}
                    className={`flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors ${isListening ? 'bg-rose-600 text-white hover:bg-rose-500' : 'program-accent-button'}`}
                  >
                    {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    {isListening ? 'Stop Recording' : 'Speak Answer'}
                  </button>
                </div>
                {sessionMode === 'offline' && (
                  <div className="mx-auto mt-4 flex max-w-2xl gap-2">
                    <textarea value={spokenResponse} onChange={event => setSpokenResponse(event.target.value)} placeholder="Or type your Drill response while offline." className="min-h-20 flex-1 resize-y rounded-lg border border-line bg-background p-3 text-sm text-ink outline-none" />
                    <button type="button" onClick={() => void saveTypedDrillResponse()} disabled={!spokenResponse.trim()} className="program-accent-button self-end rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-50">Save</button>
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
        <p className="text-program-accent mb-2 text-xs font-bold uppercase tracking-[0.2em]">Practice</p>
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

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {drills.map(drill => (
          <article key={drill.drillType} className="flex flex-col justify-between rounded-lg border border-line bg-card p-5">
            <div>
              <div className="program-accent-surface mb-4 flex h-11 w-11 items-center justify-center rounded-lg">
                <Dumbbell className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-ink">{drill.title}</h2>
              <p className="mt-2 leading-relaxed text-muted">{drill.description}</p>
              <p className="text-program-accent mt-3 text-xs font-bold uppercase tracking-wider">{drill.drillLevel}</p>
            </div>
            <button
              onClick={() => startDrill(drill)}
              disabled={starting !== null || completing !== null}
              className="program-accent-button mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
          <button onClick={loadSessions} className="program-accent-link flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
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
                <span className="program-accent-surface rounded-full px-2.5 py-1 text-xs font-bold capitalize">{session.status}</span>
                {session.score != null && <p className="mt-1 text-sm font-bold text-ink">{Math.round(session.score)}%</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
