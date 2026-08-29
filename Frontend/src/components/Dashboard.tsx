import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, useEnvironment } from '@react-three/drei';
import { clearProfessorModelCache, ProfessorModel, ProfessorModelPreloader } from './ProfessorModel';
import { PreTestPage } from './PreTestPage';
import { DrillsPage } from './DrillsPage';
import { PostTestPage } from './PostTestPage';
import { useWebLLM } from '../hooks/useWebLLM';
import { useSpeechInput } from '../hooks/useSpeechInput';
import type { MLCEngine } from '@mlc-ai/web-llm';
import { useConnectivity } from '../hooks/useConnectivity';
import {
  retryOfflineSessionManually,
  syncOfflineQueueWithRetry,
} from '../offline/offlineSyncClient';
import { maintainOwnedOfflineStorage } from '../offline/offlineCleanup';
import { getVerifiedAccountForToken, rememberVerifiedAccount } from '../offline/accountBinding';
import { getQuestionPackVersion, hasCurrentQuestionPack } from '../offline/questionPacks';
import {
  appendOfflineInterviewAnswer,
  createOfflineInterviewActivityState,
  evaluateOfflineInterview,
  generateWebLLMProfessorTurn,
  getFallbackProfessorTurn,
  OFFLINE_INTERVIEW_RESPONSE_LIMIT,
  readOfflineInterviewActivityState,
  transitionOfflineInterviewToFallback,
  type OfflineInterviewActivityState,
  type OfflineInterviewEngine,
  type OfflineInterviewKind,
} from '../offline/interviewRuntime';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';
import {
  accountStorage,
  type AccountOfflineSession,
  type OfflineActivityType,
} from '../db';
import {
  hasStorageCapacity,
  OFFLINE_AUDIO_STORAGE_HEADROOM_BYTES,
  toOfflineAudioRecord,
} from '../offline/offlineAudioRecorder';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
  mergeActivityCheckpoint,
  type ActivityCheckpointUpdate,
  type OfflineAudioCheckpointInput,
  type ActivitySessionEnd,
  type ActivitySessionStart,
} from '../offline/sessionFoundation';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME, getClearSpeechTimeoutMs } from '../utils/speech';
import { API_URL } from '../config/api';
import { getProgramAccentTheme } from '../config/programTheme';
import {
  buildActivityComparison,
  getCommunicationSkillScore,
  getNormalizedActivityScore,
  isCompletedActivity,
} from '../utils/analytics';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
import {
  LayoutDashboard,
  Video,
  BarChart2,
  Settings,
  Plus,
  Bell,
  Search,
  User,
  LogOut,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Mic,
  MicOff,
  Send,
  PlusCircle,
  Paperclip,
  GraduationCap,
  Briefcase,
  Cloud,
  Folder,
  Lock,
  FileText,
  Upload,
  Clock,
  Shield,
  Eye,
  EyeOff,
  Camera,
  CameraOff,
  BookOpen,
  ClipboardCheck,
  Sun,
  Moon,
  CircleHelp
} from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
  isNewSignupSession: boolean;
}

interface AuthenticatedUserResponse {
  id: number;
  email?: string | null;
  firstname?: string | null;
  middlename?: string | null;
  lastname?: string | null;
  department?: string | null;
  profile_picture_url?: string | null;
}

interface ProfileAvatarProps {
  name: string;
  imageUrl?: string | null;
  className: string;
  initialClassName: string;
}

type AppTheme = 'light' | 'dark';
type ProfessorAssetStatus = 'loading' | 'ready' | 'error';

interface ProfessorAssetWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface LocalWebLLMOptions {
  enrollmentFinalTurn?: boolean;
}

type OnlineInterviewMode = 'enrollment' | 'thesis';

interface OnlineInterviewHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const APP_THEME_STORAGE_KEY = 'career-edge-theme';
const DEFAULT_AVATAR_HOST = 'api.dicebear.com';
const ENROLLMENT_FINAL_RESPONSE_TIMEOUT_MS = 60_000;
const ENROLLMENT_FINAL_RESPONSE_FALLBACK = 'Thank you for completing your Career Edge interview. Your five responses have been recorded, and you can now continue to validation.';
const ENROLLMENT_FINAL_TURN_INSTRUCTION = 'The student has just submitted their fifth and final answer. Do not ask another question or request another response. Give one brief, supportive, non-empty closing statement that acknowledges the interview is complete and tells the student they can continue to validation. Keep it concise for speech.';

const getWebSocketUrl = (apiUrl: string, path: string, token: string) => {
  const url = new URL(path, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
};

class EnrollmentFinalResponseTimeoutError extends Error {
  constructor() {
    super('Enrollment final response generation timed out.');
    this.name = 'EnrollmentFinalResponseTimeoutError';
  }
}

const isUsableEnrollmentClosingResponse = (text: string) => {
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.includes('?')) return false;

  return !/(?:^|[.!]\s+)(?:please\s+)?(?:tell|describe|explain|share|discuss)\b/i.test(normalizedText);
};

const getCustomProfileImageUrl = (imageUrl?: string | null) => {
  const normalizedImageUrl = imageUrl?.trim() || '';
  return normalizedImageUrl.includes(DEFAULT_AVATAR_HOST) ? '' : normalizedImageUrl;
};

const getProfileAvatarInitial = (name?: string | null) => {
  const firstName = name?.trim().split(/\s+/).find(Boolean) || '';
  return Array.from(firstName)[0]?.toLocaleUpperCase() || 'U';
};

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ name, imageUrl, className, initialClassName }) => {
  const customImageUrl = getCustomProfileImageUrl(imageUrl);
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [customImageUrl]);

  return (
    <div className={`program-accent-surface ${className}`}>
      {customImageUrl && !hasImageError ? (
        <img
          src={customImageUrl}
          alt={`${name.trim() || 'User'} profile`}
          className="h-full w-full object-cover"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <span
          role="img"
          aria-label={`${name.trim() || 'User'} avatar`}
          className={`flex h-full w-full items-center justify-center font-bold uppercase leading-none ${initialClassName}`}
        >
          {getProfileAvatarInitial(name)}
        </span>
      )}
    </div>
  );
};

interface ProfessorAssetErrorBoundaryProps {
  children: React.ReactNode;
  onError: (error: Error) => void;
}

interface ProfessorAssetErrorBoundaryState {
  hasError: boolean;
}

class ProfessorAssetErrorBoundary extends React.Component<
  ProfessorAssetErrorBoundaryProps,
  ProfessorAssetErrorBoundaryState
> {
  state: ProfessorAssetErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ProfessorAssetErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout, isNewSignupSession }) => {
  const connectivity = useConnectivity(API_URL);
  const connectivityOnlineRef = React.useRef(connectivity.effectiveOnline);
  connectivityOnlineRef.current = connectivity.effectiveOnline;
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pre-test' | 'drills' | 'post-test' | 'history' | 'analytics' | 'profile' | 'settings' | 'support' | 'privacy' | 'interview-type' | 'university-setup' | 'new-interview' | 'interview-session' | 'interview-result' | 'thesis-setup' | 'thesis-session'>(() => {
    if (window.location.pathname === '/pre-test') return 'pre-test';
    if (window.location.pathname === '/drills') return 'drills';
    if (window.location.pathname === '/post-test') return 'post-test';
    if (window.location.pathname === '/settings') return 'settings';
    if (window.location.pathname === '/support') return 'support';
    if (window.location.pathname === '/privacy') return 'privacy';
    if (window.location.pathname === '/profile') return 'profile';
    return 'dashboard';
  });
  const {
    engine: webLLMEngine,
    isLoading: isLlmLoading,
    status: llmStatus,
    error: llmError,
    isReady: isLlmReady,
    hasError: hasLlmError,
    initializeCached: initializeCachedWebLLM,
    release: releaseWebLLM,
  } = useWebLLM('Llama-3.2-1B-Instruct-q4f16_1-MLC', false);
  const [isModuleSessionMode, setIsModuleSessionMode] = useState(false);
  const [prevTab, setPrevTab] = useState<string>('dashboard');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    const savedTheme = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return savedTheme === 'dark' ? 'dark' : 'light';
  });
  const accountMenuRef = React.useRef<HTMLDivElement>(null);
  const accountTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [selectedCompanyType, setSelectedCompanyType] = useState('');
  const [position, setPosition] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const sessionIdRef = React.useRef<number | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const [isStartingInterview, setIsStartingInterview] = useState(false);
  const [professorAssetStatus, setProfessorAssetStatus] = useState<ProfessorAssetStatus>('loading');
  const professorAssetStatusRef = React.useRef<ProfessorAssetStatus>('loading');
  const professorAssetWaitersRef = React.useRef<ProfessorAssetWaiter[]>([]);
  const [professorAssetLoadAttempt, setProfessorAssetLoadAttempt] = useState(0);
  const [isProfessorFirstFrameReady, setIsProfessorFirstFrameReady] = useState(false);
  const [isFinishingInterview, setIsFinishingInterview] = useState(false);
  const [showProfilePass, setShowProfilePass] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewResult, setInterviewResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [communicationHistory, setCommunicationHistory] = useState<any[]>([]);
  const [authenticatedUserId, setAuthenticatedUserId] = useState<number | null>(null);
  const authenticatedUserIdRef = React.useRef<number | null>(null);
  const [activeActivityCheckpoint, setActiveActivityCheckpoint] = useState<AccountOfflineSession | null>(null);
  const activeActivityCheckpointRef = React.useRef<AccountOfflineSession | null>(null);
  const [showConnectionLossPrompt, setShowConnectionLossPrompt] = useState(false);
  const [offlineFoundationError, setOfflineFoundationError] = useState<string | null>(null);
  const [connectionRestoredNotice, setConnectionRestoredNotice] = useState(false);
  const [resumableOfflineSession, setResumableOfflineSession] = useState<AccountOfflineSession | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncQueueSessions, setSyncQueueSessions] = useState<AccountOfflineSession[]>([]);
  const [lastSyncNotice, setLastSyncNotice] = useState<string | null>(null);
  const checkpointOperationRef = React.useRef<Promise<void>>(Promise.resolve());
  const restoredEyeContactSummaryRef = React.useRef<{ score: number | null; samples: number } | null>(null);
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    password: '',
    department: '',
    profilePicture: ''
  });
  const programAccentTheme = getProgramAccentTheme(profile.department);
  const programAccentStyle = {
    '--program-accent': programAccentTheme.primary,
    '--program-accent-hover': programAccentTheme.hover,
    '--program-accent-active': programAccentTheme.active,
    '--program-accent-subtle': programAccentTheme.subtle,
    '--program-accent-foreground': programAccentTheme.foreground,
    '--program-accent-text': programAccentTheme.text,
    '--program-accent-on-dark': programAccentTheme.onDark,
    '--program-accent-dark-surface': programAccentTheme.darkSurface,
    '--program-accent-dark-interactive': programAccentTheme.darkInteractive,
    '--program-accent-dark-interactive-foreground': programAccentTheme.darkInteractiveForeground,
  } as React.CSSProperties;

  useEffect(() => {
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
  }, [appTheme]);

  useEffect(() => () => {
    authenticatedUserIdRef.current = null;
  }, []);

  const handleProfessorAssetReady = React.useCallback(() => {
    professorAssetStatusRef.current = 'ready';
    setProfessorAssetStatus('ready');
    professorAssetWaitersRef.current.splice(0).forEach(({ resolve }) => resolve());
  }, []);

  const handleProfessorAssetError = React.useCallback((error: Error) => {
    console.error('Unable to preload Professor Maxiel.', error);
    professorAssetStatusRef.current = 'error';
    setProfessorAssetStatus('error');
    professorAssetWaitersRef.current.splice(0).forEach(({ reject }) => reject(error));
  }, []);

  const waitForProfessorAsset = React.useCallback(() => {
    if (professorAssetStatusRef.current === 'ready') {
      return Promise.resolve();
    }
    if (professorAssetStatusRef.current === 'error') {
      return Promise.reject(new Error('Professor Maxiel is unavailable.'));
    }
    return new Promise<void>((resolve, reject) => {
      professorAssetWaitersRef.current.push({ resolve, reject });
    });
  }, []);

  const retryProfessorAssetLoad = React.useCallback(() => {
    clearProfessorModelCache();
    professorAssetStatusRef.current = 'loading';
    setProfessorAssetStatus('loading');
    setProfessorAssetLoadAttempt((attempt) => attempt + 1);
  }, []);

  const handleProfessorFirstFrame = React.useCallback(() => {
    setIsProfessorFirstFrameReady(true);
  }, []);

  useEffect(() => {
    useEnvironment.preload({ preset: 'city' });
    return () => {
      const interruption = new Error('Professor asset preparation was interrupted.');
      professorAssetWaitersRef.current.splice(0).forEach(({ reject }) => reject(interruption));
    };
  }, []);

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false);
        accountTriggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  // Thesis Interview State
  const [thesisSessionId, setThesisSessionId] = useState<number | null>(null);
  const thesisSessionIdRef = React.useRef<number | null>(null);
  const thesisWsRef = React.useRef<WebSocket | null>(null);
  const [thesisAbstractFile, setThesisAbstractFile] = useState<File | null>(null);
  const [thesisAbstractUploading, setThesisAbstractUploading] = useState(false);
  const [thesisIsStarting, setThesisIsStarting] = useState(false);
  const [thesisIsFinishing, setThesisIsFinishing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [thesisResult, setThesisResult] = useState<any>(null);
  const [thesisConversationLog, setThesisConversationLog] = useState<{ sender: 'user' | 'ai', text: string }[]>([]);
  const thesisConversationLogRef = React.useRef(thesisConversationLog);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [thesisHistory, setThesisHistory] = useState<any[]>([]);
  const [thesisElapsedSeconds, setThesisElapsedSeconds] = useState(0);
  const thesisTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [thesisIsLeaveModalOpen, setThesisIsLeaveModalOpen] = useState(false);
  const [thesisStartError, setThesisStartError] = useState<string | null>(null);
  const [thesisInSessionUploading, setThesisInSessionUploading] = useState(false);
  const [thesisAbstractUpdated, setThesisAbstractUpdated] = useState(false);
  const activeInterviewModeRef = React.useRef<'enrollment' | 'thesis' | null>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const eyeTracker = useEyeContactTracker(
    isCameraEnabled && (
      (activeTab === 'interview-session' && !interviewResult) ||
      (activeTab === 'thesis-session' && !thesisResult)
    )
  );

  const queueCheckpointOperation = React.useCallback((operation: () => Promise<unknown>) => {
    const queued = checkpointOperationRef.current
      .catch(() => undefined)
      .then(operation)
      .then(() => undefined);
    checkpointOperationRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const persistActivityCheckpoint = React.useCallback(async (checkpoint: AccountOfflineSession) => {
    try {
      await queueCheckpointOperation(() => accountStorage.putOfflineSession(checkpoint));
      setOfflineFoundationError(null);
      return true;
    } catch (error) {
      console.error('Unable to persist the activity checkpoint.', error);
      setOfflineFoundationError(
        'Career Edge could not save this activity locally. Keep this page open and retry before leaving.',
      );
      return false;
    }
  }, [queueCheckpointOperation]);

  const beginActivityCheckpoint = React.useCallback(async (input: ActivitySessionStart) => {
    const userId = authenticatedUserIdRef.current;
    if (!userId) {
      setOfflineFoundationError('A verified account is required before this activity can be saved offline.');
      return null;
    }
    const checkpoint = createActivityCheckpoint(
      userId,
      input,
      input.mode ?? 'online',
      input.clientSessionId,
    );
    activeActivityCheckpointRef.current = checkpoint;
    setActiveActivityCheckpoint(checkpoint);
    const saved = await persistActivityCheckpoint(checkpoint);
    if (!saved) {
      activeActivityCheckpointRef.current = null;
      setActiveActivityCheckpoint(null);
      return null;
    }
    return checkpoint;
  }, [persistActivityCheckpoint]);

  const updateActivityCheckpoint = React.useCallback(async (update: ActivityCheckpointUpdate) => {
    const current = activeActivityCheckpointRef.current;
    if (!current) return false;
    const next = mergeActivityCheckpoint(current, update);
    activeActivityCheckpointRef.current = next;
    setActiveActivityCheckpoint(next);
    return persistActivityCheckpoint(next);
  }, [persistActivityCheckpoint]);

  const persistOfflineAudioCapture = React.useCallback(async (input: OfflineAudioCheckpointInput) => {
    const current = activeActivityCheckpointRef.current;
    if (!current || current.mode !== 'offline' || current.type !== input.activityType) return false;
    if (!await hasStorageCapacity(input.capture.sizeBytes + OFFLINE_AUDIO_STORAGE_HEADROOM_BYTES)) {
      setOfflineFoundationError('Browser storage is too low to save this recording. Your session remains open; use the typed answer or clear local site data.');
      return false;
    }
    const { record, reference } = toOfflineAudioRecord({
      userId: current.userId,
      clientSessionId: current.clientSessionId,
      activityType: current.type,
      turnId: input.turnId,
      answerIndex: input.answerIndex,
    }, input.capture, input.transcriptText);
    try {
      await queueCheckpointOperation(() => accountStorage.putOfflineAudio(record));
      const latest = activeActivityCheckpointRef.current;
      if (!latest || latest.clientSessionId !== current.clientSessionId) return false;
      const withoutReplacedTurn = latest.audioReferences.filter(item => item.turnId !== reference.turnId);
      const next = mergeActivityCheckpoint(latest, {
        audioReferences: [...withoutReplacedTurn, reference],
      });
      activeActivityCheckpointRef.current = next;
      setActiveActivityCheckpoint(next);
      const saved = await persistActivityCheckpoint(next);
      if (!saved) return false;
      setOfflineFoundationError(null);
      return true;
    } catch (error) {
      console.error('Unable to persist offline audio metadata.', error);
      setOfflineFoundationError('The recording could not be saved locally. Your activity has not advanced; retry or use the typed answer.');
      return false;
    }
  }, [persistActivityCheckpoint, queueCheckpointOperation]);

  const endActivityCheckpoint = React.useCallback(async (outcome: ActivitySessionEnd) => {
    const current = activeActivityCheckpointRef.current;
    if (!current) return false;
    if (outcome === 'completed_local') {
      const completed = createCompletedLocalCheckpoint(current);
      activeActivityCheckpointRef.current = completed;
      setActiveActivityCheckpoint(completed);
      if (!await persistActivityCheckpoint(completed)) return false;

      const queued = createPendingSyncCheckpoint(completed);
      activeActivityCheckpointRef.current = queued;
      setActiveActivityCheckpoint(queued);
      if (!await persistActivityCheckpoint(queued)) return false;

      activeActivityCheckpointRef.current = null;
      setActiveActivityCheckpoint(null);
      setShowConnectionLossPrompt(false);
      return true;
    }

    activeActivityCheckpointRef.current = null;
    setActiveActivityCheckpoint(null);
    setShowConnectionLossPrompt(false);
    try {
      await queueCheckpointOperation(
        () => accountStorage.deleteOfflineSession(current.userId, current.type, current.localId),
      );
      return true;
    } catch (error) {
      console.error('Unable to clear the completed activity checkpoint.', error);
      setOfflineFoundationError('The local activity checkpoint could not be cleared safely.');
      return false;
    }
  }, [persistActivityCheckpoint, queueCheckpointOperation]);

  const getActiveActivityMode = React.useCallback((type: OfflineActivityType) => {
    const active = activeActivityCheckpointRef.current;
    return active?.type === type ? active.mode : 'online';
  }, []);

  const getCheckpointEyeContactSummary = React.useCallback(() => {
    const saved = restoredEyeContactSummaryRef.current;
    const currentSamples = eyeTracker.samples;
    const currentScore = currentSamples > 0 ? eyeTracker.score : null;
    if (!saved || saved.samples <= 0) {
      return { score: currentScore, samples: currentSamples };
    }
    if (currentSamples <= 0 || currentScore === null) return saved;
    const savedScore = saved.score ?? 0;
    const samples = saved.samples + currentSamples;
    return {
      score: Math.round(((savedScore * saved.samples + currentScore * currentSamples) / samples) * 100) / 100,
      samples,
    };
  }, [eyeTracker.samples, eyeTracker.score]);
  const communicationSkillCriteria = [
    {
      label: 'Vocabulary Usage',
      description: 'Measures breadth and appropriateness of word choice in context',
      field: 'score_vocabulary',
    },
    {
      label: 'Clarity of Speech',
      description: 'Assesses pronunciation accuracy and how clearly words are articulated',
      field: 'score_clarity',
    },
    {
      label: 'Eye Contact',
      description: 'Camera-based eye direction and head movement measured during Enrollment, Thesis, Pre-Test, Post-Test, and Drill activities.',
      field: 'score_eye_contact',
    },
    {
      label: 'Grammar & Sentence Structure',
      description: 'Assesses correct use of tenses, subject-verb agreement, and sentence construction',
      field: 'score_grammar',
    },
    {
      label: 'Courtesy',
      description: 'Assesses the showcase of empathy and proper manners when communicating',
      field: 'score_courtesy',
    },
    {
      label: 'Conciseness',
      description: 'Assesses directness and relevance',
      field: 'score_conciseness',
    },
  ];

  // Calculate statistics once for reuse
  const stats = (() => {
    const completedEnrollment = interviewHistory.filter(isCompletedActivity);
    const completedThesis = thesisHistory.filter(isCompletedActivity);
    const completedModules = communicationHistory.filter(isCompletedActivity);
    const completedActivities = [...completedEnrollment, ...completedThesis, ...completedModules];
    const allScoredActivities = completedActivities
      .map(item => getNormalizedActivityScore(item))
      .filter((score): score is number => score != null);
    const totalInterviews = completedActivities.length;
    const scoredCommunication = completedModules.filter(item => item._source !== 'drills');
    const scoredCount = allScoredActivities.length;

    const avgScore = scoredCount > 0
      ? parseFloat((allScoredActivities.reduce((acc, curr) => acc + curr, 0) / scoredCount).toFixed(2))
      : 0;

    let performance = "N/A";
    let perfColor = "text-slate-400";
    let perfMsg = "Complete interviews to see performance";
    if (scoredCount > 0) {
      if (avgScore >= 90) { performance = "Excellent"; perfColor = "text-success"; perfMsg = "Keep up the great work!"; }
      else if (avgScore >= 75) { performance = "Good"; perfColor = "text-emerald-400"; perfMsg = "Solid understanding."; }
      else if (avgScore >= 60) { performance = "Passing"; perfColor = "text-amber-400"; perfMsg = "You're getting warmer."; }
      else { performance = "Needs Practice"; perfColor = "text-rose-400"; perfMsg = "Keep practicing!"; }
    }

    const skillBreakdown = communicationSkillCriteria.map(criteria => {
      if (criteria.field === 'score_eye_contact') {
        const cameraRecords = [
          ...completedEnrollment,
          ...completedThesis,
          ...completedModules,
        ].filter(item =>
          (item.eye_contact_samples || 0) > 0 && item.score_eye_contact != null
        );
        const totalCameraSamples = cameraRecords.reduce((sum, item) => sum + Number(item.eye_contact_samples || 0), 0);
        const cameraPercentage = totalCameraSamples > 0
          ? parseFloat((cameraRecords.reduce(
              (sum, item) => sum + (Number(item.score_eye_contact) * Number(item.eye_contact_samples || 0)),
              0,
            ) / totalCameraSamples).toFixed(1))
          : null;

        return {
          label: criteria.label,
          description: criteria.description,
          score: cameraPercentage == null ? 0 : parseFloat((cameraPercentage / 20).toFixed(1)),
          displayScore: cameraPercentage == null ? 'N/A' : `${cameraPercentage}%`,
          value: cameraPercentage == null ? 0 : Math.round(cameraPercentage),
          scale: cameraPercentage == null ? 'No camera data' : 'Camera-based',
        };
      }

      const recordedScores = scoredCommunication
        .map(item => getCommunicationSkillScore(item, criteria.field))
        .filter((score): score is number => score != null);
      const score = recordedScores.length > 0
        ? parseFloat((recordedScores.reduce((sum, currentScore) => sum + currentScore, 0) / recordedScores.length).toFixed(1))
        : null;

      return {
        label: criteria.label,
        description: criteria.description,
        score: score || 0,
        displayScore: score == null ? 'N/A' : `${score}/5`,
        value: score == null ? 0 : Math.round((score / 5) * 100),
        scale: score == null ? 'No scored data' : '1-5 scale',
      };
    });

    const activityGroups = [
      { label: 'University Enrollment', records: completedEnrollment },
      { label: 'Thesis Defense', records: completedThesis },
      { label: 'Pre-Test: Who Am I?', records: completedModules.filter(item => item._source === 'pre-test-intro') },
      { label: 'Pre-Test: Active Listening', records: completedModules.filter(item => item._source === 'pre-test-active-listening') },
      { label: 'Post-Test', records: completedModules.filter(item => item._source === 'post-test-interview') },
      { label: 'Drills', records: completedModules.filter(item => item._source === 'drills') },
    ].map(group => {
      const scores = group.records
        .map(item => getNormalizedActivityScore(item))
        .filter((score): score is number => score != null);
      return {
        label: group.label,
        completed: group.records.length,
        scored: scores.length,
        average: scores.length > 0
          ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
          : null,
      };
    });

    const comparisonInsights = [
      buildActivityComparison('University Enrollment', completedEnrollment),
      buildActivityComparison('Thesis Defense', completedThesis),
      buildActivityComparison(
        'Pre-Test',
        completedModules.filter(item => ['pre-test-intro', 'pre-test-active-listening'].includes(item._source)),
      ),
      buildActivityComparison(
        'Post-Test',
        completedModules.filter(item => item._source === 'post-test-interview'),
      ),
      buildActivityComparison(
        'Drills',
        completedModules.filter(item => item._source === 'drills'),
      ),
    ];

    return { totalInterviews, avgScore, performance, perfColor, perfMsg, skillBreakdown, activityGroups, comparisonInsights };
  })();

  const renderStatCards = (delay = 0) => (
    <div className="grid w-full grid-cols-1 md:grid-cols-3 gap-2.5">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.1 }} className="bg-card border border-line rounded-lg p-5 flex flex-col justify-between">
        <h3 className="text-muted font-medium">Total Activities</h3>
        <div className="mt-2">
          <span className="text-3xl font-bold text-ink">{stats.totalInterviews}</span>
          <p className="text-program-accent text-sm mt-1 font-medium">Interviews, tests, and drills</p>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.2 }} className="bg-card border border-line rounded-lg p-5 flex flex-col justify-between">
        <h3 className="text-muted font-medium">Average Score</h3>
        <div className="mt-2">
          <span className="text-program-accent text-3xl font-bold">{stats.avgScore}%</span>
          <p className="text-sm mt-1 font-medium text-success">Overall average</p>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.3 }} className="bg-card border border-line rounded-lg p-5 flex flex-col justify-between">
        <h3 className="text-muted font-medium">Performance</h3>
        <div className="mt-2">
          <span className="text-3xl font-bold text-ink">{stats.performance}</span>
          <p className={`text-sm mt-1 font-medium ${stats.perfColor}`}>{stats.perfMsg}</p>
        </div>
      </motion.div>
    </div>
  );

  useEffect(() => {
    const routes: Partial<Record<typeof activeTab, string>> = {
      dashboard: '/dashboard',
      'pre-test': '/pre-test',
      drills: '/drills',
      'post-test': '/post-test',
      history: '/history',
      analytics: '/analytics',
      settings: '/settings',
      support: '/support',
      privacy: '/privacy',
      profile: '/profile',
    };
    const path = routes[activeTab];
    if (path && window.location.pathname !== path) window.history.pushState({}, '', path);
  }, [activeTab]);

  useEffect(() => {
    const handlePopState = () => {
      const route = window.location.pathname;
      if (route === '/pre-test') setActiveTab('pre-test');
      else if (route === '/drills') setActiveTab('drills');
      else if (route === '/post-test') setActiveTab('post-test');
      else if (route === '/history') setActiveTab('history');
      else if (route === '/analytics') setActiveTab('analytics');
      else if (route === '/settings') setActiveTab('settings');
      else if (route === '/support') setActiveTab('support');
      else if (route === '/privacy') setActiveTab('privacy');
      else if (route === '/profile') setActiveTab('profile');
      else setActiveTab('dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const fetchHistory = React.useCallback(async (
    userId: number | null = authenticatedUserIdRef.current,
    department: string = profile.department,
  ) => {
    if (!userId) {
      setInterviewHistory([]);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/upcoming-student-interview/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Enrollment history request failed with ${res.status}.`);
      const responseData: unknown = await res.json();
      const data = Array.isArray(responseData) ? responseData : [];
      if (authenticatedUserIdRef.current !== userId) return;
      setInterviewHistory(data);
      accountStorage.putCachedHistory({
        userId,
        type: 'upcoming',
        data,
        timestamp: Date.now(),
      }).catch(console.error);
    } catch (e) {
      console.warn("Offline: loading interview history from cache");
      const cached = await accountStorage.getCachedHistory(userId, 'upcoming');
      const data = cached ? cached.data : [];

      const offlineSessions = await accountStorage.getOfflineSessions(userId, 'upcoming');
      const offlineUpcoming = offlineSessions
        .filter(s => ['completed_local', 'pending_sync', 'sync_failed'].includes(s.status))
        .map(s => ({
          id: s.localId,
          status: 'pending_sync',
          start_time: new Date(s.timestamp).toISOString(),
          total_score: null,
          passed: null,
          isOffline: true,
          pendingSync: true,
        }));

      if (authenticatedUserIdRef.current !== userId) return;
      setInterviewHistory([...offlineUpcoming, ...data]);
    }
  }, [API_URL, profile.department]);

  const fetchThesisHistory = React.useCallback(async (
    userId: number | null = authenticatedUserIdRef.current,
    department: string = profile.department,
  ) => {
    if (!userId) {
      setThesisHistory([]);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/thesis-interview/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Thesis history request failed with ${res.status}.`);
      const responseData: unknown = await res.json();
      const data = Array.isArray(responseData) ? responseData : [];
      if (authenticatedUserIdRef.current !== userId) return;
      setThesisHistory(data);
      accountStorage.putCachedHistory({
        userId,
        type: 'thesis',
        data,
        timestamp: Date.now(),
      }).catch(console.error);
    } catch (e) {
      console.warn("Offline: loading thesis history from cache");
      const cached = await accountStorage.getCachedHistory(userId, 'thesis');
      const data = cached ? cached.data : [];

      const offlineSessions = await accountStorage.getOfflineSessions(userId, 'thesis');
      const offlineThesis = offlineSessions
        .filter(s => ['completed_local', 'pending_sync', 'sync_failed'].includes(s.status))
        .map(s => ({
          id: s.localId,
          status: 'pending_sync',
          start_time: new Date(s.timestamp).toISOString(),
          total_score: null,
          passed: null,
          isOffline: true,
          pendingSync: true,
        }));

      if (authenticatedUserIdRef.current !== userId) return;
      setThesisHistory([...offlineThesis, ...data]);
    }
  }, [API_URL, profile.department]);

  const fetchCommunicationHistory = React.useCallback(async (
    userId: number | null = authenticatedUserIdRef.current,
  ) => {
    if (!userId) {
      setCommunicationHistory([]);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const [preTestIntroRes, activeListeningRes, postTestRes, drillsRes] = await Promise.all([
        fetch(`${API_URL}/pre-test-intro/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/pre-test-active-listening/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/post-test-interview/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/drills/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
      ]);

      const [preTestIntro, activeListening, postTest, drills] = await Promise.all([
        preTestIntroRes.ok ? preTestIntroRes.json() : Promise.resolve([]),
        activeListeningRes.ok ? activeListeningRes.json() : Promise.resolve([]),
        postTestRes.ok ? postTestRes.json() : Promise.resolve([]),
        drillsRes.ok ? drillsRes.json() : Promise.resolve([]),
      ]);

      if (![preTestIntroRes, activeListeningRes, postTestRes, drillsRes].every(response => response.ok)) {
        throw new Error('One or more analytics history endpoints failed.');
      }

      if (authenticatedUserIdRef.current !== userId) return;
      setCommunicationHistory([
        ...preTestIntro.map((item: any) => ({ ...item, _source: 'pre-test-intro' })),
        ...activeListening.map((item: any) => ({ ...item, _source: 'pre-test-active-listening' })),
        ...postTest.map((item: any) => ({ ...item, _source: 'post-test-interview' })),
        ...drills.map((item: any) => ({ ...item, _source: 'drills' })),
      ]);
    } catch (e) {
      console.warn("Unable to load communication skill history", e);
    }
  }, [API_URL]);

  useEffect(() => {
    let cancelled = false;

    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      try {
        if (!token) {
          authenticatedUserIdRef.current = null;
          setAuthenticatedUserId(null);
          onLogout();
          return;
        }

        const res = await fetch(`${API_URL}/users/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json() as AuthenticatedUserResponse;
          if (cancelled) return;
          if (!Number.isSafeInteger(data.id) || data.id <= 0) {
            throw new Error('The authenticated profile did not include a valid backend user ID.');
          }
          const p = {
            name: `${data.firstname || ''} ${data.middlename || ''} ${data.lastname || ''}`.replace(/\s+/g, ' ').trim() || 'Guest User',
            email: data.email || '',
            password: '',
            department: data.department || '',
            profilePicture: getCustomProfileImageUrl(data.profile_picture_url)
          };
          authenticatedUserIdRef.current = data.id;
          setAuthenticatedUserId(data.id);
          setProfile(p);

          accountStorage.putCachedProfile({
            userId: data.id,
            email: p.email,
            name: p.name,
            department: p.department,
            profilePicture: p.profilePicture,
          }).catch(console.error);
          rememberVerifiedAccount(token, data.id).catch((bindingError) => {
            console.error('Failed to remember the verified offline account binding:', bindingError);
          });

        } else if (res.status === 401 || res.status === 403) {
          authenticatedUserIdRef.current = null;
          setAuthenticatedUserId(null);
          onLogout();
        } else {
          throw new Error(`The authenticated profile endpoint returned HTTP ${res.status}.`);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to verify authenticated user:', error);
        const verifiedUserId = authenticatedUserIdRef.current;
        if (verifiedUserId) {
          try {
            const cached = await accountStorage.getCachedProfile(verifiedUserId);
            if (!cached || authenticatedUserIdRef.current !== verifiedUserId) return;
            setProfile({
              name: cached.name || 'Guest User',
              email: cached.email,
              password: '',
              department: cached.department,
              profilePicture: getCustomProfileImageUrl(cached.profilePicture),
            });
            return;
          } catch (cacheError) {
            console.error('Failed to load the verified account cache:', cacheError);
          }
        }

        if (token) {
          const boundUserId = await getVerifiedAccountForToken(token);
          if (boundUserId) {
            try {
              const cached = await accountStorage.getCachedProfile(boundUserId);
              if (cancelled || !cached) return;
              authenticatedUserIdRef.current = boundUserId;
              setAuthenticatedUserId(boundUserId);
              setProfile({
                name: cached.name || 'Guest User',
                email: cached.email,
                password: '',
                department: cached.department,
                profilePicture: getCustomProfileImageUrl(cached.profilePicture),
              });
              return;
            } catch (cacheError) {
              console.error('Failed to load the bound account cache:', cacheError);
            }
          }
        }

        // A token alone is not enough to safely select an account cache.
        authenticatedUserIdRef.current = null;
        setAuthenticatedUserId(null);
        setProfile({ name: '', email: '', password: '', department: '', profilePicture: '' });
        setInterviewHistory([]);
        setThesisHistory([]);
        setCommunicationHistory([]);
        onLogout();
      }
    };
    void fetchUser();
    return () => {
      cancelled = true;
    };
  }, [API_URL, onLogout]);

  useEffect(() => {
    if (!authenticatedUserId) return;
    void fetchHistory(authenticatedUserId, profile.department);
    void fetchThesisHistory(authenticatedUserId, profile.department);
    void fetchCommunicationHistory(authenticatedUserId);
  }, [
    authenticatedUserId,
    fetchCommunicationHistory,
    fetchHistory,
    fetchThesisHistory,
    profile.department,
  ]);

  useEffect(() => {
    if (!authenticatedUserId) {
      setResumableOfflineSession(null);
      setPendingSyncCount(0);
      setSyncQueueSessions([]);
      return;
    }

    let cancelled = false;
    const inspectOwnedOfflineState = async () => {
      try {
        const [resumable, queue] = await Promise.all([
          accountStorage.getResumableOfflineSessions(authenticatedUserId),
          accountStorage.getPendingOfflineSessions(authenticatedUserId),
        ]);
        if (cancelled || authenticatedUserIdRef.current !== authenticatedUserId) return;
        setResumableOfflineSession(resumable[0] || null);
        setPendingSyncCount(queue.length);
        setSyncQueueSessions(queue);
      } catch (error) {
        if (!cancelled) {
          console.error('Unable to inspect the account-scoped offline queue.', error);
          setOfflineFoundationError('Saved offline activities could not be inspected safely.');
        }
      }
    };
    void inspectOwnedOfflineState();
    return () => { cancelled = true; };
  }, [authenticatedUserId, connectivity.effectiveOnline, activeActivityCheckpoint?.updatedAt]);

  useEffect(() => {
    if (!authenticatedUserId) return;
    void maintainOwnedOfflineStorage({ userId: authenticatedUserId }).catch(error => {
      console.warn('Offline retention maintenance could not run safely.', error);
    });
  }, [authenticatedUserId]);

  const applySyncQueueUpdate = React.useCallback((updated: AccountOfflineSession) => {
    if (authenticatedUserIdRef.current !== updated.userId) return;
    setSyncQueueSessions(current => {
      const remaining = current.filter(session => session.clientSessionId !== updated.clientSessionId);
      return updated.status === 'synced' ? remaining : [...remaining, updated];
    });
    if (updated.status === 'synced') setLastSyncNotice('Synced');
  }, []);

  useEffect(() => {
    setPendingSyncCount(syncQueueSessions.length);
  }, [syncQueueSessions]);

  useEffect(() => {
    if (!connectivity.effectiveOnline) return;
    if (!authenticatedUserId) return;
    const active = activeActivityCheckpointRef.current;
    if (active?.mode === 'offline' && active.status === 'in_progress') return;
    const token = localStorage.getItem('token');
    if (!token) return;
    void syncOfflineQueueWithRetry({
      apiUrl: API_URL,
      token,
      userId: authenticatedUserId,
      isCurrentUser: () => authenticatedUserIdRef.current === authenticatedUserId,
      isOnline: () => connectivityOnlineRef.current,
      hasActiveOfflineSession: () => {
        const current = activeActivityCheckpointRef.current;
        return current?.mode === 'offline' && current.status === 'in_progress';
      },
      onSessionUpdated: applySyncQueueUpdate,
    }).then(async synchronized => {
      if (authenticatedUserIdRef.current !== authenticatedUserId) return;
      const remaining = await accountStorage.getPendingOfflineSessions(authenticatedUserId);
      setPendingSyncCount(remaining.length);
      setSyncQueueSessions(remaining);
      if (synchronized <= 0) return;
      await Promise.all([
        fetchHistory(authenticatedUserId, profile.department),
        fetchThesisHistory(authenticatedUserId, profile.department),
        fetchCommunicationHistory(authenticatedUserId),
      ]);
    }).catch(error => {
      console.warn('Bounded offline synchronization stopped safely.', error);
      setOfflineFoundationError(
        error instanceof Error ? error.message : 'An offline activity could not be synchronized.',
      );
    });
  }, [
    authenticatedUserId,
    connectivity.effectiveOnline,
    activeActivityCheckpoint?.updatedAt,
    fetchCommunicationHistory,
    fetchHistory,
    fetchThesisHistory,
    applySyncQueueUpdate,
    profile.department,
  ]);

  const retryFailedSync = React.useCallback(async (session: AccountOfflineSession) => {
    if (
      !authenticatedUserId
      || session.userId !== authenticatedUserId
      || !connectivityOnlineRef.current
      || (activeActivityCheckpointRef.current?.mode === 'offline'
        && activeActivityCheckpointRef.current.status === 'in_progress')
    ) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    setOfflineFoundationError(null);
    try {
      await retryOfflineSessionManually(session, {
        apiUrl: API_URL,
        token,
        userId: authenticatedUserId,
        onSessionUpdated: applySyncQueueUpdate,
      });
      await Promise.all([
        fetchHistory(authenticatedUserId, profile.department),
        fetchThesisHistory(authenticatedUserId, profile.department),
        fetchCommunicationHistory(authenticatedUserId),
      ]);
    } catch (error) {
      setOfflineFoundationError(
        error instanceof Error ? error.message : 'The saved activity could not be synchronized.',
      );
    }
  }, [
    API_URL,
    applySyncQueueUpdate,
    authenticatedUserId,
    fetchCommunicationHistory,
    fetchHistory,
    fetchThesisHistory,
    profile.department,
  ]);

  useEffect(() => {
    const active = activeActivityCheckpointRef.current;
    if (!active) {
      setShowConnectionLossPrompt(false);
      return;
    }

    if (active.mode === 'online') {
      if (connectivity.connectionState === 'offline' || connectivity.connectionState === 'degraded') {
        setShowConnectionLossPrompt(true);
      } else if (connectivity.connectionState === 'online') {
        setShowConnectionLossPrompt(false);
      }
      return;
    }

    setShowConnectionLossPrompt(false);
    if (connectivity.connectionState === 'online') {
      setConnectionRestoredNotice(true);
    }
  }, [connectivity.connectionState, activeActivityCheckpoint]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      void fetchHistory();
      void fetchThesisHistory();
      void fetchCommunicationHistory();
    }
  }, [activeTab, fetchHistory, fetchThesisHistory, fetchCommunicationHistory]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile({ ...profile, profilePicture: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const token = localStorage.getItem('token');
      const verifiedUserId = authenticatedUserIdRef.current;
      if (!token || !verifiedUserId) return;

      const formData = new FormData();

      const nameParts = profile.name.trim().split(/\s+/);
      const firstname = nameParts[0] || '';
      let middlename = '';
      let lastname = '';

      if (nameParts.length > 2) {
        middlename = nameParts[1];
        lastname = nameParts.slice(2).join(' ');
      } else if (nameParts.length === 2) {
        lastname = nameParts[1];
      }

      formData.append('firstname', firstname);
      formData.append('middlename', middlename);
      formData.append('lastname', lastname);
      formData.append('department', profile.department);
      if (profile.password) formData.append('password', profile.password);
      if (selectedFile) formData.append('file', selectedFile);

      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const updatedUser = await res.json() as AuthenticatedUserResponse;
        if (updatedUser.id !== verifiedUserId) {
          throw new Error('The updated profile did not match the verified account.');
        }
        const updatedProfile = {
          name: `${updatedUser.firstname || ''} ${updatedUser.middlename || ''} ${updatedUser.lastname || ''}`.replace(/\s+/g, ' ').trim() || 'Guest User',
          email: updatedUser.email || '',
          password: '',
          department: updatedUser.department || '',
          profilePicture: getCustomProfileImageUrl(updatedUser.profile_picture_url) || profile.profilePicture
        };
        setProfile(updatedProfile);
        await accountStorage.putCachedProfile({
          userId: verifiedUserId,
          email: updatedProfile.email,
          name: updatedProfile.name,
          department: updatedProfile.department,
          profilePicture: updatedProfile.profilePicture,
        });
        setSelectedFile(null);
        setIsSaved(true);
        setTimeout(() => {
          setIsSaved(false);
          setActiveTab('dashboard');
        }, 1500);
      } else {
        console.error('Failed to save profile', await res.text());
      }
    } catch (error) {
      console.error('Error saving profile', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Speech Recognition & TTS States
  const [aiResponseText, setAiResponseText] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [conversationLog, setConversationLog] = useState<{ sender: 'user' | 'ai', text: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [isEnrollmentFinalProfessorTurnReady, setIsEnrollmentFinalProfessorTurnReady] = useState(false);
  const [interviewMicFeedback, setInterviewMicFeedback] = useState<string | null>(null);
  const [latestOfflineRecordingUrl, setLatestOfflineRecordingUrl] = useState<string | null>(null);
  const [onlineInterviewError, setOnlineInterviewError] = useState<string | null>(null);
  const [canRetryOnlineResponse, setCanRetryOnlineResponse] = useState(false);
  const [typedInterviewAnswer, setTypedInterviewAnswer] = useState('');
  const [isSubmittingOfflineAnswer, setIsSubmittingOfflineAnswer] = useState(false);

  const audioQueueRef = React.useRef<string[]>([]);
  const isPlayingRef = React.useRef(false);
  const isAiSpeakingRef = React.useRef(false);
  const conversationLogRef = React.useRef(conversationLog);
  const chatMessagesRef = React.useRef(chatMessages);
  const enrollmentFinalGenerationSequenceRef = React.useRef(0);
  const activeEnrollmentFinalGenerationRef = React.useRef<number | null>(null);
  const audioPlayerRef = React.useRef<HTMLAudioElement | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = React.useRef<number>(0);
  const animationRef = React.useRef<number>(0);
  const [audioData, setAudioData] = useState<number[]>(new Array(15).fill(20));
  const [mouthValue, setMouthValue] = useState(0);
  const mouthValueRef = React.useRef(0);
  const lipSyncAnimFrameRef = React.useRef<number>(0);
  const [mouthCues, setMouthCues] = useState<any[] | null>(null);
  const [currentAudioStartTime, setCurrentAudioStartTime] = useState(0);
  const [activeAnalyser, setActiveAnalyser] = useState<AnalyserNode | null>(null);
  const browserTtsAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const onlineResponseBufferRef = React.useRef('');
  const onlinePreviousAiResponseRef = React.useRef('');
  const onlinePendingUserTextRef = React.useRef('');
  const onlineResponseFinalTurnRef = React.useRef(false);
  const thesisAbstractTextRef = React.useRef('');
  const offlineWebLLMEngineRef = React.useRef<MLCEngine | null>(null);
  const offlineAnswerSubmissionRef = React.useRef(false);

  useEffect(() => {
    conversationLogRef.current = conversationLog;
  }, [conversationLog]);

  useEffect(() => {
    thesisConversationLogRef.current = thesisConversationLog;
  }, [thesisConversationLog]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  if (!browserTtsAnalyserRef.current) {
    browserTtsAnalyserRef.current = {
      frequencyBinCount: 64,
      getByteFrequencyData: (data: Uint8Array) => {
        data.fill(0);
        if (!isAiSpeakingRef.current || !window.speechSynthesis?.speaking) return;

        const pulse = 95 + Math.abs(Math.sin(performance.now() / 85)) * 120;
        for (let i = 1; i < Math.min(data.length, 32); i++) {
          data[i] = Math.min(255, pulse * (1 - i / 45)) as number;
        }
      }
    } as unknown as AnalyserNode;
  }

  const unlockBrowserSpeech = () => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const unlockUtterance = new SpeechSynthesisUtterance('.');
    unlockUtterance.volume = 0;
    window.speechSynthesis.speak(unlockUtterance);
  };

  useEffect(() => {
    // Mount the single persistent audio tag safely
    audioPlayerRef.current = new Audio();
  }, []);

  const isListeningRef = React.useRef(false);
  const userAudioContextRef = React.useRef<AudioContext | null>(null);
  const userAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const userMediaStreamRef = React.useRef<MediaStream | null>(null);
  const userAnimationRef = React.useRef<number>(0);
  const [userAudioData, setUserAudioData] = useState<number[]>(new Array(3).fill(8));
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  const {
    isListening,
    isFinalizing: isMicTransitioning,
    hasUnfinalizedTranscript,
    liveTranscript,
    startListening: startSpeechInput,
    stopListening: stopSpeechInput,
    cancelListening: cancelSpeechInput,
    resetTranscript: resetSpeechTranscript,
    enableOfflineRecording: enableOfflineSpeechRecording,
  } = useSpeechInput();

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const updateUserAudioData = () => {
    if (userAnalyserRef.current && userMediaStreamRef.current) {
      const dataArray = new Uint8Array(userAnalyserRef.current.frequencyBinCount);
      userAnalyserRef.current.getByteFrequencyData(dataArray);

      const voiceBins = [2, 4, 6];
      const bars = voiceBins.map(binIndex => {
        const val = dataArray[binIndex] || 0;
        return 8 + (val / 255) * 20; // Scale dynamically from 8px (min) to ~28px (max)
      });
      setUserAudioData(bars);
      userAnimationRef.current = requestAnimationFrame(updateUserAudioData);
    } else {
      setUserAudioData([8, 8, 8]);
    }
  };

  const updateAudioData = () => {
    if (analyserRef.current && isPlayingRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      // dataArray contains all frequencies up to 22kHz. Human voice is mostly in the lowest 10% (bins 1-10).
      // To make a beautiful symmetrical, full sound wave, we mirror the most active lower frequencies across our 15 bars:
      const voiceBins = [9, 8, 7, 5, 4, 3, 2, 1, 2, 3, 4, 5, 7, 8, 9];
      const bars = voiceBins.map(binIndex => {
        const val = dataArray[binIndex] || 0;
        return 20 + (val / 255) * 80; // Scale dynamically from 20px (min) to ~100px (max)
      });
      setAudioData(bars);

      // Compute mouth openness from voice-frequency amplitude (bins 1-10)
      let sum = 0;
      for (let i = 1; i <= 10; i++) {
        sum += dataArray[i] || 0;
      }
      const avg = sum / 10;
      const mouth = Math.min(avg / 180, 1.0); // Normalize to 0-1
      mouthValueRef.current = mouth;
      setMouthValue(mouth);

      animationRef.current = requestAnimationFrame(updateAudioData);
    } else {
      setAudioData(new Array(15).fill(20));
      mouthValueRef.current = 0;
      setMouthValue(0);
    }
  };

  const playNextAudio = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    setIsAiSpeaking(true);
    const audioSrc = audioQueueRef.current.shift();
    if (audioSrc && audioPlayerRef.current) {
      const audio = audioPlayerRef.current;
      audio.src = audioSrc;

      // Lazy load context only on user interaction play
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 64;
        const source = audioContextRef.current.createMediaElementSource(audio);
        source.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      } else if (audioContextRef.current.state === 'suspended') {
        try { await audioContextRef.current.resume(); } catch (e) { }
      }

      updateAudioData();

      audio.play().catch(e => console.error("Audio play error", e));
      audio.onended = () => {
        isPlayingRef.current = false;
        cancelAnimationFrame(animationRef.current);
        setAudioData(new Array(15).fill(20));

        if (audioQueueRef.current.length === 0) {
          setIsAiSpeaking(false);
        } else {
          playNextAudio();
        }
      };
    }
  };

  // Lip sync: poll the analyser continuously while AI is speaking
  const startLipSyncLoop = () => {
    const loop = () => {
      if (analyserRef.current && isAiSpeakingRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 1; i <= 10; i++) {
          sum += dataArray[i] || 0;
        }
        const avg = sum / 10;
        const mouth = Math.min(avg / 150, 1.0);
        setMouthValue(mouth);
        lipSyncAnimFrameRef.current = requestAnimationFrame(loop);
      } else {
        setMouthValue(0);
      }
    };
    cancelAnimationFrame(lipSyncAnimFrameRef.current);
    lipSyncAnimFrameRef.current = requestAnimationFrame(loop);
  };

  // PCM playback for Gemini Live Connect
  const playPCM = async (arrayBuffer: ArrayBuffer, lipSync?: any) => {
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
    if (lipSync && lipSync.mouthCues) {
      setMouthCues(lipSync.mouthCues);
    } else {
      setMouthCues(null);
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(audioContextRef.current.destination);
      setActiveAnalyser(analyserRef.current);
      console.log("[Interview] Audio Analyser stabilized and activated.");
      startLipSyncLoop();
    }
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) { }
    }

    isPlayingRef.current = true;

    // Convert 16-bit PCM to Float32
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyserRef.current!);

    // Smooth scheduling to prevent overlapping/choppy playback
    const currentTime = audioCtx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }

    source.start(nextPlayTimeRef.current);
    setCurrentAudioStartTime(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;

    // Restart the lip sync loop for each chunk to keep it alive
    startLipSyncLoop();

    source.onended = () => {
      isPlayingRef.current = false;
    };
  };

  const getWebLLMUnavailableMessage = () => {
    if (isLlmLoading) {
      return `AI is still downloading into your browser. Please wait for it to finish.\nStatus: ${llmStatus}`;
    }

    if (hasLlmError) {
      return `WebLLM could not initialize in this browser.\n${llmError || llmStatus}`;
    }

    if (!isLlmReady || !webLLMEngine) {
      return `WebLLM is not ready yet.\nStatus: ${llmStatus}`;
    }

    return null;
  };

  const handleLocalWebLLM = async (
    userText: string,
    currentMessages: any[],
    options: LocalWebLLMOptions = {},
  ) => {
    const isEnrollmentFinalTurn =
      options.enrollmentFinalTurn === true &&
      activeInterviewModeRef.current === 'enrollment';
    const finalGenerationAttemptId = isEnrollmentFinalTurn
      ? ++enrollmentFinalGenerationSequenceRef.current
      : null;

    if (finalGenerationAttemptId !== null) {
      activeEnrollmentFinalGenerationRef.current = finalGenerationAttemptId;
      setIsEnrollmentFinalProfessorTurnReady(false);
    }

    const ownsFinalGeneration = () =>
      finalGenerationAttemptId !== null &&
      activeEnrollmentFinalGenerationRef.current === finalGenerationAttemptId;

    const unavailableMessage = getWebLLMUnavailableMessage();
    if (unavailableMessage && !isEnrollmentFinalTurn) {
      alert(unavailableMessage);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      return;
    }

    // Add user message to state
    const newMessages = [...currentMessages, { role: 'user', content: userText }];
    chatMessagesRef.current = newMessages;
    setChatMessages(newMessages);
    const generationMessages = isEnrollmentFinalTurn
      ? newMessages.map((message, index) => (
        index === 0 && message.role === 'system'
          ? {
            ...message,
            content: `${message.content}\n\n${ENROLLMENT_FINAL_TURN_INSTRUCTION}`,
          }
          : message
      ))
      : newMessages;

    setAiResponseText('');
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;

    // Fake lip sync loop
    const startLipSync = () => {
      const loop = () => {
        if (isAiSpeakingRef.current) {
          setMouthValue(Math.random() * 0.3 + 0.1);
          requestAnimationFrame(loop);
        } else {
          setMouthValue(0);
        }
      };
      requestAnimationFrame(loop);
    };
    startLipSync();

    try {
      console.log("Starting WebLLM generation...");
      let fullResponse = "";
      let sentenceBuffer = "";

      // TTS Queueing System
      let ttsQueue: string[] = [];
      let isTtsPlaying = false;
      let ttsProcessingPromise: Promise<void> | null = null;

      const detectSpeechLang = (text: string) => {
        const tagalogKeywords = ['ang', 'mga', 'ng', 'sa', 'at', 'na', 'ay', 'ako', 'ikaw', 'siya', 'tayo', 'kami', 'kayo', 'sila', 'po', 'opo', 'hindi', 'oo', 'bakit', 'paano'];
        const words = text.toLowerCase().split(/\W+/);
        const tagalogCount = words.reduce((count, word) => count + (tagalogKeywords.includes(word) ? 1 : 0), 0);
        return tagalogCount > 1 ? 'tl-PH' : 'en-US';
      };

      const selectPreferredFemaleVoice = (voices: SpeechSynthesisVoice[], lang: string) => {
        const languageCode = lang.split('-')[0];
        const matchingVoices = voices.filter(voice =>
          voice.lang === lang || voice.lang.startsWith(languageCode)
        );
        const femaleVoiceNames = [
          'aria',
          'ava',
          'emma',
          'jenny',
          'joanna',
          'karen',
          'linda',
          'michelle',
          'samantha',
          'sara',
          'zira',
          'female',
          'woman',
          'girl',
        ];

        return matchingVoices.find(voice =>
          femaleVoiceNames.some(name => voice.name.toLowerCase().includes(name))
        ) || matchingVoices[0];
      };

      const speakWithBrowser = (text: string) => {
        return new Promise<void>((resolve) => {
          if (!('speechSynthesis' in window)) {
            console.warn("Speech synthesis is not supported in this browser.");
            resolve();
            return;
          }

          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = detectSpeechLang(text);
          utterance.rate = CLEAR_AI_SPEECH_RATE;
          utterance.pitch = CLEAR_AI_SPEECH_PITCH;
          utterance.volume = CLEAR_AI_SPEECH_VOLUME;
          const voices = window.speechSynthesis.getVoices();
          const preferredVoice = selectPreferredFemaleVoice(voices, utterance.lang);
          if (preferredVoice) utterance.voice = preferredVoice;

          let finished = false;
          const fallbackTimeoutMs = getClearSpeechTimeoutMs(text);
          const fallbackTimer = window.setTimeout(() => {
            console.warn("Speech synthesis timed out before onend fired.");
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
            finish();
          }, fallbackTimeoutMs);

          const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(fallbackTimer);
            resolve();
          };

          utterance.onend = finish;
          utterance.onerror = (event) => {
            console.error("Speech synthesis failed", event);
            finish();
          };

          try {
            setIsAiSpeaking(true);
            isAiSpeakingRef.current = true;
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(utterance);
          } catch (error) {
            console.error("Speech synthesis could not start", error);
            finish();
          }
        });
      };

      const processTtsQueue = async () => {
        if (isTtsPlaying) return ttsProcessingPromise || Promise.resolve();
        if (ttsQueue.length === 0) return Promise.resolve();
        isTtsPlaying = true;

        try {
          while (ttsQueue.length > 0) {
            const text = ttsQueue.shift();
            if (!text || !isAiSpeakingRef.current) break; // If we left the room, stop processing
            await speakWithBrowser(text);
          }
        } finally {
          isTtsPlaying = false;
        }
      };

      const enqueueTts = (text: string) => {
        ttsQueue.push(text);
        ttsProcessingPromise = processTtsQueue();
      };

      const processResponseChunk = (chunk: { choices: Array<{ delta?: { content?: string | null } }> }) => {
        if (!isAiSpeakingRef.current) return false;
        if (isEnrollmentFinalTurn && !ownsFinalGeneration()) return false;
        const delta = chunk.choices[0]?.delta?.content || "";
        fullResponse += delta;
        sentenceBuffer += delta;

        if (!isEnrollmentFinalTurn) {
          setAiResponseText(prev => prev + delta);

          const delimiters = ['. ', '! ', '? ', '\n'];
          for (const delimiter of delimiters) {
            if (sentenceBuffer.includes(delimiter)) {
              const parts = sentenceBuffer.split(delimiter);
              const toSpeak = parts[0] + delimiter;
              sentenceBuffer = parts.slice(1).join(delimiter);

              const cleanText = toSpeak.replace(/[*_#]/g, '').trim();
              if (cleanText) {
                enqueueTts(cleanText);
              }
            }
          }
        }

        return true;
      };

      const finalGenerationDeadline = Date.now() + ENROLLMENT_FINAL_RESPONSE_TIMEOUT_MS;
      const waitForFinalGeneration = <T,>(promise: Promise<T>) => {
        if (!isEnrollmentFinalTurn) return promise;

        const remainingTime = finalGenerationDeadline - Date.now();
        if (remainingTime <= 0) {
          return Promise.reject<T>(new EnrollmentFinalResponseTimeoutError());
        }

        return new Promise<T>((resolve, reject) => {
          const timeoutId = window.setTimeout(
            () => reject(new EnrollmentFinalResponseTimeoutError()),
            remainingTime,
          );

          promise.then(
            (value) => {
              window.clearTimeout(timeoutId);
              resolve(value);
            },
            (error) => {
              window.clearTimeout(timeoutId);
              reject(error);
            },
          );
        });
      };

      try {
        if (unavailableMessage || !webLLMEngine) {
          throw new Error(unavailableMessage || 'WebLLM is unavailable.');
        }

        const responseStream = await waitForFinalGeneration(
          webLLMEngine.chat.completions.create({
            messages: generationMessages,
            stream: true,
            temperature: 0.7,
            max_tokens: isEnrollmentFinalTurn ? 100 : 220,
          }),
        );

        if (isEnrollmentFinalTurn) {
          const responseIterator = responseStream[Symbol.asyncIterator]();
          while (ownsFinalGeneration() && isAiSpeakingRef.current) {
            const nextChunk = await waitForFinalGeneration(responseIterator.next());
            if (nextChunk.done) break;
            if (!processResponseChunk(nextChunk.value)) return;
          }
        } else {
          for await (const chunk of responseStream) {
            if (!processResponseChunk(chunk)) break;
          }
        }
      } catch (generationError) {
        if (!isEnrollmentFinalTurn) throw generationError;
        if (!ownsFinalGeneration()) return;

        if (generationError instanceof EnrollmentFinalResponseTimeoutError) {
          void webLLMEngine?.interruptGenerate().catch((interruptError) => {
            console.warn('Could not interrupt timed-out Enrollment final generation.', interruptError);
          });
        }
        console.warn('Using the safe Enrollment closing response.', generationError);
        fullResponse = ENROLLMENT_FINAL_RESPONSE_FALLBACK;
      }

      if (isEnrollmentFinalTurn) {
        if (!ownsFinalGeneration()) return;

        fullResponse = isUsableEnrollmentClosingResponse(fullResponse)
          ? fullResponse.trim()
          : ENROLLMENT_FINAL_RESPONSE_FALLBACK;
        sentenceBuffer = '';
        ttsQueue = [];
        setAiResponseText(fullResponse);
        enqueueTts(fullResponse.replace(/[*_#]/g, '').trim());
      } else if (sentenceBuffer.trim() && isAiSpeakingRef.current) {
        const cleanText = sentenceBuffer.replace(/[*_#]/g, '').trim();
        if (cleanText) {
          enqueueTts(cleanText);
        }
      }

      await (ttsProcessingPromise || Promise.resolve());

      if (isEnrollmentFinalTurn && !ownsFinalGeneration()) return;

      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      setMouthValue(0);

      setChatMessages(prev => {
        const nextMessages = [...prev, { role: 'assistant', content: fullResponse }];
        chatMessagesRef.current = nextMessages;
        return nextMessages;
      });
      const turn = { sender: 'ai' as const, text: fullResponse.trim() };
      if (activeInterviewModeRef.current === 'thesis') {
        setThesisConversationLog(prev => [...prev, turn]);
      } else {
        setConversationLog(prev => {
          const nextConversation = [...prev, turn];
          conversationLogRef.current = nextConversation;
          return nextConversation;
        });
      }

      if (isEnrollmentFinalTurn) {
        activeEnrollmentFinalGenerationRef.current = null;
        setIsEnrollmentFinalProfessorTurnReady(true);
      } else if (!isListeningRef.current) {
        toggleListening();
      }

    } catch (e) {
      if (isEnrollmentFinalTurn) {
        if (ownsFinalGeneration()) {
          console.error('Enrollment final response failed unexpectedly.', e);
          const fallbackTurn = {
            sender: 'ai' as const,
            text: ENROLLMENT_FINAL_RESPONSE_FALLBACK,
          };
          setAiResponseText(ENROLLMENT_FINAL_RESPONSE_FALLBACK);
          setChatMessages(prev => {
            const nextMessages = [
              ...prev,
              { role: 'assistant', content: ENROLLMENT_FINAL_RESPONSE_FALLBACK },
            ];
            chatMessagesRef.current = nextMessages;
            return nextMessages;
          });
          setConversationLog(prev => {
            const nextConversation = [...prev, fallbackTurn];
            conversationLogRef.current = nextConversation;
            return nextConversation;
          });
          activeEnrollmentFinalGenerationRef.current = null;
          setIsEnrollmentFinalProfessorTurnReady(true);
        }
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        setMouthValue(0);
        return;
      }

      console.error(e);
      setAiResponseText("Local AI Error.");
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
    }
  };

  const speakOnlineInterviewResponse = (text: string) => new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;

    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, '').trim());
    utterance.lang = 'en-US';
    utterance.rate = CLEAR_AI_SPEECH_RATE;
    utterance.pitch = CLEAR_AI_SPEECH_PITCH;
    utterance.volume = CLEAR_AI_SPEECH_VOLUME;
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice =>
      voice.lang.startsWith('en') && /aria|ava|emma|jenny|joanna|samantha|zira|female/i.test(voice.name)
    ) || voices.find(voice => voice.lang.startsWith('en'));
    if (preferredVoice) utterance.voice = preferredVoice;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = window.setTimeout(() => {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
      finish();
    }, getClearSpeechTimeoutMs(text));
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Speech synthesis could not start.', error);
      finish();
    }
  });

  const selectCachedOfflineInterviewEngine = async (): Promise<{
    engineName: OfflineInterviewEngine;
    engine: MLCEngine | null;
  }> => {
    const cachedEngine = await initializeCachedWebLLM();
    if (!cachedEngine) return { engineName: 'fallback', engine: null };
    offlineWebLLMEngineRef.current = cachedEngine;
    return { engineName: 'webllm', engine: cachedEngine };
  };

  const initializeOfflineInterviewState = async (
    type: OfflineInterviewKind,
    thesisContext?: { text: string; sourceName?: string },
  ): Promise<OfflineInterviewActivityState | null> => {
    const current = activeActivityCheckpointRef.current;
    if (!current || current.type !== type) return null;
    const existing = readOfflineInterviewActivityState(current);
    if (existing?.offlineEngine === 'fallback') return existing;

    const selection = await selectCachedOfflineInterviewEngine();
    const state = existing
      ? existing.offlineEngine === 'webllm' && selection.engineName === 'fallback'
        ? transitionOfflineInterviewToFallback(
          existing,
          current.responseCount,
          'The cached local model was no longer complete or usable when the session resumed.',
        )
        : { ...existing, offlineEngine: selection.engineName }
      : createOfflineInterviewActivityState(
        type,
        profile.department,
        selection.engineName,
        thesisContext,
      );
    const saved = await updateActivityCheckpoint({
      activityState: state as unknown as Record<string, unknown>,
      questionPackVersion: getQuestionPackVersion(type),
      lastError: selection.engineName === 'fallback'
        ? 'Cached WebLLM was unavailable; deterministic offline questions are active.'
        : null,
    });
    return saved ? state : null;
  };

  const finalizeOfflineProfessorTurn = async (
    type: OfflineInterviewKind,
    professorText: string,
    responseCount: number,
  ) => {
    const current = activeActivityCheckpointRef.current;
    if (!current || current.type !== type || current.mode !== 'offline') return false;
    const text = professorText.trim();
    if (!text) return false;
    const lastTurn = current.conversationLog.at(-1);
    const conversation = lastTurn?.sender === 'ai' && lastTurn.text === text
      ? current.conversationLog
      : [...current.conversationLog, { sender: 'ai' as const, text }];
    const saved = await updateActivityCheckpoint({
      conversationLog: conversation,
      currentQuestion: text,
      currentStep: responseCount,
      responseCount,
      eyeContactSummary: getCheckpointEyeContactSummary(),
    });
    if (!saved) return false;

    if (type === 'thesis') {
      thesisConversationLogRef.current = conversation;
      setThesisConversationLog(conversation);
    } else {
      conversationLogRef.current = conversation;
      setConversationLog(conversation);
    }
    setChatMessages(conversation.map(turn => ({
      role: turn.sender === 'ai' ? 'assistant' : 'user',
      content: turn.text,
    })));
    chatMessagesRef.current = conversation.map(turn => ({
      role: turn.sender === 'ai' ? 'assistant' : 'user',
      content: turn.text,
    }));
    setAiResponseText(text);
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
    await speakOnlineInterviewResponse(text);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
    setMouthValue(0);
    if (type === 'upcoming' && responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT) {
      setIsEnrollmentFinalProfessorTurnReady(true);
    }
    return true;
  };

  const generateOfflineProfessorTurn = async (
    type: OfflineInterviewKind,
    responseCount: number,
  ) => {
    const current = activeActivityCheckpointRef.current;
    if (!current || current.type !== type || current.mode !== 'offline') return false;
    let state = readOfflineInterviewActivityState(current);
    if (!state) {
      state = await initializeOfflineInterviewState(type, type === 'thesis' ? {
        text: thesisAbstractTextRef.current,
        sourceName: thesisAbstractFile?.name,
      } : undefined);
    }
    if (!state) return false;

    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
    let professorText = '';
    if (state.offlineEngine === 'webllm' && offlineWebLLMEngineRef.current) {
      try {
        professorText = await generateWebLLMProfessorTurn(offlineWebLLMEngineRef.current, {
          type,
          department: state.department,
          conversationLog: activeActivityCheckpointRef.current?.conversationLog || [],
          responseCount,
          thesisAbstractContext: state.thesisAbstractContext,
        });
      } catch (error) {
        console.warn('Cached WebLLM failed; continuing with deterministic offline questions.', error);
        state = transitionOfflineInterviewToFallback(
          state,
          responseCount,
          error instanceof Error ? error.message : 'Local model generation failed.',
        );
        offlineWebLLMEngineRef.current = null;
        await releaseWebLLM().catch(releaseError => {
          console.warn('Unable to release the failed local engine.', releaseError);
        });
        const transitioned = await updateActivityCheckpoint({
          activityState: state as unknown as Record<string, unknown>,
          lastError: 'Cached WebLLM failed; deterministic offline questions are now active.',
        });
        if (!transitioned) {
          setIsAiSpeaking(false);
          isAiSpeakingRef.current = false;
          return false;
        }
      }
    }
    if (!professorText) {
      professorText = getFallbackProfessorTurn(type, state.department, responseCount);
    }
    return finalizeOfflineProfessorTurn(type, professorText, responseCount);
  };

  const submitInterviewAnswer = async (rawText: string) => {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text || offlineAnswerSubmissionRef.current) {
      if (!text) setInterviewMicFeedback('Enter or record an answer before submitting.');
      return false;
    }
    const mode = activeInterviewModeRef.current;
    const checkpoint = activeActivityCheckpointRef.current;
    if (!mode || !checkpoint) return false;
    const type: OfflineInterviewKind = mode === 'thesis' ? 'thesis' : 'upcoming';
    const sourceConversation = type === 'thesis'
      ? thesisConversationLogRef.current
      : conversationLogRef.current;
    let appended: ReturnType<typeof appendOfflineInterviewAnswer>;
    try {
      appended = appendOfflineInterviewAnswer(sourceConversation, text);
    } catch (error) {
      setInterviewMicFeedback(error instanceof Error ? error.message : 'Unable to submit this answer.');
      return false;
    }

    offlineAnswerSubmissionRef.current = true;
    if (checkpoint.mode === 'offline') setIsSubmittingOfflineAnswer(true);
    setInterviewMicFeedback(null);
    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    const nextAnswer = {
      step: appended.responseCount,
      text,
      createdAt: Date.now(),
    };
    const saved = await updateActivityCheckpoint({
      conversationLog: appended.conversationLog,
      responseCount: appended.responseCount,
      currentStep: appended.responseCount,
      answers: [...checkpoint.answers, nextAnswer],
      eyeContactSummary: getCheckpointEyeContactSummary(),
    });
    if (!saved) {
      offlineAnswerSubmissionRef.current = false;
      setIsSubmittingOfflineAnswer(false);
      return false;
    }
    resetSpeechTranscript();

    if (type === 'thesis') {
      thesisConversationLogRef.current = appended.conversationLog;
      setThesisConversationLog(appended.conversationLog);
    } else {
      conversationLogRef.current = appended.conversationLog;
      setConversationLog(appended.conversationLog);
    }
    const nextMessages = [
      ...chatMessagesRef.current,
      { role: 'user', content: text },
    ];
    chatMessagesRef.current = nextMessages;
    setChatMessages(nextMessages);

    if (checkpoint.mode === 'offline') {
      const generated = await generateOfflineProfessorTurn(type, appended.responseCount);
      offlineAnswerSubmissionRef.current = false;
      setIsSubmittingOfflineAnswer(false);
      if (generated) setTypedInterviewAnswer('');
      return generated;
    }

    const isFinal = appended.responseCount === OFFLINE_INTERVIEW_RESPONSE_LIMIT;
    sendOnlineInterviewResponse(mode, text, isFinal);
    offlineAnswerSubmissionRef.current = false;
    return true;
  };

  const submitTypedInterviewAnswer = (event: React.FormEvent) => {
    event.preventDefault();
    void submitInterviewAnswer(typedInterviewAnswer);
  };

  const repeatStoredOfflineQuestion = async () => {
    const currentQuestion = activeActivityCheckpointRef.current?.currentQuestion.trim();
    if (!currentQuestion) return;
    setAiResponseText(currentQuestion);
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
    await speakOnlineInterviewResponse(currentQuestion);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
  };

  const finishOnlineInterviewResponse = async (mode: OnlineInterviewMode) => {
    const responseText = onlineResponseBufferRef.current.trim();
    if (!responseText) {
      setOnlineInterviewError('Professor Maxiel returned an empty response. Please retry.');
      setCanRetryOnlineResponse(true);
      setAiResponseText(onlinePreviousAiResponseRef.current);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      return;
    }

    const assistantTurn = { sender: 'ai' as const, text: responseText };
    let checkpointConversation: Array<{ sender: 'user' | 'ai'; text: string }>;
    if (mode === 'enrollment') {
      checkpointConversation = [...conversationLogRef.current, assistantTurn];
      conversationLogRef.current = checkpointConversation;
      setConversationLog(checkpointConversation);
    } else {
      checkpointConversation = [...thesisConversationLogRef.current, assistantTurn];
      thesisConversationLogRef.current = checkpointConversation;
      setThesisConversationLog(checkpointConversation);
    }
    updateActivityCheckpoint({
      conversationLog: checkpointConversation,
      currentQuestion: responseText,
      currentStep: checkpointConversation.filter(turn => turn.sender === 'user').length,
      responseCount: checkpointConversation.filter(turn => turn.sender === 'user').length,
      eyeContactSummary: getCheckpointEyeContactSummary(),
    });
    setChatMessages(previous => {
      const next = [...previous, { role: 'assistant', content: responseText }];
      chatMessagesRef.current = next;
      return next;
    });

    await speakOnlineInterviewResponse(responseText);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
    setMouthValue(0);

    const finalTurn = onlineResponseFinalTurnRef.current;
    onlineResponseBufferRef.current = '';
    onlineResponseFinalTurnRef.current = false;
    onlinePendingUserTextRef.current = '';
    setCanRetryOnlineResponse(false);
    if (mode === 'enrollment' && finalTurn) {
      setIsEnrollmentFinalProfessorTurnReady(true);
    } else if (!finalTurn && !isListeningRef.current) {
      void toggleListening();
    }
  };

  const hydrateOnlineInterviewHistory = (
    mode: OnlineInterviewMode,
    messages: OnlineInterviewHistoryMessage[],
  ) => {
    const turns = messages
      .filter(message => message.content.trim())
      .map(message => ({
        sender: message.role === 'assistant' ? 'ai' as const : 'user' as const,
        text: message.content,
      }));
    const chatHistory = messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
    const lastProfessorTurn = [...turns].reverse().find(turn => turn.sender === 'ai');
    setAiResponseText(lastProfessorTurn?.text || '');
    setChatMessages(chatHistory);
    chatMessagesRef.current = chatHistory;
    if (mode === 'enrollment') {
      setConversationLog(turns);
      conversationLogRef.current = turns;
      const userTurns = turns.filter(turn => turn.sender === 'user').length;
      setIsEnrollmentFinalProfessorTurnReady(
        userTurns >= 5 && turns[turns.length - 1]?.sender === 'ai'
      );
    } else {
      setThesisConversationLog(turns);
      thesisConversationLogRef.current = turns;
    }
  };

  const handleOnlineInterviewSocketMessage = (
    mode: OnlineInterviewMode,
    event: MessageEvent<string>,
  ) => {
    try {
      const payload = JSON.parse(event.data) as {
        type?: string;
        text?: string;
        message?: string;
        messages?: OnlineInterviewHistoryMessage[];
      };
      if (payload.type === 'history' && Array.isArray(payload.messages)) {
        hydrateOnlineInterviewHistory(mode, payload.messages);
        return;
      }
      if (payload.type === 'session_ready') {
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        return;
      }
      if (payload.type === 'error') {
        onlineResponseBufferRef.current = '';
        setAiResponseText(onlinePreviousAiResponseRef.current);
        setOnlineInterviewError(payload.message || 'The AI service is temporarily unavailable. Please try again.');
        setCanRetryOnlineResponse(true);
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        setMouthValue(0);
        return;
      }
      if (payload.type === 'turn_complete') {
        void finishOnlineInterviewResponse(mode);
        return;
      }
      if (typeof payload.text === 'string' && payload.text) {
        onlineResponseBufferRef.current += payload.text;
        setAiResponseText(onlineResponseBufferRef.current);
      }
    } catch (error) {
      console.error('Invalid interview socket response.', error);
      setOnlineInterviewError('The interview connection returned an invalid response. Please retry.');
      setCanRetryOnlineResponse(true);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
    }
  };

  const beginOnlineInterviewResponse = (mode: OnlineInterviewMode, finalTurn: boolean) => {
    onlinePreviousAiResponseRef.current = aiResponseText;
    onlineResponseBufferRef.current = '';
    onlineResponseFinalTurnRef.current = finalTurn;
    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    setAiResponseText('');
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
  };

  const connectOnlineInterview = (
    mode: OnlineInterviewMode,
    interviewSessionId: number,
    action: 'start' | 'retry',
  ) => new Promise<void>((resolve, reject) => {
    const token = localStorage.getItem('token');
    if (!token) {
      reject(new Error('Your session has expired. Please sign in again.'));
      return;
    }

    const socketRef = mode === 'enrollment' ? wsRef : thesisWsRef;
    socketRef.current?.close();
    const path = mode === 'enrollment'
      ? `/upcoming-student-interview/${interviewSessionId}/chat`
      : `/thesis-interview/${interviewSessionId}/chat`;
    const socket = new WebSocket(getWebSocketUrl(API_URL, path, token));
    socketRef.current = socket;

    socket.onopen = () => {
      const payload: {
        type: 'start' | 'retry';
        text?: string;
        final_turn?: boolean;
        abstract_text?: string;
      } = { type: action };
      if (action === 'retry' && onlinePendingUserTextRef.current) {
        payload.text = onlinePendingUserTextRef.current;
        payload.final_turn = onlineResponseFinalTurnRef.current;
      }
      if (mode === 'thesis' && thesisAbstractTextRef.current) {
        payload.abstract_text = thesisAbstractTextRef.current;
      }
      socket.send(JSON.stringify(payload));
      resolve();
    };
    socket.onmessage = event => handleOnlineInterviewSocketMessage(mode, event);
    socket.onerror = () => {
      const message = 'The interview AI connection could not be established. Please retry.';
      setOnlineInterviewError(message);
      setCanRetryOnlineResponse(true);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      reject(new Error(message));
    };
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
    };
  });

  const sendOnlineInterviewResponse = (
    mode: OnlineInterviewMode,
    text: string,
    finalTurn: boolean,
  ) => {
    if (activeActivityCheckpointRef.current?.mode === 'offline') {
      setOnlineInterviewError('This activity is locked offline. Cloud AI will not be used for the remainder of this session.');
      return;
    }
    const socket = mode === 'enrollment' ? wsRef.current : thesisWsRef.current;
    onlinePendingUserTextRef.current = text;
    beginOnlineInterviewResponse(mode, finalTurn);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setOnlineInterviewError('The interview connection was interrupted. Retry to continue without losing your response.');
      setCanRetryOnlineResponse(true);
      setAiResponseText(onlinePreviousAiResponseRef.current);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      return;
    }
    socket.send(JSON.stringify({ type: 'message', text, final_turn: finalTurn }));
  };

  const retryOnlineInterviewResponse = () => {
    if (activeActivityCheckpointRef.current?.mode === 'offline') {
      setOnlineInterviewError('This activity is locked offline and cannot return to cloud AI mid-session.');
      return;
    }
    const mode = activeInterviewModeRef.current;
    const interviewSessionId = mode === 'enrollment'
      ? sessionIdRef.current
      : thesisSessionIdRef.current;
    if (!mode || !interviewSessionId) return;

    beginOnlineInterviewResponse(mode, onlineResponseFinalTurnRef.current);
    const socket = mode === 'enrollment' ? wsRef.current : thesisWsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'retry',
        text: onlinePendingUserTextRef.current || undefined,
        final_turn: onlineResponseFinalTurnRef.current,
        abstract_text: mode === 'thesis' ? thesisAbstractTextRef.current : undefined,
      }));
      return;
    }
    void connectOnlineInterview(mode, interviewSessionId, 'retry').catch(error => {
      setOnlineInterviewError(error instanceof Error ? error.message : 'Unable to reconnect to the interview.');
    });
  };

  const startInterviewSession = async () => {
    setLatestOfflineRecordingUrl(null);
    if (professorAssetStatusRef.current === 'error') {
      retryProfessorAssetLoad();
      return;
    }
    // Unlock speech synthesis immediately on user click
    unlockBrowserSpeech();
    setIsStartingInterview(true);

    try {
      await waitForProfessorAsset();
    } catch {
      setIsStartingInterview(false);
      return;
    }

    if (!connectivity.effectiveOnline) {
      const department = profile.department.trim().toUpperCase();
      if (!['CCIT', 'CTE', 'CBAPA'].includes(department)) {
        setIsStartingInterview(false);
        alert('Enrollment Interview is available only to CCIT, CTE, and CBAPA students.');
        return;
      }
      activeEnrollmentFinalGenerationRef.current = null;
      enrollmentFinalGenerationSequenceRef.current += 1;
      setIsEnrollmentFinalProfessorTurnReady(false);
      resetSpeechTranscript();
      setInterviewMicFeedback(null);
      setOnlineInterviewError(null);
      setTypedInterviewAnswer('');
      conversationLogRef.current = [];
      setConversationLog([]);
      setAiResponseText('');
      setIsCameraEnabled(false);
      restoredEyeContactSummaryRef.current = null;
      sessionIdRef.current = null;
      setSessionId(null);
      activeInterviewModeRef.current = 'enrollment';
      setIsProfessorFirstFrameReady(false);
      setActiveTab('interview-session');
      chatMessagesRef.current = [];
      setChatMessages([]);
      onlinePendingUserTextRef.current = '';
      const checkpoint = await beginActivityCheckpoint({
        type: 'upcoming',
        mode: 'offline',
        questionPackVersion: getQuestionPackVersion('upcoming'),
      });
      if (!checkpoint) {
        setIsStartingInterview(false);
        setActiveTab('dashboard');
        return;
      }
      const state = await initializeOfflineInterviewState('upcoming');
      if (!state || !await generateOfflineProfessorTurn('upcoming', 0)) {
        setOnlineInterviewError('The offline interview could not be prepared. Your checkpoint remains safely stored.');
      }
      setIsStartingInterview(false);
      return;
    }

    let sid: number | null = null;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/upcoming-student-interview/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        sid = data.id;
      } else {
        const errorText = await response.text();
        alert(`Failed to start session: ${errorText}`);
        return;
      }
    } catch (error) {
      console.error('Unable to start Enrollment Interview.', error);
      alert('The Enrollment Interview could not be started. Check your connection and try again.');
      return;
    } finally {
      setIsStartingInterview(false);
    }

    if (sid) {
      activeEnrollmentFinalGenerationRef.current = null;
      enrollmentFinalGenerationSequenceRef.current += 1;
      setIsEnrollmentFinalProfessorTurnReady(false);
      resetSpeechTranscript();
      setInterviewMicFeedback(null);
      setOnlineInterviewError(null);
      conversationLogRef.current = [];
      setConversationLog([]);
      setAiResponseText('');
      setIsCameraEnabled(false);
      restoredEyeContactSummaryRef.current = null;
      setTypedInterviewAnswer('');
      sessionIdRef.current = sid;
      setSessionId(sid);
      activeInterviewModeRef.current = 'enrollment';
      setIsProfessorFirstFrameReady(false);
      setActiveTab('interview-session');

      chatMessagesRef.current = [];
      setChatMessages([]);
      onlinePendingUserTextRef.current = '';
      beginActivityCheckpoint({ type: 'upcoming', serverSessionId: sid });
      beginOnlineInterviewResponse('enrollment', false);
      void connectOnlineInterview('enrollment', sid, 'start').catch(error => {
        setOnlineInterviewError(error instanceof Error ? error.message : 'Unable to connect to the interview AI.');
        setCanRetryOnlineResponse(true);
      });
    }
  };

  const releaseInterviewMicrophone = () => {
    userMediaStreamRef.current?.getTracks().forEach(track => track.stop());
    userMediaStreamRef.current = null;
    if (userAudioContextRef.current) {
      void userAudioContextRef.current.close();
      userAudioContextRef.current = null;
    }
    cancelAnimationFrame(userAnimationRef.current);
    setUserAudioData([8, 8, 8]);
  };

  useEffect(() => () => {
    if (latestOfflineRecordingUrl) URL.revokeObjectURL(latestOfflineRecordingUrl);
  }, [latestOfflineRecordingUrl]);

  const exitInterview = () => {
    const shouldReleaseOfflineEngine = activeActivityCheckpointRef.current?.type === 'upcoming'
      && readOfflineInterviewActivityState(activeActivityCheckpointRef.current)?.offlineEngine === 'webllm';
    if (activeEnrollmentFinalGenerationRef.current !== null) {
      void webLLMEngine?.interruptGenerate();
    }
    activeEnrollmentFinalGenerationRef.current = null;
    enrollmentFinalGenerationSequenceRef.current += 1;
    setIsEnrollmentFinalProfessorTurnReady(false);
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    cancelSpeechInput();
    setLatestOfflineRecordingUrl(null);
    setIsLeaveModalOpen(false);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
    resetSpeechTranscript();
    setInterviewMicFeedback(null);
    setTypedInterviewAnswer('');
    setSessionId(null);
    setConversationLog([]);
    conversationLogRef.current = [];
    chatMessagesRef.current = [];
    setInterviewResult(null);
    setIsCameraEnabled(false);
    restoredEyeContactSummaryRef.current = null;
    sessionIdRef.current = null;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = "";
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (activeActivityCheckpointRef.current?.type === 'upcoming') {
      endActivityCheckpoint('abandoned');
    }
    if (shouldReleaseOfflineEngine) {
      offlineWebLLMEngineRef.current = null;
      void releaseWebLLM().catch(error => console.warn('Unable to release local interview AI.', error));
    }
    nextPlayTimeRef.current = 0;
    fetchHistory();
    setActiveTab('dashboard');
  };

  const finishInterviewSession = async () => {
    const activeCheckpoint = activeActivityCheckpointRef.current;
    if (activeCheckpoint?.type === 'upcoming' && activeCheckpoint.mode === 'offline') {
      if (activeCheckpoint.responseCount !== OFFLINE_INTERVIEW_RESPONSE_LIMIT || !isEnrollmentFinalProfessorTurnReady) return;
      setIsFinishingInterview(true);
      const eyeContactSummary = getCheckpointEyeContactSummary();
      const provisional = evaluateOfflineInterview(
        'upcoming',
        activeCheckpoint.conversationLog,
        eyeContactSummary,
      );
      const evaluated = await updateActivityCheckpoint({
        eyeContactSummary,
        localEvaluation: provisional.evaluation as unknown as Record<string, unknown>,
        localScore: null,
        pendingEvaluation: provisional.pendingEvaluation,
        evaluationAuthority: 'local_provisional',
      });
      const completed = evaluated && await endActivityCheckpoint('completed_local');
      setIsFinishingInterview(false);
      if (!completed) {
        setOnlineInterviewError('The provisional result could not be saved safely. Please retry completion.');
        return;
      }
      offlineWebLLMEngineRef.current = null;
      await releaseWebLLM().catch(error => console.warn('Unable to release local interview AI.', error));
      exitInterview();
      return;
    }
    if (!sessionId || !isEnrollmentFinalProfessorTurnReady) return;
    if (!authenticatedUserIdRef.current) {
      alert('Your account could not be verified. Please sign in again before saving this interview.');
      return;
    }
    setIsFinishingInterview(true);
    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    try {
      const cameraMetrics = {
        eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
        eye_contact_samples: eyeTracker.samples,
      };
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/upcoming-student-interview/${sessionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation: conversationLog, evaluation: cameraMetrics })
      });
      if (response.ok) {
        const data = await response.json();
        setInterviewResult(data);
        setOnlineInterviewError(null);
        endActivityCheckpoint('cloud_completed');
        cancelSpeechInput();
        setIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        const detail = await response.json().catch(() => null);
        setOnlineInterviewError(detail?.detail || 'The interview could not be validated. Please try again.');
      }
    } catch (error) {
      console.error('Enrollment validation request failed.', error);
      setOnlineInterviewError('The interview could not be validated. Check your connection and try again.');
    } finally {
      setIsFinishingInterview(false);
      fetchHistory();
    }
  };

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getThesisBreakdown = (result: any, dep: string) => {
    const d = (dep || '').toUpperCase();
    if (d === 'CTE') {
      return [
        { label: 'Pedagogical Innovation', score: result.score_cte_pedagogical_innovation, weight: '25%' },
        { label: 'Action Research', score: result.score_cte_action_research, weight: '20%' },
        { label: 'Learning Outcomes', score: result.score_cte_learning_outcomes, weight: '20%' },
        { label: 'Literature & DepEd', score: result.score_cte_literature_alignment, weight: '15%' },
        { label: 'Teaching Demo', score: result.score_cte_teaching_demo, weight: '10%' },
        { label: 'Scalability & Policy', score: result.score_cte_scalability_policy, weight: '10%' },
      ];
    } else if (d === 'CBAPA') {
      return [
        { label: 'Research Problem', score: result.score_cbapa_research_problem, weight: '25%' },
        { label: 'Methodology & Analysis', score: result.score_cbapa_methodology_analysis, weight: '25%' },
        { label: 'Practical ROI', score: result.score_cbapa_practical_roi, weight: '20%' },
        { label: 'Literature & Theory', score: result.score_cbapa_literature_theoretical, weight: '15%' },
        { label: 'Professional Delivery', score: result.score_cbapa_professional_delivery, weight: '15%' },
      ];
    } else {
      return [
        { label: 'Technical Innovation', score: result.score_ccit_technical_innovation, weight: '30%' },
        { label: 'System Implementation', score: result.score_ccit_system_implementation, weight: '25%' },
        { label: 'Experimental Validation', score: result.score_ccit_experimental_validation, weight: '20%' },
        { label: 'Literature Review', score: result.score_ccit_literature_review, weight: '15%' },
        { label: 'Demo Quality', score: result.score_ccit_demo_quality, weight: '10%' },
      ];
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isThesisResult = (r: any) =>
    r?.score_ccit_technical_innovation !== undefined ||
    r?.score_cte_pedagogical_innovation !== undefined ||
    r?.score_cbapa_research_problem !== undefined;

  const readThesisAbstractFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith('.txt')) return file.text();
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Only PDF and TXT thesis abstracts are supported.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 10);
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ');
      fullText += `${pageText}\n`;
    }
    return fullText;
  };

  const uploadThesisAbstractInSession = async (file: File) => {
    if (thesisInSessionUploading) return;
    const active = activeActivityCheckpointRef.current;
    if (active?.type === 'thesis' && active.mode === 'offline') {
      setThesisInSessionUploading(true);
      setThesisAbstractUpdated(false);
      try {
        const abstractText = (await readThesisAbstractFile(file)).trim().slice(0, 5000);
        const state = readOfflineInterviewActivityState(active);
        if (!state) throw new Error('The saved offline Thesis session is incomplete.');
        const nextState: OfflineInterviewActivityState = {
          ...state,
          thesisAbstractContext: abstractText,
          thesisAbstractSourceName: file.name,
        };
        thesisAbstractTextRef.current = abstractText;
        const saved = await updateActivityCheckpoint({
          activityState: nextState as unknown as Record<string, unknown>,
        });
        if (!saved) throw new Error('The updated abstract could not be saved locally.');
        setThesisAbstractFile(file);
        setThesisAbstractUpdated(true);
        setTimeout(() => setThesisAbstractUpdated(false), 3000);
      } catch (error) {
        setOnlineInterviewError(error instanceof Error ? error.message : 'The abstract could not be read locally.');
      } finally {
        setThesisInSessionUploading(false);
      }
      return;
    }
    if (!thesisSessionIdRef.current) return;
    setThesisInSessionUploading(true);
    setThesisAbstractUpdated(false);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/thesis-interview/${thesisSessionIdRef.current}/upload-abstract`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        setThesisAbstractUpdated(true);
        setTimeout(() => setThesisAbstractUpdated(false), 3000);
      }
    } catch (e) {
      console.error('In-session abstract upload failed:', e);
    } finally {
      setThesisInSessionUploading(false);
    }
  };

  const startThesisSession = async () => {
    setLatestOfflineRecordingUrl(null);
    unlockBrowserSpeech();
    setThesisStartError(null);

    // Pre-flight: department must be CCIT, CTE, or CBAPA
    const dep = (profile.department || '').trim().toUpperCase();
    if (!dep || !['CCIT', 'CTE', 'CBAPA'].includes(dep)) {
      setThesisStartError(
        `Your department ("${profile.department || 'not set'}") is not eligible for Thesis Defense. ` +
        `Please update your department to CCIT, CTE, or CBAPA in your Profile settings.`
      );
      return;
    }

    if (!thesisAbstractFile) {
      setThesisStartError('Upload a PDF or TXT thesis abstract before starting the defense.');
      return;
    }

    setThesisIsStarting(true);
    setThesisAbstractUploading(true);
    let abstractText = '';
    try {
      abstractText = (await readThesisAbstractFile(thesisAbstractFile)).trim().slice(0, 5000);
      if (!abstractText) throw new Error('The selected abstract did not contain readable text.');
    } catch (error) {
      console.error('Abstract parsing failed:', error);
      setThesisStartError(error instanceof Error ? error.message : 'Failed to read the selected abstract file.');
      setThesisAbstractUploading(false);
      setThesisIsStarting(false);
      return;
    }
    setThesisAbstractUploading(false);

    if (!connectivity.effectiveOnline) {
      setIsCameraEnabled(false);
      restoredEyeContactSummaryRef.current = null;
      thesisSessionIdRef.current = null;
      setThesisSessionId(null);
      thesisConversationLogRef.current = [];
      setThesisConversationLog([]);
      setOnlineInterviewError(null);
      setThesisResult(null);
      setThesisElapsedSeconds(0);
      setTypedInterviewAnswer('');
      setAiResponseText('');
      activeInterviewModeRef.current = 'thesis';
      setActiveTab('thesis-session');
      if (thesisTimerRef.current) clearInterval(thesisTimerRef.current);
      thesisTimerRef.current = setInterval(() => setThesisElapsedSeconds(previous => previous + 1), 1000);
      thesisAbstractTextRef.current = abstractText;
      chatMessagesRef.current = [];
      setChatMessages([]);
      onlinePendingUserTextRef.current = '';
      const checkpoint = await beginActivityCheckpoint({
        type: 'thesis',
        mode: 'offline',
        questionPackVersion: getQuestionPackVersion('thesis'),
      });
      if (!checkpoint) {
        setThesisIsStarting(false);
        setActiveTab('dashboard');
        return;
      }
      const state = await initializeOfflineInterviewState('thesis', {
        text: abstractText,
        sourceName: thesisAbstractFile.name,
      });
      if (!state || !await generateOfflineProfessorTurn('thesis', 0)) {
        setOnlineInterviewError('The offline thesis defense could not be prepared. Your checkpoint remains safely stored.');
      }
      setThesisIsStarting(false);
      return;
    }

    let sid: number | null = null;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/thesis-interview/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        let errMsg = 'Failed to start thesis defense.';
        try {
          const errJson = await response.json();
          errMsg = errJson?.detail || errMsg;
        } catch {
          errMsg = await response.text() || errMsg;
        }
        setThesisStartError(errMsg);
        setThesisIsStarting(false);
        return;
      }
      const data = await response.json();
      sid = data.id;
    } catch (error) {
      console.error('Unable to start Thesis Interview.', error);
      setThesisStartError('The thesis defense could not be started. Check your connection and try again.');
      setThesisIsStarting(false);
      return;
    }

    if (sid) {
      setIsCameraEnabled(false);
      restoredEyeContactSummaryRef.current = null;
      thesisSessionIdRef.current = sid;
      setThesisSessionId(sid);

      setThesisConversationLog([]);
      thesisConversationLogRef.current = [];
      setOnlineInterviewError(null);
      setThesisResult(null);
      setThesisElapsedSeconds(0);
      activeInterviewModeRef.current = 'thesis';
      setActiveTab('thesis-session');
      if (thesisTimerRef.current) clearInterval(thesisTimerRef.current);
      thesisTimerRef.current = setInterval(() => setThesisElapsedSeconds(prev => prev + 1), 1000);

      thesisAbstractTextRef.current = abstractText.substring(0, 5000);
      setTypedInterviewAnswer('');
      chatMessagesRef.current = [];
      setChatMessages([]);
      onlinePendingUserTextRef.current = '';
      beginActivityCheckpoint({ type: 'thesis', serverSessionId: sid });
      beginOnlineInterviewResponse('thesis', false);
      void connectOnlineInterview('thesis', sid, 'start').catch(error => {
        setOnlineInterviewError(error instanceof Error ? error.message : 'Unable to connect to the thesis AI.');
        setCanRetryOnlineResponse(true);
      });
      setThesisIsStarting(false);
    }
  };

  const exitThesisSession = () => {
    setLatestOfflineRecordingUrl(null);
    const shouldReleaseOfflineEngine = activeActivityCheckpointRef.current?.type === 'thesis'
      && readOfflineInterviewActivityState(activeActivityCheckpointRef.current)?.offlineEngine === 'webllm';
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    cancelSpeechInput();
    if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
    setThesisIsLeaveModalOpen(false);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
    setThesisSessionId(null);
    thesisSessionIdRef.current = null;
    setThesisConversationLog([]);
    setThesisResult(null);
    setIsCameraEnabled(false);
    restoredEyeContactSummaryRef.current = null;
    setTypedInterviewAnswer('');
    setThesisAbstractFile(null);
    setThesisElapsedSeconds(0);
    setAiResponseText('');
    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    thesisAbstractTextRef.current = '';
    onlinePendingUserTextRef.current = '';
    activeInterviewModeRef.current = null;
    if (thesisWsRef.current) { thesisWsRef.current.close(); thesisWsRef.current = null; }
    if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current.src = ''; }
    if (activeActivityCheckpointRef.current?.type === 'thesis') {
      endActivityCheckpoint('abandoned');
    }
    if (shouldReleaseOfflineEngine) {
      offlineWebLLMEngineRef.current = null;
      void releaseWebLLM().catch(error => console.warn('Unable to release local thesis AI.', error));
    }
    nextPlayTimeRef.current = 0;
    fetchThesisHistory();
    setActiveTab('dashboard');
  };

  const finishThesisSession = async () => {
    const activeCheckpoint = activeActivityCheckpointRef.current;
    if (activeCheckpoint?.type === 'thesis' && activeCheckpoint.mode === 'offline') {
      if (activeCheckpoint.responseCount !== OFFLINE_INTERVIEW_RESPONSE_LIMIT) return;
      setThesisIsFinishing(true);
      const eyeContactSummary = getCheckpointEyeContactSummary();
      const provisional = evaluateOfflineInterview(
        'thesis',
        activeCheckpoint.conversationLog,
        eyeContactSummary,
      );
      const evaluated = await updateActivityCheckpoint({
        eyeContactSummary,
        localEvaluation: provisional.evaluation as unknown as Record<string, unknown>,
        localScore: null,
        pendingEvaluation: provisional.pendingEvaluation,
        evaluationAuthority: 'local_provisional',
      });
      const completed = evaluated && await endActivityCheckpoint('completed_local');
      setThesisIsFinishing(false);
      if (!completed) {
        setOnlineInterviewError('The provisional thesis result could not be saved safely. Please retry completion.');
        return;
      }
      offlineWebLLMEngineRef.current = null;
      await releaseWebLLM().catch(error => console.warn('Unable to release local thesis AI.', error));
      exitThesisSession();
      return;
    }
    if (!thesisSessionIdRef.current) return;
    if (!authenticatedUserIdRef.current) {
      alert('Your account could not be verified. Please sign in again before saving this thesis session.');
      return;
    }
    setThesisIsFinishing(true);
    setOnlineInterviewError(null);
    setCanRetryOnlineResponse(false);
    try {
      const cameraMetrics = {
        eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
        eye_contact_samples: eyeTracker.samples,
      };
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/thesis-interview/${thesisSessionIdRef.current}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ conversation: thesisConversationLog, evaluation: cameraMetrics })
      });
      if (response.ok) {
        const data = await response.json();
        setThesisResult(data);
        setOnlineInterviewError(null);
        endActivityCheckpoint('cloud_completed');
        cancelSpeechInput();
        setThesisIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        const detail = await response.json().catch(() => null);
        setOnlineInterviewError(detail?.detail || 'The thesis defense could not be graded. Please try again.');
      }
    } catch (error) {
      console.error('Thesis validation request failed.', error);
      setOnlineInterviewError('The thesis defense could not be graded. Check your connection and try again.');
    } finally {
      setThesisIsFinishing(false);
      fetchThesisHistory();
    }
  };

  const showOfflineRecordingPreview = (capture: { blob: Blob }) => {
    setLatestOfflineRecordingUrl(previousUrl => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return URL.createObjectURL(capture.blob);
    });
  };

  const attachInterviewWaveform = (stream: MediaStream) => {
    userMediaStreamRef.current = stream;
    const context = new AudioContext();
    userAudioContextRef.current = context;
    userAnalyserRef.current = context.createAnalyser();
    userAnalyserRef.current.fftSize = 64;
    context.createMediaStreamSource(stream).connect(userAnalyserRef.current);
    const startWaveform = () => updateUserAudioData();
    if (context.state === 'suspended') void context.resume().then(startWaveform);
    else startWaveform();
  };

  const toggleListening = async () => {
    if (isMicTransitioning) return;
    if (isListeningRef.current) {
      isListeningRef.current = false;
      stopSpeechInput();
      return;
    }
    if (isAiSpeakingRef.current || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
      setInterviewMicFeedback('Wait for Professor Maxiel to finish speaking before starting your answer.');
      return;
    }

    const current = activeActivityCheckpointRef.current;
    if (!current) return;
    setInterviewMicFeedback(null);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationRef.current);
    setAudioData(new Array(15).fill(20));
    if (audioPlayerRef.current) audioPlayerRef.current.pause();
    audioQueueRef.current = [];

    const answerIndex = current.responseCount + 1;
    const started = await startSpeechInput(
      transcript => {
        onlinePendingUserTextRef.current = '';
        void submitInterviewAnswer(transcript);
      },
      setInterviewMicFeedback,
      current.mode === 'offline' ? {
        enabled: true,
        activityType: current.type,
        turnId: `${current.type}-answer-${answerIndex}`,
        answerIndex,
        persistAudio: persistOfflineAudioCapture,
        onAudioCaptured: showOfflineRecordingPreview,
      } : undefined,
      {
        onStreamReady: attachInterviewWaveform,
        onStreamReleased: releaseInterviewMicrophone,
      },
    );
    isListeningRef.current = started;
  };

  const continueCurrentActivityOffline = async () => {
    const current = activeActivityCheckpointRef.current;
    if (!current) return;
    if (current.mode === 'offline') {
      setShowConnectionLossPrompt(false);
      return;
    }

    const offlineCheckpoint = mergeActivityCheckpoint(current, {
      mode: 'offline',
      status: 'in_progress',
      questionPackVersion: current.questionPackVersion || getQuestionPackVersion(current.type),
      currentQuestion: onlineResponseBufferRef.current.trim()
        || aiResponseText.trim()
        || current.currentQuestion,
      lastError: connectivity.connectionState === 'offline'
        ? 'Device network unavailable.'
        : 'Career Edge backend unavailable.',
      eyeContactSummary: current.type === 'upcoming' || current.type === 'thesis'
        ? getCheckpointEyeContactSummary()
        : current.eyeContactSummary,
    });
    const checkpointSaved = await persistActivityCheckpoint(offlineCheckpoint);
    if (!checkpointSaved) return;

    activeActivityCheckpointRef.current = offlineCheckpoint;
    setActiveActivityCheckpoint(offlineCheckpoint);
    setShowConnectionLossPrompt(false);

    if (
      (offlineCheckpoint.type === 'upcoming' || offlineCheckpoint.type === 'thesis')
      && isListeningRef.current
    ) {
      try {
        const answerIndex = offlineCheckpoint.responseCount + 1;
        const recordingStarted = await enableOfflineSpeechRecording({
          enabled: true,
          activityType: offlineCheckpoint.type,
          turnId: `${offlineCheckpoint.type}-answer-${answerIndex}`,
          answerIndex,
          persistAudio: persistOfflineAudioCapture,
          onAudioCaptured: showOfflineRecordingPreview,
        });
        if (!recordingStarted) throw new Error('MediaRecorder is unavailable.');
        setInterviewMicFeedback('Offline mode is active. Your current response is now being recorded locally.');
      } catch (error) {
        setInterviewMicFeedback(
          error instanceof Error
            ? `${error.message} Your recognized text remains available; you can also type the answer.`
            : 'Local audio recording could not start. Your recognized text remains available; you can also type the answer.',
        );
      }
    }

    if (offlineCheckpoint.type === 'upcoming') {
      wsRef.current?.close(1000, 'Activity locked offline.');
      wsRef.current = null;
    } else if (offlineCheckpoint.type === 'thesis') {
      thesisWsRef.current?.close(1000, 'Activity locked offline.');
      thesisWsRef.current = null;
    }

    if (offlineCheckpoint.type === 'upcoming' || offlineCheckpoint.type === 'thesis') {
      const type = offlineCheckpoint.type;
      const state = await initializeOfflineInterviewState(type, type === 'thesis' ? {
        text: thesisAbstractTextRef.current,
        sourceName: thesisAbstractFile?.name,
      } : undefined);
      if (!state) {
        setOnlineInterviewError('Offline mode is locked, but the local interview engine could not be prepared. Retry without leaving this page.');
        return;
      }
      setOnlineInterviewError(
        state.offlineEngine === 'webllm'
          ? 'Offline mode is locked. Cached local AI will continue this activity.'
          : 'Offline mode is locked. Deterministic local questions will continue this activity.',
      );
      const latest = activeActivityCheckpointRef.current?.conversationLog.at(-1);
      if (latest?.sender === 'user') {
        await generateOfflineProfessorTurn(type, offlineCheckpoint.responseCount);
      } else if (offlineCheckpoint.currentQuestion) {
        setAiResponseText(offlineCheckpoint.currentQuestion);
      }
    }
  };

  const retryCurrentConnection = async () => {
    const reachable = await connectivity.retryConnection();
    if (reachable) setShowConnectionLossPrompt(false);
  };

  const leaveActivityAfterConnectionLoss = () => {
    const type = activeActivityCheckpointRef.current?.type;
    if (type === 'upcoming') {
      exitInterview();
      return;
    }
    if (type === 'thesis') {
      exitThesisSession();
      return;
    }
    endActivityCheckpoint('abandoned');
    setIsModuleSessionMode(false);
    setActiveTab('dashboard');
  };

  const resumeOwnedOfflineActivity = async () => {
    const resumable = resumableOfflineSession;
    if (!resumable || resumable.userId !== authenticatedUserIdRef.current) return;
    if (!hasCurrentQuestionPack(resumable.type, resumable.questionPackVersion)) {
      setOfflineFoundationError(
        'This saved offline activity uses an older question version. It has been preserved and cannot be resumed automatically.',
      );
      return;
    }
    activeActivityCheckpointRef.current = resumable;
    setActiveActivityCheckpoint(resumable);
    setIsModuleSessionMode(true);
    if (resumable.type === 'post_test') setActiveTab('post-test');
    else if (resumable.type === 'drill') setActiveTab('drills');
    else if (resumable.type === 'pre_test_intro' || resumable.type === 'pre_test_active_listening') setActiveTab('pre-test');
    else if (resumable.type === 'upcoming' || resumable.type === 'thesis') {
      setIsModuleSessionMode(false);
      const type = resumable.type;
      const mode: OnlineInterviewMode = type === 'thesis' ? 'thesis' : 'enrollment';
      const state = readOfflineInterviewActivityState(resumable);
      if (!state) {
        setOfflineFoundationError('This saved interview is missing its offline-engine state. It has been preserved and cannot be resumed automatically.');
        activeActivityCheckpointRef.current = null;
        setActiveActivityCheckpoint(null);
        return;
      }
      restoredEyeContactSummaryRef.current = resumable.eyeContactSummary;
      activeInterviewModeRef.current = mode;
      setTypedInterviewAnswer('');
      setOnlineInterviewError(null);
      setCanRetryOnlineResponse(false);
      setAiResponseText(resumable.currentQuestion);
      setChatMessages(resumable.conversationLog.map(turn => ({
        role: turn.sender === 'ai' ? 'assistant' : 'user',
        content: turn.text,
      })));
      chatMessagesRef.current = resumable.conversationLog.map(turn => ({
        role: turn.sender === 'ai' ? 'assistant' : 'user',
        content: turn.text,
      }));
      if (type === 'thesis') {
        thesisSessionIdRef.current = resumable.serverSessionId;
        setThesisSessionId(resumable.serverSessionId);
        thesisConversationLogRef.current = resumable.conversationLog;
        setThesisConversationLog(resumable.conversationLog);
        thesisAbstractTextRef.current = state.thesisAbstractContext || '';
        setThesisElapsedSeconds(Math.max(0, Math.floor((Date.now() - resumable.startedAt) / 1000)));
        if (thesisTimerRef.current) clearInterval(thesisTimerRef.current);
        thesisTimerRef.current = setInterval(() => setThesisElapsedSeconds(previous => previous + 1), 1000);
        setActiveTab('thesis-session');
      } else {
        sessionIdRef.current = resumable.serverSessionId;
        setSessionId(resumable.serverSessionId);
        conversationLogRef.current = resumable.conversationLog;
        setConversationLog(resumable.conversationLog);
        setIsEnrollmentFinalProfessorTurnReady(
          resumable.responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT
          && resumable.conversationLog.at(-1)?.sender === 'ai',
        );
        setIsProfessorFirstFrameReady(false);
        setActiveTab('interview-session');
      }
      const initializedState = await initializeOfflineInterviewState(type, type === 'thesis' ? {
        text: state.thesisAbstractContext || '',
        sourceName: state.thesisAbstractSourceName,
      } : undefined);
      if (!initializedState) {
        setOnlineInterviewError('The offline interview engine could not be restored. Your checkpoint remains saved.');
        return;
      }
      const latest = activeActivityCheckpointRef.current?.conversationLog.at(-1);
      if (latest?.sender === 'user') {
        await generateOfflineProfessorTurn(type, resumable.responseCount);
      }
    }
  };

  const companyTypes = [
    { value: 'tech-startup', label: 'Tech Startup' },
    { value: 'faang', label: 'FAANG / Big Tech' },
    { value: 'finance', label: 'Finance / Fintech' },
    { value: 'agency', label: 'Agency / Consulting' },
    { value: 'healthcare', label: 'Healthcare / Healthtech' },
    { value: 'ecommerce', label: 'E-commerce' },
    { value: 'other', label: 'Other' },
  ];

  const enrollmentResponseCount = conversationLog.filter(message => message.sender === 'user').length;
  const enrollmentInstruction = isFinishingInterview
    ? activeActivityCheckpoint?.mode === 'offline'
      ? 'Saving your provisional interview result locally...'
      : 'Validating your responses and preparing your interview result...'
    : enrollmentResponseCount >= 5 && isEnrollmentFinalProfessorTurnReady
      ? 'All five responses are recorded. Click “Validate Responses” in the transcript panel to receive your result.'
      : enrollmentResponseCount >= 5
        ? 'Professor Maxiel is finishing the interview. Validation will be available after the closing response.'
      : isMicTransitioning
        ? 'Submitting your response. Please wait for Professor Maxiel’s next question.'
        : interviewMicFeedback
          ? interviewMicFeedback
          : isListening
            ? 'Your microphone is recording. When you finish speaking, click the microphone again to submit your response.'
            : isAiSpeaking
              ? 'Listen carefully to Professor Maxiel. When the question ends, click the microphone to start your response.'
              : 'Click the microphone to start answering. After speaking, click it again to stop and submit your response.';

  const renderOfflineInterviewInput = (type: OfflineInterviewKind) => {
    const checkpoint = activeActivityCheckpoint;
    if (!checkpoint || checkpoint.type !== type || checkpoint.mode !== 'offline') return null;
    const answersComplete = checkpoint.responseCount >= OFFLINE_INTERVIEW_RESPONSE_LIMIT;
    const isThesis = type === 'thesis';
    return (
      <div className={`mb-3 rounded-lg border p-3 ${isThesis ? 'border-slate-700 bg-slate-900' : 'border-[var(--interview-border)] bg-[var(--interview-card)]'}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="program-accent-on-dark text-[10px] font-bold uppercase tracking-wider">
            Offline · {readOfflineInterviewActivityState(checkpoint)?.offlineEngine === 'webllm' ? 'Cached Local AI' : 'Fallback Questions'}
          </span>
          <button
            type="button"
            onClick={() => void repeatStoredOfflineQuestion()}
            disabled={!checkpoint.currentQuestion || isAiSpeaking}
            className={`text-[10px] font-bold underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isThesis ? 'text-slate-400' : 'text-[var(--interview-text-secondary)]'}`}
          >
            Repeat question
          </button>
        </div>
        {isThesis && checkpoint.currentQuestion && (
          <p className="mb-2 text-xs leading-relaxed text-slate-100">
            {checkpoint.currentQuestion}
          </p>
        )}
        <form onSubmit={submitTypedInterviewAnswer} className="flex gap-2">
          <input
            type="text"
            value={typedInterviewAnswer}
            onChange={event => setTypedInterviewAnswer(event.target.value)}
            disabled={answersComplete || isSubmittingOfflineAnswer || isAiSpeaking}
            placeholder={answersComplete ? 'All five responses are recorded' : 'Type an answer if microphone input is unavailable'}
            aria-label="Typed offline interview answer"
            className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:border-[var(--program-accent-on-dark)] disabled:opacity-60 ${isThesis ? 'border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500' : 'border-[var(--interview-border)] bg-[var(--interview-elevated)] text-[var(--interview-text-primary)] placeholder:text-[var(--interview-text-muted)]'}`}
          />
          <button
            type="submit"
            disabled={!typedInterviewAnswer.trim() || answersComplete || isSubmittingOfflineAnswer || isAiSpeaking}
            className="program-accent-interview-active flex h-9 w-9 shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
            title="Submit typed answer"
            aria-label="Submit typed answer"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        {latestOfflineRecordingUrl && (
          <audio
            className="mt-2 h-8 w-full"
            controls
            preload="metadata"
            src={latestOfflineRecordingUrl}
            aria-label="Review your most recent offline recording"
          />
        )}
      </div>
    );
  };

  const syncingSessions = syncQueueSessions.filter(session => session.status === 'syncing');
  const failedSyncSession = syncQueueSessions.find(session => session.status === 'sync_failed');
  const queuedSyncSessions = syncQueueSessions.filter(session => session.status === 'pending_sync');

  return (
    <>
      <ProfessorAssetErrorBoundary
        key={professorAssetLoadAttempt}
        onError={handleProfessorAssetError}
      >
        <React.Suspense fallback={null}>
          <ProfessorModelPreloader onReady={handleProfessorAssetReady} />
        </React.Suspense>
      </ProfessorAssetErrorBoundary>
      {connectivity.connectionState !== 'online' && (
        <div className="fixed right-4 top-4 z-[9997] rounded-lg border border-amber-400/40 bg-slate-950/95 px-4 py-3 text-xs text-amber-100 shadow-xl">
          <p className="font-bold">
            {connectivity.connectionState === 'offline'
              ? 'Device offline'
              : connectivity.connectionState === 'degraded'
                ? 'Career Edge cloud unavailable'
                : 'Checking cloud connection…'}
          </p>
          <p className="mt-1 text-slate-300">Cloud activities require both network and backend availability.</p>
        </div>
      )}
      {connectionRestoredNotice && activeActivityCheckpoint?.mode === 'offline' && (
        <div className="fixed right-4 top-24 z-[9997] max-w-sm rounded-lg border border-emerald-400/40 bg-slate-950/95 px-4 py-3 text-xs text-emerald-100 shadow-xl">
          <p>Connection restored. This activity remains offline and will be eligible for sync after local completion.</p>
          <button type="button" onClick={() => setConnectionRestoredNotice(false)} className="mt-2 font-bold underline">Dismiss</button>
        </div>
      )}
      {offlineFoundationError && (
        <div className="fixed bottom-4 right-4 z-[9997] max-w-sm rounded-lg border border-rose-400/40 bg-slate-950/95 px-4 py-3 text-xs text-rose-100 shadow-xl">
          {offlineFoundationError}
        </div>
      )}
      {!activeActivityCheckpoint && resumableOfflineSession && activeTab === 'dashboard' && (
        <div className="fixed bottom-4 left-1/2 z-[9996] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-400/30 bg-slate-950/95 px-4 py-3 text-xs text-amber-100 shadow-xl">
          <span>An unfinished offline {resumableOfflineSession.type.replace(/_/g, ' ')} activity is safely stored for this account.</span>
          {['pre_test_intro', 'pre_test_active_listening', 'post_test', 'drill'].includes(resumableOfflineSession.type) && (
            <button type="button" onClick={resumeOwnedOfflineActivity} className="rounded-md border border-amber-300/50 px-3 py-1.5 font-bold hover:bg-amber-300/10">Resume</button>
          )}
        </div>
      )}
      {!activeActivityCheckpoint && pendingSyncCount > 0 && activeTab === 'dashboard' && (
        <div className="fixed bottom-4 right-4 z-[9996] max-w-sm rounded-lg border border-sky-400/30 bg-slate-950/95 px-4 py-3 text-xs text-sky-100 shadow-xl">
          <p className="font-bold">
            {syncingSessions.length > 0
              ? `Syncing ${syncingSessions.length} saved ${syncingSessions.length === 1 ? 'activity' : 'activities'}...`
              : failedSyncSession
                ? 'Sync Failed'
                : `${queuedSyncSessions.length} ${queuedSyncSessions.length === 1 ? 'activity' : 'activities'} Pending Sync`}
          </p>
          {failedSyncSession ? (
            <>
              <p className="mt-1 text-slate-300">{failedSyncSession.lastError || 'Your saved activity remains safely stored on this device.'}</p>
              <button
                type="button"
                onClick={() => void retryFailedSync(failedSyncSession)}
                disabled={!connectivity.effectiveOnline || syncingSessions.length > 0}
                className="mt-2 rounded-md border border-sky-300/50 px-3 py-1.5 font-bold hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry Sync
              </button>
            </>
          ) : (
            <p className="mt-1 text-slate-300">
              {syncingSessions.length > 0
                ? 'Your local copy will be retained after authoritative synchronization.'
                : 'Synchronization will begin when the Career Edge cloud is available.'}
            </p>
          )}
        </div>
      )}
      {!activeActivityCheckpoint && pendingSyncCount === 0 && lastSyncNotice && activeTab === 'dashboard' && (
        <div className="fixed bottom-4 right-4 z-[9996] flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-slate-950/95 px-4 py-3 text-xs text-emerald-100 shadow-xl">
          <span className="font-bold">{lastSyncNotice}</span>
          <button type="button" onClick={() => setLastSyncNotice(null)} className="underline">Dismiss</button>
        </div>
      )}
      {showConnectionLossPrompt && activeActivityCheckpoint?.mode === 'online' && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
            <h2 className="text-xl font-bold">Connection lost</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Your current question, transcript, response count, and camera summary are being preserved. Choose how to continue.
            </p>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => void continueCurrentActivityOffline()} className="program-accent-button rounded-xl px-4 py-3 text-sm font-bold">
                Continue Offline
              </button>
              <button type="button" onClick={() => void retryCurrentConnection()} className="rounded-xl border border-slate-600 px-4 py-3 text-sm font-bold hover:bg-slate-800">
                Retry Connection
              </button>
              <button type="button" onClick={leaveActivityAfterConnectionLoss} className="rounded-xl px-4 py-3 text-sm font-bold text-rose-300 hover:bg-rose-500/10">
                Leave Activity
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className={`dashboard-shell dashboard-theme-${appTheme} min-h-screen bg-page text-ink flex overflow-hidden`}
        style={programAccentStyle}
      >
        {/* Sidebar */}
        {!isModuleSessionMode && activeTab !== 'interview-type' && activeTab !== 'university-setup' && activeTab !== 'new-interview' && activeTab !== 'interview-session' && activeTab !== 'thesis-setup' && activeTab !== 'thesis-session' && (
          <aside className="w-72 bg-card border-r border-line flex flex-col h-screen shrink-0">
            {/* Logo Area */}
            <div className="h-16 px-3 border-b border-line flex items-center shrink-0">
              <span className="font-bold text-xl tracking-tight text-gold-text">Career Edge</span>
            </div>

            {/* Main Action */}
            <div className="shrink-0 border-b border-line px-2 pb-3 pt-4">
              {['CCIT', 'CTE', 'CBAPA'].includes(profile.department?.toUpperCase() || '') ? (
                <button
                  onClick={() => {
                    setSelectedCompanyType('');
                    setPosition('');
                    setActiveTab('interview-type');
                  }}
                  className="program-accent-button w-full py-2 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Start Interview
                </button>
              ) : (
                <div className="w-full relative group">
                  <button
                    disabled
                    className="w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50 transition-colors"
                  >
                    <Lock className="w-4 h-4 text-slate-500" />
                    Locked
                  </button>
                  {/* Tooltip */}
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 px-3 py-2 bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl z-50">
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 border-b border-r border-slate-700 rotate-45 -mt-1" />
                    Only available to CCIT, CTE, and CBAPA students
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <LayoutDashboard className="w-5 h-5" />
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('pre-test')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'pre-test' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <BookOpen className="w-5 h-5" />
                Pre-Test
              </button>
              <button
                onClick={() => setActiveTab('drills')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'drills' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <Clock className="w-5 h-5" />
                Drills
              </button>
              <button
                onClick={() => setActiveTab('post-test')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'post-test' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <ClipboardCheck className="w-5 h-5" />
                Post-Test
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'history' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <Video className="w-5 h-5" />
                Interview Practice
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg font-medium transition-colors ${activeTab === 'analytics' ? 'bg-active text-ink' : 'text-muted hover:bg-active hover:text-ink'}`}
              >
                <BarChart2 className="w-5 h-5" />
                Progress
              </button>
            </nav>

            {/* Account */}
            <div ref={accountMenuRef} className="relative p-2 border-t border-line">
              {isAccountMenuOpen && (
                <div
                  id="sidebar-account-menu"
                  role="menu"
                  aria-label="Account menu"
                  className="absolute left-2 right-2 bottom-full z-50 mb-2 rounded-lg border border-line bg-card p-1.5 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveTab('profile');
                      setIsAccountMenuOpen(false);
                    }}
                    className="program-accent-focus-ring flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-active"
                  >
                    <User className="h-4 w-4 shrink-0" />
                    View Profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveTab('settings');
                      setIsAccountMenuOpen(false);
                    }}
                    className="program-accent-focus-ring flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-active"
                  >
                    <Settings className="h-4 w-4 shrink-0" />
                    Settings
                  </button>
                  <div className="my-1 border-t border-line" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      onLogout();
                    }}
                    className="program-accent-focus-ring flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-active"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    Sign Out
                  </button>
                </div>
              )}

              <button
                ref={accountTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={isAccountMenuOpen}
                aria-controls="sidebar-account-menu"
                onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
                className={`program-accent-focus-ring flex w-full items-center gap-3 rounded-lg border border-line p-2 text-left transition-colors duration-200 ${
                  ['profile', 'settings', 'support', 'privacy'].includes(activeTab) || isAccountMenuOpen ? 'bg-active' : 'bg-transparent hover:bg-active'
                }`}
              >
                <ProfileAvatar
                  name={profile.name}
                  imageUrl={profile.profilePicture}
                  className="program-accent-border h-10 w-10 shrink-0 overflow-hidden rounded-full border"
                  initialClassName="text-sm"
                />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <h3 className="truncate text-sm font-semibold text-ink" title={profile.name}>{profile.name}</h3>
                  <p className="text-program-accent mt-0.5 truncate text-xs font-semibold" title={profile.department}>{profile.department}</p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-ink/70 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <main className="min-w-0 flex-1 flex flex-col h-screen overflow-hidden">
          {/* Scrollable Content */}
          <div
            className={
              activeTab === 'interview-session'
                ? "flex-1 overflow-hidden"
                : isModuleSessionMode
                  ? "flex-1 overflow-y-auto bg-page"
                  : "flex-1 overflow-y-auto px-4 pb-3 pt-6 sm:px-8 md:pb-4 md:pt-8 lg:px-10"
            }
            style={activeTab === 'interview-session' ? { backgroundColor: '#02040a' } : undefined}
          >

            {activeTab === 'dashboard' && (
              <div className="w-full">
                {/* Page Title */}
                <div className="mb-6">
                  <h1 className="text-4xl md:text-5xl font-bold text-ink tracking-tight">
                    {isNewSignupSession ? 'Welcome to Career Edge, ' : 'Welcome back, '}
                    <span className="text-program-accent">{profile.name.split(' ')[0]}</span>
                  </h1>
                  <p className="text-lg md:text-xl font-medium text-muted mt-1.5">Here's an overview of your interview progress.</p>
                </div>

                {renderStatCards()}

                {/* History List */}
                <div className="mt-5 w-full space-y-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-bold text-ink italic tracking-tight">Recent Sessions</h2>
                    {interviewHistory.length > 5 && (
                      <button
                        onClick={() => setActiveTab('history')}
                        className="program-accent-link text-xs font-bold transition-colors uppercase tracking-widest"
                      >
                        View All
                      </button>
                    )}
                  </div>

                  {interviewHistory.filter(item => (item.total_score || 0) > 0).length === 0 ? (
                    <div className="bg-card border border-line rounded-lg px-3 py-8 md:py-10 text-center">
                      <p className="text-muted text-sm">No interviews completed yet.</p>
                      <button onClick={() => setActiveTab('interview-type')} className="program-accent-link mt-2 text-sm font-bold hover:underline">Start your first interview</button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {interviewHistory.filter(item => (item.total_score || 0) > 0).slice(0, 5).map((item, i, filteredList) => (
                        <motion.div
                          key={item.id || i}
                          onClick={() => {
                            setInterviewResult(item);
                            setPrevTab(activeTab);
                            setActiveTab('interview-result');
                          }}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + (i * 0.05) }}
                          className="program-accent-hover-border bg-card border border-line rounded-lg p-3 flex items-center justify-between hover:bg-active transition-colors cursor-pointer group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="group-hover-program-accent-surface w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 transition-all">
                              <Video className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="group-hover-program-accent-text font-bold text-sm text-ink transition-colors">Interview #{filteredList.length - i}</h4>
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider">{new Date(item.start_time).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <span className={`text-lg font-black ${item.total_score >= 70 ? 'text-success' : 'text-rose-700'}`}>{item.total_score || 0}%</span>
                            </div>
                            <ChevronRight className="group-hover-program-accent-text w-4 h-4 text-slate-600 group-hover:translate-x-1 transition-all" />
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'pre-test' && (
              <PreTestPage
                apiUrl={API_URL}
                onSessionModeChange={setIsModuleSessionMode}
                effectiveOnline={connectivity.effectiveOnline}
                sessionMode={activeActivityCheckpoint?.type === 'pre_test_intro' || activeActivityCheckpoint?.type === 'pre_test_active_listening' ? activeActivityCheckpoint.mode : 'online'}
                resumeSession={activeActivityCheckpoint?.type === 'pre_test_intro' || activeActivityCheckpoint?.type === 'pre_test_active_listening' ? activeActivityCheckpoint : null}
                onActivityStart={beginActivityCheckpoint}
                onActivityCheckpoint={updateActivityCheckpoint}
                onActivityEnd={endActivityCheckpoint}
                onOfflineAudioCaptured={persistOfflineAudioCapture}
              />
            )}

            {activeTab === 'drills' && (
              <DrillsPage
                apiUrl={API_URL}
                onSessionModeChange={setIsModuleSessionMode}
                effectiveOnline={connectivity.effectiveOnline}
                sessionMode={getActiveActivityMode('drill')}
                resumeSession={activeActivityCheckpoint?.type === 'drill' ? activeActivityCheckpoint : null}
                onActivityStart={beginActivityCheckpoint}
                onActivityCheckpoint={updateActivityCheckpoint}
                onActivityEnd={endActivityCheckpoint}
                onOfflineAudioCaptured={persistOfflineAudioCapture}
              />
            )}

            {activeTab === 'post-test' && (
              <PostTestPage
                apiUrl={API_URL}
                onSessionModeChange={setIsModuleSessionMode}
                effectiveOnline={connectivity.effectiveOnline}
                sessionMode={getActiveActivityMode('post_test')}
                resumeSession={activeActivityCheckpoint?.type === 'post_test' ? activeActivityCheckpoint : null}
                userDepartment={profile.department}
                onActivityStart={beginActivityCheckpoint}
                onActivityCheckpoint={updateActivityCheckpoint}
                onActivityEnd={endActivityCheckpoint}
                onOfflineAudioCaptured={persistOfflineAudioCapture}
              />
            )}

            {activeTab === 'interview-type' && (
              <div className="relative h-full">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="absolute top-0 left-0 flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-4xl mx-auto space-y-8 pt-12"
                >
                  <div className="text-center">
                    <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Choose Interview Type</h1>
                    <p className="text-lg text-slate-400 mt-2">Select the type of interview you want to practice.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 items-stretch">
                    <button
                      onClick={startInterviewSession}
                      disabled={isStartingInterview}
                      className="program-accent-hover-border bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-300 group h-full"
                    >
                      <div className="program-accent-surface w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <GraduationCap className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-200 mb-2">University Enrollment</h3>
                      <p className="text-slate-400 text-sm">PRMSU CASTI entrance interview practice.</p>
                      {isStartingInterview && (
                        <p className="program-accent-on-dark mt-3 text-xs font-semibold">Preparing Professor Maxiel...</p>
                      )}
                      {professorAssetStatus === 'error' && !isStartingInterview && (
                        <p className="mt-3 text-xs font-semibold text-rose-400">Unable to load Professor Maxiel. Select to retry.</p>
                      )}
                    </button>

                    <button
                      onClick={() => { setThesisAbstractFile(null); setActiveTab('thesis-setup'); }}
                      className="bg-slate-900 border border-slate-800 hover:border-purple-500 hover:ring-1 hover:ring-purple-500 rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-300 group h-full"
                    >
                      <div className="w-16 h-16 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Shield className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-200 mb-2">Thesis Defense</h3>
                      <p className="text-slate-400 text-sm">Simulate a formal thesis panel defense with AI. Upload your abstract for targeted questions.</p>
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {activeTab === 'new-interview' && (
              <div className="relative h-full">
                <button
                  onClick={() => setActiveTab('interview-type')}
                  className="absolute top-0 left-0 flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-3xl mx-auto space-y-8 pt-12"
                >
                  <div>
                    <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Let's get started</h1>
                    <p className="text-lg text-slate-400 mt-2">Tell us a bit about the role you're practicing for.</p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-8">
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-300">What type of company?</label>
                      <div className="relative group">
                        <div
                          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                          className={`w-full bg-slate-950 border ${isDropdownOpen ? 'program-accent-border' : 'border-slate-800 hover:border-slate-700 hover:shadow-md hover:shadow-black/20'} rounded-xl px-4 py-3 pr-10 transition-all duration-300 cursor-pointer flex items-center justify-between`}
                        >
                          <span className={`truncate ${!selectedCompanyType ? 'text-slate-500' : 'text-slate-200'}`}>
                            {selectedCompanyType ? companyTypes.find(t => t.value === selectedCompanyType)?.label : 'Select company type...'}
                          </span>
                          <ChevronDown className={`group-hover-program-accent-text absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-all duration-300 pointer-events-none ${isDropdownOpen ? 'rotate-180 text-program-accent' : ''}`} />
                        </div>

                        {/* Dropdown Menu */}
                        <motion.div
                          initial={{ opacity: 0, y: -10, scaleY: 0.95 }}
                          animate={{
                            opacity: isDropdownOpen ? 1 : 0,
                            y: isDropdownOpen ? 0 : -10,
                            scaleY: isDropdownOpen ? 1 : 0.95
                          }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className={`absolute z-10 w-full mt-2 bg-slate-900 border border-slate-800 rounded-xl shadow-xl shadow-black/40 overflow-hidden origin-top ${isDropdownOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
                        >
                          <div className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
                            {companyTypes.map((type) => (
                              <div
                                key={type.value}
                                onClick={() => {
                                  setSelectedCompanyType(type.value);
                                  setIsDropdownOpen(false);
                                }}
                                className={`px-4 py-3 cursor-pointer transition-colors duration-200 flex items-center ${selectedCompanyType === type.value
                                  ? 'program-accent-surface font-medium'
                                  : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                                  }`}
                              >
                                {type.label}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      </div>
                      <p className="text-xs text-slate-500">This helps our AI tailor the interview questions to the company's culture and expectations.</p>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-300">What position?</label>
                      <input
                        type="text"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        placeholder="e.g. Senior Frontend Engineer, Product Manager..."
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 hover:shadow-md hover:shadow-black/20 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                      />
                      <p className="text-xs text-slate-500">The AI will ask technical and behavioral questions specific to this role.</p>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <button
                      onClick={startInterviewSession}
                      disabled={isStartingInterview}
                      className={`program-accent-button px-8 py-4 rounded-xl font-semibold flex items-center gap-2 transition-colors shadow-lg text-lg ${isStartingInterview ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      {isStartingInterview
                        ? 'Preparing interview...'
                        : professorAssetStatus === 'error'
                          ? 'Retry Professor'
                          : 'Continue'}
                      {!isStartingInterview && professorAssetStatus !== 'error' && <ArrowRight className="w-5 h-5" />}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {activeTab === 'thesis-setup' && (
              <div className="relative h-full">
                <button
                  onClick={() => { setThesisAbstractFile(null); setActiveTab('interview-type'); }}
                  className="absolute top-0 left-0 flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-2xl mx-auto space-y-8 pt-12"
                >
                  <div className="text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-bold mb-4">
                      <Shield className="w-4 h-4" />
                      {profile.department?.toUpperCase() || 'No Department'} Thesis Defense
                    </div>
                    <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Defense Setup</h1>
                    <p className="text-lg text-slate-400 mt-2">Optionally upload your thesis abstract to give the AI panel targeted context.</p>
                  </div>

                  {/* Inline error banner */}
                  {thesisStartError && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-rose-400 text-xs font-black">!</span>
                      </div>
                      <p className="text-sm text-rose-300 leading-relaxed">{thesisStartError}</p>
                    </div>
                  )}

                  {/* Department eligibility warning */}
                  {!['CCIT', 'CTE', 'CBAPA'].includes((profile.department || '').trim().toUpperCase()) && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-amber-400 text-xs font-black">!</span>
                      </div>
                      <div>
                        <p className="text-sm text-amber-300 font-bold mb-1">Department not eligible</p>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Your department is currently set to <span className="text-amber-400 font-bold">&quot;{profile.department || 'not set'}&quot;</span>.
                          Thesis Defense is only available for <span className="text-white font-bold">CCIT, CTE, or CBAPA</span> students.
                          Please update your department in <button onClick={() => setActiveTab('profile')} className="program-accent-link underline transition-colors">Profile Settings</button>.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                        <FileText className="w-6 h-6 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-200">Thesis Abstract <span className="text-xs text-rose-400 font-semibold ml-2">Required</span></h3>
                        <p className="text-sm text-slate-400 mt-1 leading-relaxed">Upload your abstract (PDF or TXT) — the AI Panel will analyze it and base all defense questions on your actual research.</p>
                      </div>
                    </div>

                    {!thesisAbstractFile ? (
                      <label className="block w-full border-2 border-dashed border-slate-700 hover:border-purple-500/50 rounded-xl p-10 text-center cursor-pointer transition-all group">
                        <Upload className="w-10 h-10 text-slate-500 group-hover:text-purple-400 mx-auto mb-3 transition-colors" />
                        <p className="text-slate-400 text-sm font-medium">Click to upload or drag and drop</p>
                        <p className="text-slate-600 text-xs mt-1">PDF or TXT, up to 10MB</p>
                        <input
                          type="file"
                          accept=".pdf,.txt"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) setThesisAbstractFile(f); }}
                        />
                      </label>
                    ) : (
                      <div className="flex items-center gap-4 bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                        <FileText className="w-8 h-8 text-purple-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-200 truncate">{thesisAbstractFile.name}</p>
                          <p className="text-xs text-slate-400">{(thesisAbstractFile.size / 1024).toFixed(1)} KB · Ready to upload</p>
                        </div>
                        <button
                          onClick={() => setThesisAbstractFile(null)}
                          className="text-slate-400 hover:text-rose-400 transition-colors text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 flex gap-4">
                    <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-bold text-amber-300">1-Hour Timed Defense</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">Your defense session runs for up to 1 hour. The AI panel will probe your thesis systematically. You can submit for grading after providing 5 responses.</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <button
                      id="begin-defense-btn"
                      onClick={startThesisSession}
                      disabled={thesisIsStarting || !thesisAbstractFile}
                      title={!thesisAbstractFile ? 'Upload your thesis abstract first' : ''}
                      className={`px-10 py-4 rounded-xl font-bold flex items-center gap-3 transition-all text-lg ${!thesisAbstractFile
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        : thesisIsStarting
                          ? 'bg-purple-600 text-white opacity-75 cursor-not-allowed shadow-lg shadow-purple-500/20'
                          : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                        }`}
                    >
                      {!thesisAbstractFile ? (
                        <><Lock className="w-5 h-5" /> Upload Abstract to Continue</>
                      ) : thesisIsStarting ? (
                        thesisAbstractUploading ? 'Uploading Abstract...' : 'Starting Defense...'
                      ) : (
                        <>Begin Defense <ArrowRight className="w-5 h-5" /></>
                      )}
                    </button>
                    {!thesisAbstractFile && (
                      <p className="text-xs text-slate-500">A thesis abstract is required to begin your defense.</p>
                    )}
                  </div>
                </motion.div>
              </div>
            )}

            {activeTab === 'thesis-session' && (
              <div className="relative h-full flex flex-col items-center px-4 pt-6 w-full">
                {/* Timer */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm font-bold border transition-colors ${thesisElapsedSeconds >= 3300 ? 'bg-rose-500/20 border-rose-500/30 text-rose-400' : 'bg-slate-800/90 border-slate-700 text-slate-300'}`}>
                    <Clock className="w-4 h-4" />
                    {formatTimer(thesisElapsedSeconds)} / 1:00:00
                  </div>
                </div>

                {/* TOP ROW: 3D MODEL & RESPONSE LOG */}
                <div className="w-full max-w-7xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-8 h-[600px] mt-8">

                  {/* LEFT: 3D Model */}
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-8 bg-[#111827] rounded-[2rem] overflow-hidden relative shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] border border-slate-800 flex items-center justify-center p-0"
                  >
                    <div className="absolute inset-0 w-full h-full">
                      <Canvas shadows camera={{ position: [0, 0.5, 3], fov: 35 }}>
                        <ambientLight intensity={0.8} />
                        <pointLight position={[10, 10, 10]} intensity={1} />
                        <directionalLight position={[5, 10, 5]} intensity={2.0} castShadow />
                        <Environment preset="city" />
                        <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2} minPolarAngle={Math.PI / 2} target={[0, 0, 0]} />
                        <ProfessorModel
                          isSpeaking={isAiSpeaking}
                          analyserNode={activeAnalyser ?? browserTtsAnalyserRef.current}
                          mouthCues={mouthCues}
                          currentAudioTime={currentAudioStartTime}
                          audioContext={audioContextRef.current}
                        />
                      </Canvas>
                    </div>
                    <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold backdrop-blur-sm">
                      <Shield className="w-3.5 h-3.5" />
                      Thesis Defense · Prof. Maxiel
                    </div>
                    {isCameraEnabled && (
                      <div className="absolute left-4 right-4 top-14 z-20 overflow-hidden rounded-xl border border-purple-400/40 bg-slate-950 shadow-xl sm:left-auto sm:right-4 sm:top-4 sm:w-40">
                        <video ref={eyeTracker.videoRef} muted playsInline className="aspect-video w-full scale-x-[-1] object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-slate-200">
                          <span>{eyeTracker.status === 'tracking' ? 'Eye contact' : eyeTracker.status === 'blocked' ? 'Camera blocked' : eyeTracker.status === 'unavailable' ? 'Tracking unavailable' : 'Loading tracker'}</span>
                          <span className="text-purple-300">{getCheckpointEyeContactSummary().samples > 0 ? `${Math.round(getCheckpointEyeContactSummary().score || 0)}%` : '—'}</span>
                        </div>
                        {(eyeTracker.status === 'blocked' || eyeTracker.status === 'unavailable') && (
                          <p className="px-2.5 pb-2 text-[9px] leading-snug text-slate-400">Activity can continue without eye-contact scoring.</p>
                        )}
                      </div>
                    )}
                  </motion.div>

                  {/* RIGHT: Transcript / Result */}
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-4 bg-[#1e293b]/80 backdrop-blur-md rounded-[2rem] p-6 flex flex-col relative shadow-xl overflow-hidden border border-slate-800/80"
                  >
                    {thesisResult ? (
                      <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pr-2 animate-fade-in">
                        <div className="text-center space-y-3 mb-6 shrink-0 mt-2">
                          <div className={`mx-auto inline-flex items-center justify-center w-20 h-20 rounded-full mb-1 border-4 ${thesisResult.passed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                            <span className="text-2xl font-black">{thesisResult.total_score}%</span>
                          </div>
                          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Defense Complete</h2>
                          <p className="text-xs text-slate-400 leading-relaxed px-2">{thesisResult.passed ? 'Congratulations! You passed the thesis defense.' : 'Keep practicing! You did not meet the passing threshold (70%).'}</p>
                        </div>
                        <div className="space-y-4 shrink-0">
                          <h3 className="text-sm font-bold text-slate-200 border-b border-slate-700/50 pb-2">Performance Breakdown</h3>
                          <div className="grid grid-cols-2 gap-2">
                            {getThesisBreakdown(thesisResult, profile.department || 'CCIT').map((item, idx, arr) => (
                              <div key={idx} className={`bg-slate-900 p-3 rounded-xl border border-slate-800/50 ${arr.length % 2 !== 0 && idx === arr.length - 1 ? 'col-span-2 text-center' : ''}`}>
                                <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider truncate" title={item.label}>{item.label}</p>
                                <p className="text-xl font-black text-purple-400">{item.score || 0}</p>
                                <p className="text-[9px] text-slate-600 mt-0.5">{item.weight}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-500/10 p-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-purple-300">Camera Eye Contact</span>
                            <span className="text-xl font-black text-purple-400">{(thesisResult.eye_contact_samples || 0) > 0 ? `${Math.round(thesisResult.score_eye_contact)}%` : 'Unavailable'}</span>
                          </div>
                          {thesisResult.feedback_summary && (
                            <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-xl mt-4">
                              <h4 className="text-[11px] uppercase tracking-wider font-bold text-purple-400 mb-2">AI Feedback</h4>
                              <p className="text-xs text-slate-300 leading-relaxed">{thesisResult.feedback_summary}</p>
                            </div>
                          )}
                          <button onClick={exitThesisSession} className="w-full mt-4 py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-xl font-bold transition-colors shadow-lg shrink-0">
                            Go to Dashboard
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col h-full">
                        <h3 className="text-sm font-bold text-[#f8fafc] border-b border-[#64748b]/60 pb-3 mb-4 shrink-0 uppercase tracking-widest text-center">Your Responses</h3>
                        {onlineInterviewError && (
                          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                            <p>{onlineInterviewError}</p>
                            {canRetryOnlineResponse && (
                              <button
                                type="button"
                                onClick={retryOnlineInterviewResponse}
                                className="mt-2 font-bold text-rose-100 underline underline-offset-2"
                              >
                                Retry AI response
                              </button>
                            )}
                          </div>
                        )}
                        {renderOfflineInterviewInput('thesis')}
                        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-1 scroll-smooth">
                          {(() => {
                            const userLogs = thesisConversationLog.filter(l => l.sender === 'user');
                            if (userLogs.length === 0) {
                              return (
                                <div className="flex-1 flex flex-col items-center justify-center">
                                  <User className="w-8 h-8 text-[#94a3b8] mb-3" />
                                  <p className="text-[#cbd5e1] text-xs text-center px-4 leading-relaxed">Respond to Prof. Maxiel's questions. Your answers will appear here.</p>
                                </div>
                              );
                            }
                            return userLogs.map((log, idx) => (
                              <div key={idx} className="flex flex-col items-stretch animate-fade-in">
                                <span className="text-[10px] font-bold uppercase tracking-wider mb-1 text-[#fda4af] px-1">Response {idx + 1}</span>
                                <div className="p-3 rounded-xl bg-[#0f172a] border border-[#334155] text-[#f8fafc] shadow-sm">
                                  <p className="leading-relaxed text-xs">{log.text}</p>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                        <div className="mt-4 pt-4 border-t border-[#64748b]/60 shrink-0">
                          {(() => {
                            const userTurns = thesisConversationLog.filter(l => l.sender === 'user').length;
                            if (userTurns >= 5) {
                              return (
                                <button
                                  onClick={finishThesisSession}
                                  disabled={thesisIsFinishing || isAiSpeaking || canRetryOnlineResponse}
                                  className={`w-full py-3 ${thesisIsFinishing || isAiSpeaking || canRetryOnlineResponse ? 'bg-slate-500 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500'} text-white rounded-xl font-bold transition-all shadow-lg shadow-purple-500/20 text-sm tracking-wide animate-fade-in`}
                                >
                                  {thesisIsFinishing
                                    ? activeActivityCheckpoint?.mode === 'offline' ? 'Saving Locally...' : 'Grading...'
                                    : isAiSpeaking
                                      ? 'Professor is responding...'
                                      : activeActivityCheckpoint?.mode === 'offline' ? 'Complete Offline Defense' : 'Complete Defense'}
                                </button>
                              );
                            }
                            return (
                              <div className="text-center">
                                <span className="text-xs font-medium text-[#cbd5e1]">{userTurns} / 5 Responses Recorded</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </div>

                {/* Bottom Controls */}
                {/* BOTTOM ROW: CONTROLS */}
                {!thesisResult && (
                  <div className="flex items-center justify-center gap-6 w-full max-w-lg mx-auto pb-4 shrink-0">
                    <div className="relative">
                      <button
                        onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                        className="bg-[#171e2e] hover:bg-[#1e293b] border border-slate-800 text-slate-300 hover:text-white w-14 h-14 rounded-2xl transition-all duration-300 flex items-center justify-center shadow-lg group relative"
                        title="Add File"
                      >
                        {thesisInSessionUploading ? (
                          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Plus className={`w-5 h-5 transition-transform duration-300 ${isAddMenuOpen ? 'rotate-45' : 'group-hover:scale-110'}`} />
                        )}
                      </button>

                      {/* Attachment Popover for Thesis */}
                      {isAddMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 w-48 bg-slate-800 border border-slate-700/80 rounded-2xl shadow-xl overflow-hidden z-[100]"
                        >
                          <div className="flex flex-col p-1.5 space-y-1">
                            <label className="flex items-center gap-3 w-full p-2.5 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer">
                              <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                                <Plus className="w-3.5 h-3.5 text-purple-400" />
                              </div>
                              <span className="text-xs font-semibold tracking-wide">Upload Proposal</span>
                              <input
                                type="file"
                                accept=".pdf,.txt"
                                className="hidden"
                                disabled={thesisInSessionUploading}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadThesisAbstractInSession(f);
                                  setIsAddMenuOpen(false);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        </motion.div>
                      )}
                    </div>

                    {/* Mic visualiser — center */}
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={isMicTransitioning || isAiSpeaking || isSubmittingOfflineAnswer || thesisConversationLog.filter(turn => turn.sender === 'user').length >= OFFLINE_INTERVIEW_RESPONSE_LIMIT}
                      className={`relative ${isListening ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-slate-800 shadow-slate-900/40'} text-white w-20 h-20 rounded-[2rem] transition-all duration-300 flex items-center justify-center shadow-xl disabled:cursor-not-allowed disabled:opacity-50`}
                      title={isListening ? 'Stop recording and submit answer' : 'Start recording'}
                      aria-label={isListening ? 'Stop recording and submit answer' : 'Start recording'}
                    >
                      {isListening ? (
                        <div className="flex items-center justify-center gap-1.5 h-8 w-full relative z-10 px-4">
                          {[...userAudioData, ...Array.from(userAudioData).reverse()].map((height, i) => (
                            <motion.div key={`tw-${i}`} className="w-[3px] bg-white rounded-full" animate={{ height: `${height * 0.7}px` }} transition={{ duration: 0.1, ease: 'linear' }} />
                          ))}
                        </div>
                      ) : (
                        <Mic className="w-8 h-8 relative z-10 text-slate-400" />
                      )}
                      {isListening && <span className="absolute inset-0 rounded-[2rem] border-4 border-emerald-400 opacity-0" style={{ animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsCameraEnabled(enabled => !enabled)}
                      className={`${isCameraEnabled ? 'bg-purple-500/20 border-purple-400/50 text-purple-300' : 'bg-[#171e2e] border-slate-800 text-slate-400'} hover:bg-purple-500/10 hover:border-purple-400/40 hover:text-purple-300 w-14 h-14 rounded-2xl border transition-all duration-300 flex items-center justify-center shadow-lg group`}
                      title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                      aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                      aria-pressed={isCameraEnabled}
                    >
                      {isCameraEnabled ? <Camera className="w-5 h-5 group-hover:scale-110 transition-transform" /> : <CameraOff className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                    </button>

                    {/* Leave */}
                    <button
                      onClick={() => setThesisIsLeaveModalOpen(true)}
                      className="bg-[#171e2e] hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 text-slate-300 hover:text-rose-500 w-14 h-14 rounded-2xl transition-all duration-300 flex items-center justify-center shadow-lg group"
                      title="Leave Defense Session"
                    >
                      <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>
                  </div>
                )}

                {/* Thesis Leave Modal */}
                {thesisIsLeaveModalOpen && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-slate-900 border border-slate-700/50 rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center"
                    >
                      <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center mb-6 text-rose-500">
                        <LogOut className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-bold text-[#2e2812] text-center mb-3">End Defense?</h3>
                      <p className="text-[#6b6452] text-center mb-8 text-sm leading-relaxed px-2">Are you sure you want to end this thesis defense? Your session progress will not be graded.</p>
                      <div className="flex gap-4 w-full">
                        <button onClick={() => setThesisIsLeaveModalOpen(false)} className="flex-1 py-3 px-4 bg-[#e3e0d6] hover:bg-[#d6d1c5] border border-[#cbc6b9] text-[#2e2812] rounded-xl font-semibold transition-colors">Cancel</button>
                        <button onClick={exitThesisSession} className="flex-1 py-3 px-4 bg-[#b42335] hover:bg-[#941c2d] border border-[#941c2d] text-white rounded-xl font-semibold transition-colors shadow-lg shadow-red-900/20">Leave</button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'interview-session' && (
              <div className="interview-session-theme relative flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[var(--interview-outer)] text-[var(--interview-text-primary)] lg:overflow-hidden">

                {/* Unified interview room: primary stage and docked transcript */}
                <div className="grid w-full flex-none grid-cols-1 bg-[var(--interview-outer)] lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_clamp(20rem,24vw,26rem)] lg:grid-rows-[minmax(0,1fr)_auto]">

                  {/* Primary 3D interview stage */}
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative m-3 flex min-h-[52svh] items-center justify-center overflow-hidden rounded-xl border border-[var(--interview-border)] bg-[var(--interview-stage)] p-0 lg:col-start-1 lg:row-start-1 lg:m-5 lg:min-h-0"
                    style={{ backgroundColor: 'var(--interview-stage)' }}
                  >
                    <div className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${isProfessorFirstFrameReady ? 'opacity-100' : 'opacity-0'}`}>
                      <Canvas shadows camera={{ position: [0, 0.5, 3], fov: 35 }}>
                        <ambientLight intensity={0.8} />
                        <pointLight position={[10, 10, 10]} intensity={1} />
                        <directionalLight position={[5, 10, 5]} intensity={2.0} castShadow />
                        <React.Suspense fallback={null}>
                          <Environment preset="city" />
                        </React.Suspense>
                        <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2} minPolarAngle={Math.PI / 2} target={[0, 0, 0]} />
                        <ProfessorModel
                          isSpeaking={isAiSpeaking}
                          analyserNode={activeAnalyser ?? browserTtsAnalyserRef.current}
                          mouthCues={mouthCues}
                          currentAudioTime={currentAudioStartTime}
                          audioContext={audioContextRef.current}
                          onFirstFrame={handleProfessorFirstFrame}
                        />
                      </Canvas>
                    </div>
                    {!isProfessorFirstFrameReady && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                        <div className="program-accent-spinner h-7 w-7 rounded-full border-2" />
                        <p className="text-xs font-semibold text-[var(--interview-text-secondary)]">Preparing Professor Maxiel...</p>
                      </div>
                    )}
                    {isCameraEnabled && (
                      <div className="program-accent-dark-border absolute right-3 top-3 z-20 w-36 overflow-hidden rounded-xl border bg-[var(--interview-card)] shadow-xl sm:right-4 sm:top-4 sm:w-40">
                        <video ref={eyeTracker.videoRef} muted playsInline className="aspect-video w-full scale-x-[-1] object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-[var(--interview-text-secondary)]">
                          <span>{eyeTracker.status === 'tracking' ? 'Eye contact' : eyeTracker.status === 'blocked' ? 'Camera blocked' : eyeTracker.status === 'unavailable' ? 'Tracking unavailable' : 'Loading tracker'}</span>
                          <span className="program-accent-on-dark">{getCheckpointEyeContactSummary().samples > 0 ? `${Math.round(getCheckpointEyeContactSummary().score || 0)}%` : '—'}</span>
                        </div>
                        {(eyeTracker.status === 'blocked' || eyeTracker.status === 'unavailable') && (
                          <p className="px-2.5 pb-2 text-[9px] leading-snug text-[var(--interview-text-muted)]">Activity can continue without eye-contact scoring.</p>
                        )}
                      </div>
                    )}
                  </motion.div>

                  {/* Docked transcript and evaluation panel */}
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative flex min-h-[24rem] flex-col overflow-hidden border-t border-[var(--interview-border)] bg-[var(--interview-transcript)] p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:border-l lg:border-t-0 lg:p-5"
                    style={{ backgroundColor: 'var(--interview-transcript)' }}
                  >
                    {interviewResult ? (
                      // --- EVALUATION RESULT UI ---
                      <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pr-2 animate-fade-in">
                        <div className="text-center space-y-3 mb-6 shrink-0 mt-2">
                          <div className={`mx-auto inline-flex items-center justify-center w-20 h-20 rounded-full mb-1 border-4 ${interviewResult.passed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                            <span className="text-2xl font-black">{interviewResult.total_score}%</span>
                          </div>
                          <h2 className="text-xl font-bold text-[var(--interview-text-primary)] tracking-tight">Interview Complete</h2>
                          <p className="text-xs text-[var(--interview-text-secondary)] leading-relaxed px-2">{interviewResult.passed ? 'Congratulations! You passed the interview.' : 'Keep practicing! You did not meet the passing criteria this time.'}</p>
                        </div>

                        <div className="space-y-4 shrink-0">
                          <h3 className="border-b border-[var(--interview-border)] pb-2 text-sm font-bold text-[var(--interview-text-primary)]">Performance Breakdown</h3>

                          <div className="grid grid-cols-2 gap-2">
                            {(() => {
                              const dep = profile.department?.toUpperCase();
                              let breakdown = [];
                              if (dep === 'CTE') {
                                breakdown = [
                                  { label: "Subject Matter", score: interviewResult.score_cte_subject_matter },
                                  { label: "Teaching Apt.", score: interviewResult.score_cte_teaching },
                                  { label: "Motivation", score: interviewResult.score_cte_motivation },
                                  { label: "Acad. Prepared.", score: interviewResult.score_cte_academic },
                                  { label: "Problem Solving", score: interviewResult.score_cte_problem_solving },
                                  { label: "Leadership", score: interviewResult.score_cte_leadership },
                                  { label: "Communication", score: interviewResult.score_cte_communication },
                                ];
                              } else if (dep === 'CBAPA') {
                                breakdown = [
                                  { label: "Business Fund.", score: interviewResult.score_cbapa_business },
                                  { label: "Analytical", score: interviewResult.score_cbapa_analytical },
                                  { label: "Entrepreneurial", score: interviewResult.score_cbapa_entrepreneurial },
                                  { label: "Acad. Prepared.", score: interviewResult.score_cbapa_academic },
                                  { label: "Leadership", score: interviewResult.score_cbapa_leadership },
                                  { label: "Ethical", score: interviewResult.score_cbapa_ethical },
                                  { label: "Communication", score: interviewResult.score_cbapa_communication },
                                ];
                              } else {
                                breakdown = [
                                  { label: "Technical", score: interviewResult.score_technical },
                                  { label: "Problem Solving", score: interviewResult.score_problem_solving },
                                  { label: "Coding Basics", score: interviewResult.score_coding },
                                  { label: "Soft Skills", score: interviewResult.score_soft_skills },
                                  { label: "Communication", score: interviewResult.score_communication },
                                ];
                              }

                              return breakdown.map((item, idx) => (
                                <div key={idx} className={`rounded-xl border border-[var(--interview-border)] bg-[var(--interview-card)] p-3 ${breakdown.length % 2 !== 0 && idx === breakdown.length - 1 ? 'col-span-2 text-center' : ''}`}>
                                  <p className="mb-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] uppercase tracking-wider text-[var(--interview-text-secondary)]" title={item.label}>{item.label}</p>
                                  <p className="program-accent-on-dark text-xl font-black">{item.score || 0}</p>
                                </div>
                              ));
                            })()}
                          </div>

                          <div className="program-accent-dark-surface program-accent-border mt-3 flex items-center justify-between rounded-xl border p-3">
                            <span className="text-xs font-bold uppercase tracking-wider">Camera Eye Contact</span>
                            <span className="text-xl font-black">{(interviewResult.eye_contact_samples || 0) > 0 ? `${Math.round(interviewResult.score_eye_contact)}%` : 'Unavailable'}</span>
                          </div>

                          {interviewResult.feedback_summary && (
                            <div className="program-accent-dark-surface program-accent-border border p-4 rounded-xl mt-4">
                              <h4 className="text-[11px] uppercase tracking-wider font-bold mb-2">AI Feedback</h4>
                              <p className="text-xs leading-relaxed text-[var(--interview-text-secondary)]">{interviewResult.feedback_summary}</p>
                            </div>
                          )}

                          <div className="program-accent-dark-border mt-4 rounded-xl border bg-[var(--interview-elevated)] p-3 text-center">
                            <p className="mb-3 text-xs leading-relaxed text-[var(--interview-text-secondary)]">
                              Your responses have been validated. Review your score and feedback, then return to the dashboard.
                            </p>
                            <button onClick={exitInterview} className="program-accent-button w-full py-3 text-sm rounded-xl font-bold transition-colors shadow-lg shrink-0">
                              Return to Dashboard
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // --- TRANSCRIPT HISTORY UI ---
                      <div className="flex flex-col h-full">
                        <h3 className="mb-3 shrink-0 border-b border-[var(--interview-border)] pb-3 text-left text-xs font-bold uppercase tracking-[0.16em] text-[var(--interview-text-primary)]">Interview Transcript</h3>

                        {onlineInterviewError && (
                          <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                            <p>{onlineInterviewError}</p>
                            {canRetryOnlineResponse && (
                              <button
                                type="button"
                                onClick={retryOnlineInterviewResponse}
                                className="mt-2 font-bold text-rose-100 underline underline-offset-2"
                              >
                                Retry AI response
                              </button>
                            )}
                          </div>
                        )}

                        {renderOfflineInterviewInput('upcoming')}

                        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 scroll-smooth">
                          {(aiResponseText || isAiSpeaking) && (
                            <div className="program-accent-dark-border rounded-lg border bg-[var(--interview-elevated)] p-3 text-[var(--interview-text-primary)]">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="program-accent-on-dark text-[10px] font-bold uppercase tracking-wider">Professor Maxiel</span>
                                {isAiSpeaking && <span className="program-accent-on-dark text-[10px] font-semibold">Speaking...</span>}
                              </div>
                              <p className="whitespace-pre-wrap text-xs leading-relaxed">
                                {aiResponseText || 'Preparing response...'}
                              </p>
                            </div>
                          )}

                          <div className="flex min-h-0 flex-1 flex-col gap-3">
                            {(() => {
                              // Filter explicitly only for user responses
                              const userLogs = conversationLog.filter((log) => log.sender === 'user');
                              const showLiveSpeech = isListening || isMicTransitioning || hasUnfinalizedTranscript;

                              if (userLogs.length === 0 && !showLiveSpeech) {
                                return (
                                  <div className="flex flex-1 flex-col items-center justify-center py-8">
                                    <User className="mb-3 h-7 w-7 text-[var(--interview-text-muted)]" />
                                    <p className="px-4 text-center text-xs leading-relaxed text-[var(--interview-text-secondary)]">Respond to the AI Professor. Your answers will be tracked here (Limit: 5).</p>
                                  </div>
                                );
                              }

                              return (
                                <>
                                  {userLogs.map((log, idx) => (
                                    <div key={idx} className="flex flex-col items-stretch animate-fade-in">
                                      <span className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--interview-text-secondary)]">
                                        You · Response {idx + 1}
                                      </span>
                                      <div className="rounded-lg border border-[var(--interview-border)] bg-[var(--interview-card)] p-3 text-[var(--interview-text-primary)]">
                                        <p className="text-xs leading-relaxed">{log.text}</p>
                                      </div>
                                    </div>
                                  ))}
                                  {showLiveSpeech && (
                                    <div className="rounded-lg border border-[var(--interview-border)] bg-[var(--interview-card)] p-3 text-[var(--interview-text-primary)]" aria-live="polite">
                                      <span className="program-accent-on-dark mb-1 block text-[10px] font-bold uppercase tracking-wider">
                                        {isMicTransitioning ? 'Finalizing...' : isListening ? 'Listening...' : 'Unfinalized speech'}
                                      </span>
                                      <p className="text-xs leading-relaxed">
                                        {liveTranscript || 'Start speaking when you are ready.'}
                                      </p>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="mt-3 shrink-0 border-t border-[var(--interview-border)] pt-3">
                          {(() => {
                            const userTurns = conversationLog.filter(l => l.sender === 'user').length;
                            if (userTurns >= 5 && isEnrollmentFinalProfessorTurnReady) {
                              return (
                                <div className="space-y-2 animate-fade-in">
                                  <p className="text-center text-xs leading-relaxed text-[var(--interview-text-secondary)]">
                                    {activeActivityCheckpoint?.mode === 'offline'
                                      ? 'Five answers are ready. Complete locally to save a provisional result for future validation.'
                                      : 'Five answers are ready. Validate them to calculate your score and feedback.'}
                                  </p>
                                  <button
                                    onClick={finishInterviewSession}
                                    disabled={isFinishingInterview}
                                    className={`w-full rounded-xl py-3 text-sm font-bold tracking-wide transition-all ${isFinishingInterview ? 'cursor-not-allowed bg-[var(--interview-disabled)] text-[var(--interview-text-secondary)]' : 'program-accent-interview-active'}`}
                                  >
                                    {isFinishingInterview
                                      ? activeActivityCheckpoint?.mode === 'offline' ? 'Saving Locally...' : 'Validating Responses...'
                                      : activeActivityCheckpoint?.mode === 'offline' ? 'Complete Offline Interview' : 'Validate Responses'}
                                  </button>
                                </div>
                              );
                            }
                            if (userTurns >= 5) {
                              return (
                                <div className="text-center space-y-1 animate-fade-in">
                                  <span className="block text-xs font-semibold text-[var(--interview-text-primary)]">5 / 5 Responses Recorded</span>
                                  <span className="block text-[10px] text-[var(--interview-text-muted)]">Professor Maxiel is finishing the interview...</span>
                                </div>
                              );
                            }
                            return (
                              <div className="text-center space-y-1">
                                <span className="block text-xs font-semibold text-[var(--interview-text-primary)]">{userTurns} / 5 Responses Recorded</span>
                                <span className="block text-[10px] text-[var(--interview-text-muted)]">Complete all five responses to unlock validation.</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </motion.div>

                {/* Integrated meeting controls */}
                {!interviewResult && (
                  <div className="grid w-full shrink-0 items-center gap-3 border-t border-[var(--interview-border)] bg-[var(--interview-controls)] px-4 py-3 lg:col-start-1 lg:row-start-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6 lg:px-6">
                    <div
                      role="status"
                      aria-live="polite"
                      className="min-w-0 text-center lg:max-w-2xl lg:text-left"
                    >
                      <p className="program-accent-on-dark text-[10px] font-bold uppercase tracking-[0.18em]">How to respond</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--interview-text-primary)]">Listen → Click microphone → Speak → Click microphone again to submit</p>
                      <p className={`mt-1.5 text-xs leading-relaxed ${isListening ? 'program-accent-on-dark font-semibold' : 'text-[var(--interview-text-secondary)]'}`}>
                        {enrollmentInstruction}
                      </p>
                    </div>

                    <div className="flex items-start justify-center gap-3 sm:gap-4">
                    <div className="relative flex flex-col items-center gap-1">
                      <button
                        onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                        className="group relative flex h-12 w-12 items-center justify-center rounded-lg bg-transparent text-[var(--interview-text-secondary)] transition-all duration-300 hover:bg-[var(--interview-control-hover)] hover:text-[var(--interview-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--program-accent-on-dark)]"
                        title="Add an attachment"
                        aria-label="Add an attachment"
                      >
                        <Plus className={`h-[22px] w-[22px] transition-transform duration-300 ${isAddMenuOpen ? 'rotate-45' : 'group-hover:scale-110'}`} />
                      </button>
                      <span className="text-[11px] font-semibold text-[var(--interview-text-secondary)]">Attach</span>

                      {/* Attachment Popover */}
                      {isAddMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className="absolute bottom-[calc(100%+16px)] left-1/2 z-[100] w-48 -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--interview-border)] bg-[var(--interview-elevated)] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]"
                        >
                          <div className="flex flex-col p-1.5 space-y-1">
                            <button onClick={() => setIsAddMenuOpen(false)} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left text-[var(--interview-text-secondary)] transition-all hover:bg-[var(--interview-control-hover)] hover:text-[var(--interview-text-primary)]">
                              <div className="program-accent-dark-surface w-7 h-7 rounded-lg flex items-center justify-center shrink-0">
                                <Folder className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-xs font-semibold tracking-wide">Local Disk</span>
                            </button>
                            <button onClick={() => setIsAddMenuOpen(false)} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left text-[var(--interview-text-secondary)] transition-all hover:bg-[var(--interview-control-hover)] hover:text-[var(--interview-text-primary)]">
                              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                              </div>
                              <span className="text-xs font-semibold tracking-wide">Drive</span>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={toggleListening}
                        disabled={isMicTransitioning || isAiSpeaking || isSubmittingOfflineAnswer || enrollmentResponseCount >= 5}
                        className={`relative ${
                          isListening
                            ? 'program-accent-interview-active program-accent-border'
                            : isMicTransitioning || enrollmentResponseCount >= 5
                              ? 'cursor-not-allowed border-[var(--interview-border-strong)] bg-[var(--interview-disabled)] text-[var(--interview-text-secondary)]'
                              : 'border-[var(--interview-border-strong)] bg-[var(--interview-elevated)] text-[var(--interview-text-primary)] hover:border-[var(--program-accent-on-dark)] hover:bg-[var(--interview-control-hover)]'
                        } flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg transition-all duration-300`}
                        title={
                          isListening
                            ? 'Stop recording and submit answer'
                            : isMicTransitioning
                              ? 'Submitting answer'
                              : 'Start recording your answer'
                        }
                        aria-label={
                          isListening
                            ? 'Stop recording and submit answer'
                            : isMicTransitioning
                              ? 'Submitting answer'
                              : enrollmentResponseCount >= 5
                                ? 'All responses recorded'
                                : 'Start microphone recording'
                        }
                        aria-pressed={isListening}
                      >
                        {isListening ? (
                          <div className="relative z-10 flex h-8 w-full items-center justify-center gap-1">
                            {userAudioData.map((height, i) => (
                              <motion.div
                                key={`w-left-${i}`}
                                className="w-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--program-accent-dark-interactive-foreground)' }}
                                animate={{ height: `${height * 0.65}px` }}
                                transition={{ duration: 0.1, ease: 'linear' }}
                              />
                            ))}
                            <Mic className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            {Array.from(userAudioData).reverse().map((height, i) => (
                              <motion.div
                                key={`w-right-${i}`}
                                className="w-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--program-accent-dark-interactive-foreground)' }}
                                animate={{ height: `${height * 0.65}px` }}
                                transition={{ duration: 0.1, ease: 'linear' }}
                              />
                            ))}
                          </div>
                        ) : (
                          <MicOff className="relative z-10 h-[22px] w-[22px]" aria-hidden="true" />
                        )}
                        {isListening && (
                          <span
                            className="absolute inset-0 rounded-2xl border-2 opacity-0"
                            style={{
                              animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                              borderColor: 'var(--program-accent-on-dark)',
                            }}
                          />
                        )}
                      </button>
                      <div className="min-h-7 text-center leading-tight">
                        <span className={`block text-[11px] font-bold ${isListening ? 'program-accent-on-dark' : 'text-[var(--interview-text-primary)]'}`}>
                          {isListening ? 'Recording...' : isMicTransitioning ? 'Submitting...' : enrollmentResponseCount >= 5 ? 'Answers Complete' : 'Start Answer'}
                        </span>
                        {isListening && <span className="mt-0.5 block text-[10px] font-medium text-[var(--interview-text-secondary)]">Click to submit</span>}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setIsCameraEnabled(enabled => !enabled)}
                        className={`group flex h-12 w-12 items-center justify-center rounded-lg bg-transparent transition-all duration-300 hover:bg-[var(--interview-control-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--program-accent-on-dark)] ${isCameraEnabled ? 'program-accent-on-dark' : 'text-[var(--interview-text-secondary)] hover:text-[var(--interview-text-primary)]'}`}
                        title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on for eye-contact tracking'}
                        aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on for eye-contact tracking'}
                        aria-pressed={isCameraEnabled}
                      >
                        {isCameraEnabled ? <Camera className="h-[22px] w-[22px] transition-transform group-hover:scale-110" /> : <CameraOff className="h-[22px] w-[22px] transition-transform group-hover:scale-110" />}
                      </button>
                      <span className={`text-[11px] font-semibold ${isCameraEnabled ? 'program-accent-on-dark' : 'text-[var(--interview-text-secondary)]'}`}>{isCameraEnabled ? 'Camera On' : 'Camera Off'}</span>
                    </div>
                    </div>
                    <div className="flex justify-center lg:justify-end">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => setIsLeaveModalOpen(true)}
                          className="group relative flex h-12 w-12 items-center justify-center rounded-lg bg-transparent text-[#fda4af] transition-all duration-300 hover:bg-[#3b1420] hover:text-[#fecdd3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fb7185]"
                          title="Leave interview without validating"
                          aria-label="Leave interview without validating"
                        >
                          <LogOut className="h-[22px] w-[22px] transition-transform group-hover:scale-110" />
                        </button>
                        <span className="text-[11px] font-semibold text-[#fda4af]">Leave</span>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}

            {/* Leave Confirmation Modal */}
            {isLeaveModalOpen && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-slate-900 border border-slate-700/50 rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center"
                >
                  <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center mb-6 text-rose-500 shadow-inner">
                    <LogOut className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-[#2e2812] text-center mb-3">Leave Interview?</h3>
                  <p className="text-[#6b6452] text-center mb-8 text-sm leading-relaxed px-2">
                    Are you sure you want to end this interview session? Your progress and current context will be cleared.
                  </p>
                  <div className="flex gap-4 w-full">
                    <button
                      onClick={() => setIsLeaveModalOpen(false)}
                      className="flex-1 py-3 px-4 bg-[#e3e0d6] hover:bg-[#d6d1c5] border border-[#cbc6b9] text-[#2e2812] rounded-xl font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={exitInterview}
                      className="flex-1 py-3 px-4 bg-[#b42335] hover:bg-[#941c2d] border border-[#941c2d] text-white rounded-xl font-semibold transition-colors shadow-lg shadow-red-900/20"
                    >
                      Leave
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full space-y-8"
              >
                <div>
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Interview Practice</h1>
                  <p className="text-lg text-slate-400 mt-2">Relive your past sessions and track your progress over time.</p>
                </div>

                {(() => {
                  const allHistory = [
                    ...interviewHistory.filter(i => (i.total_score || 0) > 0).map(i => ({ ...i, _type: 'enrollment' as const })),
                    ...thesisHistory.filter(i => (i.total_score || 0) > 0).map(i => ({ ...i, _type: 'thesis' as const }))
                  ].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

                  if (allHistory.length === 0) {
                    return (
                      <div className="bg-card border border-line rounded-lg px-6 py-12 md:py-14 text-center">
                        <div className="w-20 h-20 bg-active rounded-full flex items-center justify-center mx-auto mb-6 text-muted">
                          <Video className="w-10 h-10" />
                        </div>
                        <h3 className="text-xl font-bold text-ink">No interviews yet</h3>
                        <p className="text-muted mt-2 max-w-sm mx-auto">Start your first interview session to see your performance history here.</p>
                        <button
                          onClick={() => setActiveTab('interview-type')}
                          className="program-accent-button mt-8 px-6 py-3 rounded-lg font-semibold transition-colors"
                        >
                          Start Practicing
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 gap-4 pb-12">
                      {allHistory.map((item, i) => (
                        <motion.div
                          key={`${item._type}-${item.id || i}`}
                          onClick={() => {
                            setInterviewResult(item);
                            setPrevTab(activeTab);
                            setActiveTab('interview-result');
                          }}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="program-accent-hover-border bg-slate-900 border border-slate-800/50 rounded-2xl p-6 flex items-center justify-between hover:bg-slate-800/80 transition-all cursor-pointer group shadow-xl backdrop-blur-sm"
                        >
                          <div className="flex items-center gap-6">
                            <div className={`w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center transition-all duration-300 ${item._type === 'thesis'
                              ? 'text-purple-400 group-hover:text-purple-300 group-hover:bg-purple-500/10'
                              : 'group-hover-program-accent-surface text-slate-400'
                              }`}>
                              {item._type === 'thesis' ? <Shield className="w-7 h-7" /> : <Video className="w-7 h-7" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-3">
                                <h4 className={`font-bold text-xl text-slate-100 tracking-tight transition-colors ${item._type === 'thesis' ? 'group-hover:text-purple-400' : 'group-hover-program-accent-text'
                                  }`}>
                                  {item._type === 'thesis' ? 'Thesis Defense' : `Interview #${allHistory.filter(h => h._type === 'enrollment').length - allHistory.filter(h => h._type === 'enrollment').indexOf(item)}`}
                                </h4>
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${item._type === 'thesis'
                                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                  : item.passed ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                  }`}>
                                  {item._type === 'thesis' ? 'THESIS' : (item.passed ? 'PASSED' : 'NOT PASSED')}
                                </span>
                              </div>
                              <p className="text-sm text-slate-500 mt-1 font-medium italic">
                                {item._type === 'thesis' ? `${profile.department?.toUpperCase()} Defense` : `${profile.department || 'General'} Assessment`} · {new Date(item.start_time).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-8">
                            <div className="text-right min-w-[100px]">
                              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mb-1">Final Score</p>
                              <span className={`text-3xl font-black ${(item.total_score || 0) >= 75 ? 'text-emerald-400' : (item.total_score || 0) >= 50 ? 'text-program-accent' : 'text-rose-400'
                                }`}>
                                {item.total_score || 0}%
                              </span>
                            </div>
                            <div className="group-hover-program-accent-fill w-10 h-10 rounded-full flex items-center justify-center bg-slate-800 text-slate-500 transition-all duration-300 shadow-inner">
                              <ChevronRight className="w-6 h-6" />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  );
                })()}
              </motion.div>
            )}

            {/* Analytics Tab */}
            {activeTab === 'analytics' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full space-y-8"
              >
                <div>
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Progress</h1>
                  <p className="text-lg text-slate-400 mt-2">In-depth overview of all interviews, tests, and drills.</p>
                </div>

                {renderStatCards()}

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-slate-100 italic tracking-tight">Activity Coverage</h3>
                    <p className="mt-1 text-sm text-slate-400">Completed records and normalized averages for every assessment type.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {stats.activityGroups.map(activity => (
                      <div key={activity.label} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                        <p className="text-sm font-bold text-slate-100">{activity.label}</p>
                        <div className="mt-3 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-program-accent text-2xl font-black">{activity.completed}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Completed</p>
                          </div>
                          <div className="text-right">
                            <p className="text-program-accent text-2xl font-black">{activity.average == null ? 'N/A' : `${activity.average}%`}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{activity.scored} scored</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm">
                    <h3 className="text-xl font-bold text-slate-100 mb-6 italic tracking-tight">Skill Breakdown</h3>
                    <div className="space-y-5">
                      {stats.skillBreakdown.map((skill, idx) => (
                        <div key={idx} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="text-sm font-bold text-slate-100">{skill.label}</h4>
                              <p className="mt-1 text-xs leading-relaxed text-slate-400">{skill.description}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-black text-slate-100">{skill.displayScore}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{skill.scale}</p>
                            </div>
                          </div>
                          <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${skill.value}%` }}
                              transition={{ duration: 1, delay: 0.5 + (idx * 0.1) }}
                              className="program-accent-fill h-full rounded-full"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
                    <div className="mb-6 flex items-center gap-4">
                      <div className="program-accent-surface w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center">
                        <BarChart2 className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-slate-100 italic tracking-tight">Insight Generator</h3>
                        <p className="mt-1 text-sm text-slate-400">Latest scored session compared with the previous session.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {stats.comparisonInsights.map(insight => {
                        const presentation = {
                          improved: { label: 'Improved', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', change: 'text-emerald-400' },
                          declined: { label: 'Needs attention', badge: 'border-rose-500/30 bg-rose-500/10 text-rose-400', change: 'text-rose-400' },
                          steady: { label: 'No change', badge: 'border-slate-700 bg-slate-800/70 text-slate-400', change: 'text-slate-500' },
                          baseline: { label: 'Baseline', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400', change: 'text-amber-400' },
                          'no-data': { label: 'No data', badge: 'border-slate-700 bg-slate-800/70 text-slate-400', change: 'text-slate-500' },
                        }[insight.status];

                        return (
                          <div key={insight.label} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="text-sm font-bold text-slate-100">{insight.label}</h4>
                              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${presentation.badge}`}>
                                {presentation.label}
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Previous</p>
                                <p className="mt-0.5 text-xl font-black text-slate-300">
                                  {insight.previous == null ? 'N/A' : `${insight.previous}%`}
                                </p>
                              </div>
                              <div className={`pb-1 text-sm font-black ${presentation.change}`}>
                                {insight.delta == null ? '—' : `${insight.delta > 0 ? '+' : ''}${insight.delta} pp`}
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current</p>
                                <p className="mt-0.5 text-xl font-black text-slate-100">
                                  {insight.current == null ? 'N/A' : `${insight.current}%`}
                                </p>
                              </div>
                            </div>

                            <p className="mt-3 text-xs leading-relaxed text-slate-400">{insight.message}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full"
              >
                <div className="mb-5">
                  <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Settings</h1>
                  <p className="mt-2 text-base text-muted">Manage your preferences and account experience.</p>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] lg:items-start">
                  <section className="rounded-xl border border-line bg-card p-5" aria-labelledby="appearance-settings-heading">
                    <div className="flex items-start gap-3">
                      <div className="program-accent-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                        {appTheme === 'dark' ? <Moon className="h-5 w-5" aria-hidden="true" /> : <Sun className="h-5 w-5" aria-hidden="true" />}
                      </div>
                      <div>
                        <h2 id="appearance-settings-heading" className="text-lg font-bold text-ink">Appearance</h2>
                        <p className="mt-1 text-sm text-muted">Choose how Career Edge looks after you sign in.</p>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-line pt-4">
                      <p className="mb-2 text-sm font-semibold text-ink">Theme</p>
                      <div className="grid grid-cols-2 gap-2 sm:max-w-lg" role="group" aria-label="Application theme">
                        {([
                          { value: 'light' as AppTheme, label: 'Light', icon: Sun },
                          { value: 'dark' as AppTheme, label: 'Dark', icon: Moon },
                        ]).map(({ value, label, icon: ThemeIcon }) => {
                          const isSelected = appTheme === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setAppTheme(value)}
                              aria-pressed={isSelected}
                              className={`program-accent-focus-ring flex min-h-12 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                                isSelected
                                  ? 'program-accent-surface program-accent-border'
                                  : 'border-line bg-card text-ink hover:bg-active'
                              }`}
                            >
                              <ThemeIcon className="h-4 w-4" aria-hidden="true" />
                              {label}
                              <span className={`h-2 w-2 rounded-full ${isSelected ? 'program-accent-fill' : 'bg-line'}`} aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-3">
                    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-labelledby="support-settings-heading">
                      <div className="flex items-start gap-3">
                        <div className="program-accent-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                          <CircleHelp className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 id="support-settings-heading" className="text-lg font-bold text-ink">Support</h2>
                          <p className="mt-1 text-sm text-muted">Get help using Career Edge.</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('support')}
                        className="program-accent-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-active"
                      >
                        Open
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </section>

                    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-labelledby="privacy-settings-heading">
                      <div className="flex items-start gap-3">
                        <div className="program-accent-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                          <Shield className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 id="privacy-settings-heading" className="text-lg font-bold text-ink">Privacy Policy</h2>
                          <p className="mt-1 text-sm text-muted">View the space reserved for the approved policy.</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('privacy')}
                        className="program-accent-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-active"
                      >
                        View
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'support' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-3xl"
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className="program-accent-focus-ring mb-6 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-active hover:text-ink"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back to Settings
                </button>
                <div className="mb-7">
                  <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Support</h1>
                  <p className="mt-2 text-base text-muted">How can we help?</p>
                </div>
                <section className="rounded-xl border border-line bg-card p-5 sm:p-6" aria-labelledby="support-topics-heading">
                  <div className="flex items-start gap-3 border-b border-line pb-5">
                    <div className="program-accent-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <CircleHelp className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 id="support-topics-heading" className="text-lg font-bold text-ink">Help topics</h2>
                      <p className="mt-1 text-sm text-muted">Choose the area that best matches what you need help with.</p>
                    </div>
                  </div>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {['Using Career Edge', 'Interview Practice Help', 'Account / Login Help', 'Technical Issues'].map((topic) => (
                      <li key={topic} className="flex items-center gap-3 rounded-lg border border-line bg-page p-4 text-sm font-semibold text-ink">
                        <span className="program-accent-fill h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
                        {topic}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-5 text-sm leading-relaxed text-muted">
                    No support contact channel is currently configured in Career Edge. Approved contact information can be added here when available.
                  </p>
                </section>
              </motion.div>
            )}

            {activeTab === 'privacy' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-3xl"
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className="program-accent-focus-ring mb-6 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-active hover:text-ink"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back to Settings
                </button>
                <div className="mb-7">
                  <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Privacy Policy</h1>
                  <p className="mt-2 text-base text-muted">Career Edge policy information.</p>
                </div>
                <section className="rounded-xl border border-line bg-card p-5 sm:p-6" aria-labelledby="privacy-content-heading">
                  <div className="flex items-start gap-3">
                    <div className="program-accent-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <FileText className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 id="privacy-content-heading" className="text-lg font-bold text-ink">Policy content pending</h2>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        The official approved Privacy Policy has not been added to the application yet. This page is ready to display that content when it becomes available.
                      </p>
                    </div>
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === 'interview-result' && interviewResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-3xl mx-auto space-y-6"
              >
                <div className="text-center">
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">
                    {isThesisResult(interviewResult) ? 'Thesis Defense Result' : 'Past Evaluation'}
                  </h1>
                  <p className="text-lg text-slate-400 mt-2">Detailed performance breakdown</p>
                </div>

                <div className="bg-[#1e293b]/80 backdrop-blur-md rounded-[2rem] p-8 shadow-xl border border-slate-800/80">
                  <div className="text-center space-y-3 mb-8">
                    <div className={`mx-auto inline-flex items-center justify-center w-24 h-24 rounded-full mb-2 border-4 ${interviewResult.passed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                      <span className="text-3xl font-black">{interviewResult.total_score || 0}%</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
                      {interviewResult.passed ? 'Passed 🎉' : 'Needs Practice 💡'}
                    </h2>
                    {isThesisResult(interviewResult) && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-bold">
                        <Shield className="w-3.5 h-3.5" />
                        Thesis Defense Result
                      </div>
                    )}
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-sm font-bold text-slate-200 border-b border-slate-700/50 pb-2">Performance Breakdown</h3>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(() => {
                        const dep = profile.department?.toUpperCase();
                        let breakdown: { label: string; score: number | null | undefined }[] = [];

                        if (isThesisResult(interviewResult)) {
                          breakdown = getThesisBreakdown(interviewResult, dep || 'CCIT').map(b => ({ label: b.label, score: b.score }));
                        } else if (dep === 'CTE') {
                          breakdown = [
                            { label: 'Subject Matter', score: interviewResult.score_cte_subject_matter },
                            { label: 'Teaching Apt.', score: interviewResult.score_cte_teaching },
                            { label: 'Motivation', score: interviewResult.score_cte_motivation },
                            { label: 'Acad. Prepared.', score: interviewResult.score_cte_academic },
                            { label: 'Problem Solving', score: interviewResult.score_cte_problem_solving },
                            { label: 'Leadership', score: interviewResult.score_cte_leadership },
                            { label: 'Communication', score: interviewResult.score_cte_communication },
                          ];
                        } else if (dep === 'CBAPA') {
                          breakdown = [
                            { label: 'Business Fund.', score: interviewResult.score_cbapa_business },
                            { label: 'Analytical', score: interviewResult.score_cbapa_analytical },
                            { label: 'Entrepreneurial', score: interviewResult.score_cbapa_entrepreneurial },
                            { label: 'Acad. Prepared.', score: interviewResult.score_cbapa_academic },
                            { label: 'Leadership', score: interviewResult.score_cbapa_leadership },
                            { label: 'Ethical', score: interviewResult.score_cbapa_ethical },
                            { label: 'Communication', score: interviewResult.score_cbapa_communication },
                          ];
                        } else {
                          breakdown = [
                            { label: 'Technical', score: interviewResult.score_technical },
                            { label: 'Problem Solving', score: interviewResult.score_problem_solving },
                            { label: 'Coding Basics', score: interviewResult.score_coding },
                            { label: 'Soft Skills', score: interviewResult.score_soft_skills },
                            { label: 'Communication', score: interviewResult.score_communication },
                          ];
                        }

                        return breakdown.map((item, idx) => (
                          <div key={idx} className={`bg-slate-900 p-4 rounded-2xl border border-slate-800/50 text-center ${breakdown.length % 3 !== 0 && idx === breakdown.length - 1 ? 'sm:col-span-3' : ''}`}>
                            <p className="text-xs text-slate-400 mb-1 uppercase tracking-wider">{item.label}</p>
                            <p className={`text-2xl font-black ${isThesisResult(interviewResult) ? 'text-purple-400' : 'text-program-accent'}`}>{item.score || 0}</p>
                          </div>
                        ));
                      })()}
                    </div>

                    {interviewResult.feedback_summary && (
                      <div className={`p-6 rounded-2xl mt-6 text-left border ${isThesisResult(interviewResult)
                        ? 'bg-purple-500/10 border-purple-500/20'
                        : 'program-accent-surface program-accent-border'
                        }`}>
                        <h4 className={`text-sm uppercase tracking-wider font-bold mb-3 ${isThesisResult(interviewResult) ? 'text-purple-400' : 'text-program-accent'
                          }`}>AI Feedback Summary</h4>
                        <p className="text-sm text-slate-300 leading-relaxed">{interviewResult.feedback_summary}</p>
                      </div>
                    )}

                    <button onClick={() => { setInterviewResult(null); setActiveTab(prevTab as any); }} className="w-full mt-6 py-4 bg-slate-800 hover:bg-slate-700 text-white text-base rounded-xl font-bold transition-colors shadow-lg">
                      Back
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full space-y-5"
              >
                <div>
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Profile</h1>
                  <p className="text-lg text-slate-400 mt-2">Manage your account details and profile picture.</p>
                </div>

                <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
                  <div className="flex items-center gap-5 sm:gap-6">
                    {/* Profile Picture with Camera Overlay */}
                    <div className="relative group">
                      <ProfileAvatar
                        name={profile.name}
                        imageUrl={profile.profilePicture}
                        className="group-hover-program-accent-border h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-slate-700 transition-colors"
                        initialClassName="text-3xl"
                      />
                      {/* Camera Overlay Trigger */}
                      <label className="program-accent-button absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-lg transform translate-x-1 translate-y-1 transition-all hover:scale-110 active:scale-95 z-10 border-2 border-slate-900">
                        <Camera className="w-4 h-4" />
                        <input
                          type="file"
                          accept="image/png, image/jpeg"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-1">
                      <h3 className="text-2xl font-bold text-slate-100 tracking-tight">{profile.name}</h3>
                      <p className="text-sm text-slate-400 font-medium">Click the camera to update photo</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
                    {/* Name */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Full Name</label>
                      <input
                        type="text"
                        value={profile.name}
                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                      />
                    </div>

                    {/* Email */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Email Address <span className="text-slate-500 ml-1 font-normal">(Read only)</span></label>
                      <input
                        type="email"
                        value={profile.email}
                        readOnly
                        title="Email address cannot be changed"
                        className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed transition-all duration-300"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Password</label>
                      <input
                        type="password"
                        value={profile.password || ''}
                        onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                        placeholder="••••••••"
                      />
                    </div>

                    {/* Department */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Department</label>
                      <input
                        type="text"
                        value={profile.department}
                        onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    {isSaved && (
                      <span className="text-emerald-400 text-sm font-medium animate-pulse">
                        Settings saved successfully!
                      </span>
                    )}
                    <button
                      onClick={() => setActiveTab('dashboard')}
                      className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors border border-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="program-accent-button px-6 py-3 rounded-xl font-semibold transition-colors shadow-lg disabled:opacity-50"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}



          </div>
        </main>
      </div>
    </>
  );
};
