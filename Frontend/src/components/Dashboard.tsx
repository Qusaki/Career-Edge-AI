import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { ProfessorModel } from './ProfessorModel';
import { PreTestPage } from './PreTestPage';
import { DrillsPage } from './DrillsPage';
import { PostTestPage } from './PostTestPage';
import { useWebLLM } from '../hooks/useWebLLM';
import { useEyeContactTracker } from '../hooks/useEyeContactTracker';
import { db } from '../db';
import { CLEAR_AI_SPEECH_PITCH, CLEAR_AI_SPEECH_RATE, CLEAR_AI_SPEECH_VOLUME, getClearSpeechTimeoutMs } from '../utils/speech';
import { API_URL } from '../config/api';
import { getProgramAccentTheme } from '../config/programTheme';
import {
  buildActivityComparison,
  getCommunicationSkillScore,
  getEnrollmentEvaluationTotal,
  getNormalizedActivityScore,
  getThesisEvaluationTotal,
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
  Dumbbell,
  ClipboardCheck
} from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pre-test' | 'drills' | 'post-test' | 'history' | 'analytics' | 'profile' | 'settings' | 'interview-type' | 'university-setup' | 'new-interview' | 'interview-session' | 'interview-result' | 'thesis-setup' | 'thesis-session'>(() => {
    if (window.location.pathname === '/pre-test') return 'pre-test';
    if (window.location.pathname === '/drills') return 'drills';
    if (window.location.pathname === '/post-test') return 'post-test';
    return 'dashboard';
  });
  const shouldLoadInterviewAI = ['interview-type', 'university-setup', 'new-interview', 'interview-session', 'thesis-setup', 'thesis-session'].includes(activeTab);
  const {
    engine: webLLMEngine,
    isLoading: isLlmLoading,
    progress: llmProgress,
    status: llmStatus,
    error: llmError,
    isReady: isLlmReady,
    hasError: hasLlmError,
    retry: retryWebLLM
  } = useWebLLM('Llama-3.2-1B-Instruct-q4f16_1-MLC', shouldLoadInterviewAI);
  const [isModuleSessionMode, setIsModuleSessionMode] = useState(false);
  const [prevTab, setPrevTab] = useState<string>('dashboard');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
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
  const [isFinishingInterview, setIsFinishingInterview] = useState(false);
  const [showProfilePass, setShowProfilePass] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewResult, setInterviewResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [communicationHistory, setCommunicationHistory] = useState<any[]>([]);
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    password: '',
    department: '',
    profilePicture: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1'
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
  } as React.CSSProperties;

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
      description: 'Camera-based eye direction and head movement measured during Enrollment, Thesis, Pre-Test, and Post-Test activities. Drills are excluded.',
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
          ...completedModules.filter(item => item._source !== 'drills'),
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
      else if (route === '/profile') setActiveTab('profile');
      else setActiveTab('dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const fetchHistory = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/upcoming-student-interview/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Enrollment history request failed with ${res.status}.`);
      const data = await res.json();
      setInterviewHistory(data);
      db.history.put({ id: 1, type: 'upcoming', data: data, timestamp: Date.now() }).catch(console.error);
    } catch (e) {
      console.warn("Offline: loading interview history from cache");
      const cached = await db.history.get(1);
      const data = cached ? cached.data : [];

      const offlineSessions = await db.offlineSessions.toArray();
      const offlineUpcoming = offlineSessions.filter(s => s.type === 'upcoming').map(s => {
        const totalScore = getEnrollmentEvaluationTotal(s.evaluation || {}, profile.department);
        return {
          id: s.localId,
          status: s.status === 'pending_sync' ? 'pending_sync' : 'completed',
          start_time: new Date(s.timestamp).toISOString(),
          total_score: totalScore,
          passed: totalScore >= 70,
          isOffline: true
        };
      });

      setInterviewHistory([...offlineUpcoming, ...data]);
    }
  }, [API_URL, profile.department]);

  const fetchThesisHistory = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/thesis-interview/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Thesis history request failed with ${res.status}.`);
      const data = await res.json();
      setThesisHistory(data);
      db.history.put({ id: 2, type: 'thesis', data: data, timestamp: Date.now() }).catch(console.error);
    } catch (e) {
      console.warn("Offline: loading thesis history from cache");
      const cached = await db.history.get(2);
      const data = cached ? cached.data : [];

      const offlineSessions = await db.offlineSessions.toArray();
      const offlineThesis = offlineSessions.filter(s => s.type === 'thesis').map(s => {
        const totalScore = getThesisEvaluationTotal(s.evaluation || {}, profile.department);
        return {
          id: s.localId,
          status: s.status === 'pending_sync' ? 'pending_sync' : 'completed',
          start_time: new Date(s.timestamp).toISOString(),
          total_score: totalScore,
          passed: totalScore >= 70,
          isOffline: true
        };
      });

      setThesisHistory([...offlineThesis, ...data]);
    }
  }, [API_URL, profile.department]);

  const fetchCommunicationHistory = React.useCallback(async () => {
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
    const syncOfflineData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const pendingSessions = await db.offlineSessions.where('status').equals('pending_sync').toArray();
        if (pendingSessions.length === 0) return;

        console.log(`Syncing ${pendingSessions.length} offline sessions to cloud...`);

        for (const session of pendingSessions) {
          const endpointPrefix = session.type === 'upcoming' ? '/upcoming-student-interview' : '/thesis-interview';

          // Step 1: Start
          const startRes = await fetch(`${API_URL}${endpointPrefix}/start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
          });
          if (!startRes.ok) continue; // Try again later

          const startData = await startRes.json();
          const realId = startData.id;

          // Step 2: Complete
          const completeRes = await fetch(`${API_URL}${endpointPrefix}/${realId}/complete`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation: session.conversationLog, evaluation: session.evaluation })
          });

          if (completeRes.ok) {
            await db.offlineSessions.update(session.localId, { status: 'synced' });
            console.log(`Synced session ${session.localId} -> ${realId}`);
          }
        }

        // Refresh history
        fetchHistory();
        fetchThesisHistory();
        fetchCommunicationHistory();
      } catch (e) {
        console.error("Sync failed", e);
      }
    };

    window.addEventListener('online', syncOfflineData);
    // Also try syncing on component mount if online
    if (navigator.onLine) {
      syncOfflineData();
    }

    const fetchUser = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          // If no token, maybe we shouldn't force logout immediately if we are offline, 
          // but if there's no token, we can't even authenticate offline.
          onLogout();
          return;
        }

        const res = await fetch(`${API_URL}/users/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          const p = {
            name: `${data.firstname || ''} ${data.middlename || ''} ${data.lastname || ''}`.replace(/\s+/g, ' ').trim() || 'Guest User',
            email: data.email || '',
            password: '',
            department: data.department || '',
            profilePicture: data.profile_picture_url || `https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1`
          };
          setProfile(p);

          db.profile.put({
            id: 1,
            email: p.email,
            first_name: p.name,
            department: p.department,
            profile_picture_url: p.profilePicture
          }).catch(console.error);

        } else {
          onLogout();
        }
      } catch (error) {
        console.error('Failed to fetch user, trying offline cache:', error);
        try {
          const cached = await db.profile.get(1);
          if (cached) {
            setProfile({
              name: cached.first_name || 'Guest User',
              email: cached.email || '',
              password: '',
              department: cached.department || '',
              profilePicture: cached.profile_picture_url || `https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1`
            });
          } else {
            // If completely failed and no cache
            onLogout();
          }
        } catch (e) { }
      }
    };
    fetchUser();
    fetchHistory();
    fetchThesisHistory();
    fetchCommunicationHistory();
  }, [API_URL, onLogout, fetchHistory, fetchThesisHistory, fetchCommunicationHistory]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchHistory();
      fetchThesisHistory();
      fetchCommunicationHistory();
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
      if (!token) return;

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
        const updatedUser = await res.json();
        setProfile({
          name: `${updatedUser.firstname || ''} ${updatedUser.middlename || ''} ${updatedUser.lastname || ''}`.replace(/\s+/g, ' ').trim() || 'Guest User',
          email: updatedUser.email || '',
          password: '',
          department: updatedUser.department || '',
          profilePicture: updatedUser.profile_picture_url || profile.profilePicture
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
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [conversationLog, setConversationLog] = useState<{ sender: 'user' | 'ai', text: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  const recognitionRef = React.useRef<any>(null);
  const audioQueueRef = React.useRef<string[]>([]);
  const isPlayingRef = React.useRef(false);
  const isAiSpeakingRef = React.useRef(false);
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

  const transcriptRef = React.useRef('');
  const isListeningRef = React.useRef(false);
  const submitTranscriptOnEndRef = React.useRef(false);
  const recognitionRestartTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionStopTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartInterviewRecognitionRef = React.useRef<(() => void) | null>(null);
  const userAudioContextRef = React.useRef<AudioContext | null>(null);
  const userAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const userMediaStreamRef = React.useRef<MediaStream | null>(null);
  const userAnimationRef = React.useRef<number>(0);
  const [userAudioData, setUserAudioData] = useState<number[]>(new Array(3).fill(8));
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isMicTransitioning, setIsMicTransitioning] = useState(false);

  const processorRef = React.useRef<ScriptProcessorNode | null>(null);

  useEffect(() => {
    const resumeInterviewMic = () => {
      if (
        document.visibilityState === 'visible' &&
        isListeningRef.current &&
        !recognitionRef.current &&
        !recognitionRestartTimeoutRef.current
      ) {
        restartInterviewRecognitionRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', resumeInterviewMic);
    return () => document.removeEventListener('visibilitychange', resumeInterviewMic);
  }, []);



  const updateUserAudioData = () => {
    if (userAnalyserRef.current && isListeningRef.current) {
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

  const handleLocalWebLLM = async (userText: string, currentMessages: any[]) => {
    const unavailableMessage = getWebLLMUnavailableMessage();
    if (unavailableMessage) {
      alert(unavailableMessage);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      return;
    }

    // Add user message to state
    const newMessages = [...currentMessages, { role: 'user', content: userText }];
    setChatMessages(newMessages);

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
      const responseStream = await webLLMEngine!.chat.completions.create({
        messages: newMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 220,
      });

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

      for await (const chunk of responseStream) {
        if (!isAiSpeakingRef.current) break; // Abort if user left the room early

        const delta = chunk.choices[0]?.delta?.content || "";
        fullResponse += delta;
        sentenceBuffer += delta;
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

      if (sentenceBuffer.trim() && isAiSpeakingRef.current) {
        const cleanText = sentenceBuffer.replace(/[*_#]/g, '').trim();
        if (cleanText) {
          enqueueTts(cleanText);
        }
      }

      await (ttsProcessingPromise || Promise.resolve());

      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      setMouthValue(0);

      setChatMessages(prev => [...prev, { role: 'assistant', content: fullResponse }]);
      const turn = { sender: 'ai' as const, text: fullResponse.trim() };
      if (activeInterviewModeRef.current === 'thesis') {
        setThesisConversationLog(prev => [...prev, turn]);
      } else {
        setConversationLog(prev => [...prev, turn]);
      }

      if (!isListeningRef.current) {
        toggleListening();
      }

    } catch (e) {
      console.error(e);
      setAiResponseText("Local AI Error.");
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
    }
  };

  const startInterviewSession = async () => {
    const unavailableMessage = getWebLLMUnavailableMessage();
    if (unavailableMessage) {
      alert(unavailableMessage);
      return;
    }
    // Unlock speech synthesis immediately on user click
    unlockBrowserSpeech();
    setIsStartingInterview(true);
    let sid: string | number = '';
    let isOffline = false;
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
    } catch (err: any) {
      console.warn("Offline: generating local session ID");
      sid = 'local_' + Date.now();
      isOffline = true;
    } finally {
      setIsStartingInterview(false);
    }

    if (sid) {
      setIsCameraEnabled(false);
      sessionIdRef.current = sid as number;
      setSessionId(sid as number);
      activeInterviewModeRef.current = 'enrollment';
      setActiveTab('interview-session');

      const systemPrompt = "You are Professor Maxiel, an expert interviewer. Your sole purpose is to interview an incoming college freshman. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude when finished.";
      const initialMsgs = [{ role: 'system', content: systemPrompt }];
      setChatMessages(initialMsgs);

      handleLocalWebLLM("Hello! I am here and ready to begin the interview.", initialMsgs);
    }
  };

  const releaseInterviewMicrophone = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    userMediaStreamRef.current?.getTracks().forEach(track => track.stop());
    userMediaStreamRef.current = null;
    if (userAudioContextRef.current) {
      void userAudioContextRef.current.close();
      userAudioContextRef.current = null;
    }
    cancelAnimationFrame(userAnimationRef.current);
    setUserAudioData([8, 8, 8]);
  };

  const submitInterviewTranscript = () => {
    if (recognitionStopTimeoutRef.current) {
      clearTimeout(recognitionStopTimeoutRef.current);
      recognitionStopTimeoutRef.current = null;
    }
    releaseInterviewMicrophone();
    setIsMicTransitioning(false);
    submitTranscriptOnEndRef.current = false;
    const finalTranscript = transcriptRef.current.replace(/\s+/g, ' ').trim();
    if (!finalTranscript) return;

    const turn = { sender: 'user' as const, text: finalTranscript };
    if (activeInterviewModeRef.current === 'thesis') {
      setThesisConversationLog(prev => [...prev, turn]);
    } else {
      setConversationLog(prev => [...prev, turn]);
    }

    setChatMessages((prev) => {
      const newMessages = [...prev, { role: 'user', content: finalTranscript }];
      setTimeout(() => handleLocalWebLLM(finalTranscript, prev), 0);
      return newMessages;
    });
  };

  const stopListening = (submitTranscript = false) => {
    setIsListening(false);
    isListeningRef.current = false;
    submitTranscriptOnEndRef.current = submitTranscript;
    setIsMicTransitioning(submitTranscript);

    if (recognitionRestartTimeoutRef.current) {
      clearTimeout(recognitionRestartTimeoutRef.current);
      recognitionRestartTimeoutRef.current = null;
    }
    if (recognitionStopTimeoutRef.current) {
      clearTimeout(recognitionStopTimeoutRef.current);
      recognitionStopTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        // Let SpeechRecognition flush its last phrase before onend submits it.
        recognitionRef.current.stop();
        if (submitTranscript) {
          const recognition = recognitionRef.current;
          recognitionStopTimeoutRef.current = setTimeout(() => {
            if (recognitionRef.current === recognition) recognitionRef.current = null;
            submitInterviewTranscript();
          }, 1500);
        }
      } catch {
        recognitionRef.current = null;
        if (submitTranscriptOnEndRef.current) submitInterviewTranscript();
        else setIsMicTransitioning(false);
      }
    } else if (submitTranscriptOnEndRef.current) {
      submitInterviewTranscript();
    } else {
      setIsMicTransitioning(false);
    }

    if (!submitTranscript) releaseInterviewMicrophone();
  };

  const exitInterview = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    stopListening();
    setIsLeaveModalOpen(false);
    setIsAiSpeaking(false);
    setIsListening(false);
    setSessionId(null);
    setConversationLog([]);
    setInterviewResult(null);
    setIsCameraEnabled(false);
    sessionIdRef.current = null;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = "";
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    fetchHistory();
    setActiveTab('dashboard');
  };

  const finishInterviewSession = async () => {
    if (!sessionId) return;
    setIsFinishingInterview(true);
    let evaluation = null;

    try {
      if (webLLMEngine) {
        const department = profile.department.trim().toUpperCase();
        const gradingSchema = department === 'CTE' ? `{
  "subject_matter_score": 0,
  "teaching_aptitude_score": 0,
  "communication_score": 0,
  "motivation_score": 0,
  "academic_preparedness_score": 0,
  "problem_solving_score": 0,
  "leadership_score": 0,
  "feedback_summary": "string"
}` : department === 'CBAPA' ? `{
  "business_fundamentals_score": 0,
  "analytical_score": 0,
  "communication_score": 0,
  "entrepreneurial_score": 0,
  "academic_preparedness_score": 0,
  "leadership_score": 0,
  "ethical_score": 0,
  "feedback_summary": "string"
}` : `{
  "technical_score": 0,
  "problem_solving_score": 0,
  "coding_score": 0,
  "communication_score": 0,
  "soft_skills_score": 0,
  "feedback_summary": "string"
}`;
        const gradingPrompt = `You are a strict grading algorithm. You will evaluate the following transcript of an incoming college freshman interview.
Score every listed criterion from 0 to 100. Respond in STRICT JSON matching this schema exactly:
${gradingSchema}
Transcript:
${conversationLog.map(m => m.sender.toUpperCase() + ": " + m.text).join('\n')}`;

        const resp = await webLLMEngine.chat.completions.create({
          messages: [{ role: 'user', content: gradingPrompt }],
          response_format: { type: "json_object" }
        });

        try {
          evaluation = JSON.parse(resp.choices[0].message.content || "{}");
        } catch (e) {
          console.error("Failed to parse local evaluation", e);
        }
      }

      evaluation = {
        ...(evaluation || {}),
        eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
        score_eye_contact: eyeTracker.samples > 0 ? eyeTracker.score : null,
        eye_contact_samples: eyeTracker.samples,
      };
      const offlineTotalScore = getEnrollmentEvaluationTotal(evaluation, profile.department);
      evaluation.total_score = offlineTotalScore;

      if (String(sessionId).startsWith('local_')) {
        // It's an offline session, save to IndexedDB directly
        await db.offlineSessions.put({
          localId: String(sessionId),
          type: 'upcoming',
          status: 'pending_sync',
          conversationLog: conversationLog,
          evaluation: evaluation,
          timestamp: Date.now()
        });

        setInterviewResult({ ...evaluation, total_score: offlineTotalScore, passed: offlineTotalScore >= 70 });
        stopListening();
        setIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        setIsListening(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        return;
      }

      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/upcoming-student-interview/${sessionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation: conversationLog, evaluation })
      });
      if (response.ok) {
        const data = await response.json();
        setInterviewResult(data);
        stopListening();
        setIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        setIsListening(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        alert("Failed to grade interview. Please try again.");
      }
    } catch (e) {
      console.warn("Offline: saving completed session to cache");
      // If network fails during complete
      await db.offlineSessions.put({
        localId: String(sessionId), // Can be real ID if it was created before going offline
        type: 'upcoming',
        status: 'pending_sync',
        conversationLog: conversationLog,
        evaluation: evaluation,
        timestamp: Date.now()
      });

      const offlineTotalScore = getEnrollmentEvaluationTotal(evaluation || {}, profile.department);
      setInterviewResult({ ...evaluation, total_score: offlineTotalScore, passed: offlineTotalScore >= 70 });
      stopListening();
      setIsLeaveModalOpen(false);
      setIsAiSpeaking(false);
      setIsListening(false);
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
    } finally {
      setIsFinishingInterview(false);
      // Refresh history to show the new offline session
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

  const uploadThesisAbstractInSession = async (file: File) => {
    if (!thesisSessionIdRef.current || thesisInSessionUploading) return;
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
    const unavailableMessage = getWebLLMUnavailableMessage();
    if (unavailableMessage) {
      alert(unavailableMessage);
      return;
    }
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

    setThesisIsStarting(true);
    let sid: string | number = '';
    let isOffline = false;
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
    } catch (err: any) {
      console.warn("Offline: generating local thesis session ID");
      sid = 'local_' + Date.now();
      isOffline = true;
    }

    if (sid) {
      setIsCameraEnabled(false);
      thesisSessionIdRef.current = sid as number;
      setThesisSessionId(sid as number);

      let abstractText = "";
      if (thesisAbstractFile) {
        setThesisAbstractUploading(true);
        try {
          if (thesisAbstractFile.name.endsWith('.txt')) {
            abstractText = await thesisAbstractFile.text();
          } else if (thesisAbstractFile.name.endsWith('.pdf')) {
            const arrayBuffer = await thesisAbstractFile.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = "";
            // Only parse first 10 pages to save time/memory
            const maxPages = Math.min(pdf.numPages, 10);
            for (let i = 1; i <= maxPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map((item: any) => item.str).join(' ');
              fullText += pageText + "\n";
            }
            abstractText = fullText;
          }
        } catch (e) {
          console.error('Abstract parsing failed:', e);
          setThesisStartError("Failed to read abstract file offline.");
          setThesisAbstractUploading(false);
          setThesisIsStarting(false);
          return;
        } finally {
          setThesisAbstractUploading(false);
        }
      }

      setThesisConversationLog([]);
      setThesisResult(null);
      setThesisElapsedSeconds(0);
      activeInterviewModeRef.current = 'thesis';
      setActiveTab('thesis-session');
      if (thesisTimerRef.current) clearInterval(thesisTimerRef.current);
      thesisTimerRef.current = setInterval(() => setThesisElapsedSeconds(prev => prev + 1), 1000);

      // WebLLM Setup
      const systemPrompt = `You are Professor Maxiel, an expert panelist for a thesis defense at ${dep}. Probe the student's research abstract. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude gracefully when finished.\n\nStudent's Abstract/Proposal context:\n${abstractText ? abstractText.substring(0, 5000) : 'None provided.'}`; // Truncate to 5000 chars to avoid token limits
      const initialMsgs = [{ role: 'system', content: systemPrompt }];
      setChatMessages(initialMsgs);

      handleLocalWebLLM("Hello! I am here and ready to begin the thesis defense.", initialMsgs);
      setThesisIsStarting(false);
    }
  };

  const exitThesisSession = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    stopListening();
    if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
    setThesisIsLeaveModalOpen(false);
    setIsAiSpeaking(false);
    isAiSpeakingRef.current = false;
    setIsListening(false);
    setThesisSessionId(null);
    thesisSessionIdRef.current = null;
    setThesisConversationLog([]);
    setThesisResult(null);
    setIsCameraEnabled(false);
    setThesisAbstractFile(null);
    setThesisElapsedSeconds(0);
    setAiResponseText('');
    activeInterviewModeRef.current = null;
    if (thesisWsRef.current) { thesisWsRef.current.close(); thesisWsRef.current = null; }
    if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current.src = ''; }
    nextPlayTimeRef.current = 0;
    fetchThesisHistory();
    setActiveTab('dashboard');
  };

  const finishThesisSession = async () => {
    if (!thesisSessionIdRef.current) return;
    setThesisIsFinishing(true);
    let evaluation = null;

    try {
      if (webLLMEngine) {
        const department = profile.department.trim().toUpperCase();
        const gradingSchema = department === 'CTE' ? `{
  "pedagogical_innovation_score": 0,
  "action_research_score": 0,
  "learning_outcomes_score": 0,
  "literature_alignment_score": 0,
  "teaching_demo_score": 0,
  "scalability_policy_score": 0,
  "feedback_summary": "string"
}` : department === 'CBAPA' ? `{
  "research_problem_score": 0,
  "methodology_analysis_score": 0,
  "practical_roi_score": 0,
  "literature_theoretical_score": 0,
  "professional_delivery_score": 0,
  "feedback_summary": "string"
}` : `{
  "technical_innovation_score": 0,
  "system_implementation_score": 0,
  "experimental_validation_score": 0,
  "literature_review_score": 0,
  "demo_quality_score": 0,
  "feedback_summary": "string"
}`;
        const gradingPrompt = `You are a strict grading algorithm. Evaluate the transcript of this thesis defense.
Score every listed criterion from 0 to 100. Respond in STRICT JSON matching this schema exactly:
${gradingSchema}
Transcript:
${thesisConversationLog.map(m => m.sender.toUpperCase() + ": " + m.text).join('\n')}`;

        const resp = await webLLMEngine.chat.completions.create({
          messages: [{ role: 'user', content: gradingPrompt }],
          response_format: { type: "json_object" }
        });

        try {
          evaluation = JSON.parse(resp.choices[0].message.content || "{}");
          if (evaluation.technical_innovation_score) {
            evaluation.score_ccit_technical_innovation = evaluation.technical_innovation_score;
          }
        } catch (e) {
          console.error("Failed to parse local thesis evaluation", e);
        }
      }

      evaluation = {
        ...(evaluation || {}),
        eye_contact_score: eyeTracker.samples > 0 ? eyeTracker.score : null,
        score_eye_contact: eyeTracker.samples > 0 ? eyeTracker.score : null,
        eye_contact_samples: eyeTracker.samples,
      };
      const offlineTotalScore = getThesisEvaluationTotal(evaluation, profile.department);
      evaluation.total_score = offlineTotalScore;

      if (String(thesisSessionIdRef.current).startsWith('local_')) {
        // Offline mode
        await db.offlineSessions.put({
          localId: String(thesisSessionIdRef.current),
          type: 'thesis',
          status: 'pending_sync',
          conversationLog: thesisConversationLog,
          evaluation: evaluation,
          timestamp: Date.now()
        });

        setThesisResult({ ...evaluation, total_score: offlineTotalScore, passed: offlineTotalScore >= 70 });
        stopListening();
        setThesisIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        setIsListening(false);
        if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        return;
      }

      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/thesis-interview/${thesisSessionIdRef.current}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ conversation: thesisConversationLog, evaluation })
      });
      if (response.ok) {
        const data = await response.json();
        setThesisResult(data);
        stopListening();
        setThesisIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        setIsListening(false);
        if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        alert('Failed to grade thesis defense. Please try again.');
      }
    } catch (e) {
      console.warn("Offline: saving completed thesis session to cache");
      await db.offlineSessions.put({
        localId: String(thesisSessionIdRef.current),
        type: 'thesis',
        status: 'pending_sync',
        conversationLog: thesisConversationLog,
        evaluation: evaluation,
        timestamp: Date.now()
      });

      const offlineTotalScore = getThesisEvaluationTotal(evaluation || {}, profile.department);
      setThesisResult({ ...evaluation, total_score: offlineTotalScore, passed: offlineTotalScore >= 70 });
      stopListening();
      setThesisIsLeaveModalOpen(false);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      setIsListening(false);
      if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
    } finally {
      setThesisIsFinishing(false);
      fetchThesisHistory();
    }
  };

  const sendToGemini = async (text: string) => {
    setAiResponseText('');
    setIsAiSpeaking(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ text, end_of_turn: true }));
    } else {
      setAiResponseText('Connection error. WebSocket dropped.');
      setIsAiSpeaking(false);
    }
  };

  // Keep the mic on continuously for the duration of the interview
  // Removed the auto-stop and auto-restart client-side silence logic 
  // to allow Gemini's server-side Voice Activity Detection to operate.

  const toggleListening = async () => {
    if (isMicTransitioning) return;
    if (isListeningRef.current) {
      stopListening(true);
    } else {
      setTranscript('');
      transcriptRef.current = '';
      setAiResponseText('');

      isPlayingRef.current = false;
      setIsAiSpeaking(false);
      cancelAnimationFrame(animationRef.current);
      setAudioData(new Array(15).fill(20));
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      audioQueueRef.current = [];

      setIsListening(true);
      isListeningRef.current = true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        userMediaStreamRef.current = stream;

        // Native 16000Hz sampling purely for cosmetic visualization context
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        userAudioContextRef.current = ctx;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        userAnalyserRef.current = ctx.createAnalyser();
        userAnalyserRef.current.fftSize = 64;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(userAnalyserRef.current);

        updateUserAudioData();

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          let recognitionRetryCount = 0;

          const scheduleRecognitionRestart = (delay = 250) => {
            if (!isListeningRef.current || recognitionRestartTimeoutRef.current) return;
            recognitionRestartTimeoutRef.current = setTimeout(() => {
              recognitionRestartTimeoutRef.current = null;
              startRecognition();
            }, delay);
          };

          function startRecognition() {
            if (!isListeningRef.current) return;

            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (e: any) => {
              if (isAiSpeakingRef.current) return;
              recognitionRetryCount = 0;
              let finalTranscript = '';
              for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                  finalTranscript += e.results[i][0].transcript;
                }
              }

              if (finalTranscript) {
                transcriptRef.current = [transcriptRef.current, finalTranscript.trim()]
                  .filter(Boolean)
                  .join(' ');
                setTranscript(transcriptRef.current);
              }
            };

            recognition.onerror = (e: any) => {
              if (e?.error === 'no-speech' || e?.error === 'aborted' || e?.error === 'network') {
                if (recognitionRef.current === recognition) recognitionRef.current = null;
                recognitionRetryCount += 1;
                try {
                  recognition.abort();
                } catch {
                  // The browser may already have ended this recognizer.
                }
                const delay = e?.error === 'network'
                  ? Math.min(4000, 500 * (2 ** Math.min(recognitionRetryCount, 3)))
                  : 250;
                scheduleRecognitionRestart(delay);
                return;
              }

              console.error("STT Error", e);
              stopListening(false);
            };
            recognition.onend = () => {
              if (recognitionRef.current === recognition) recognitionRef.current = null;
              if (isListeningRef.current) {
                scheduleRecognitionRestart(250);
              } else if (submitTranscriptOnEndRef.current) {
                submitInterviewTranscript();
              } else {
                setIsMicTransitioning(false);
              }
            };

            recognitionRef.current = recognition;
            try {
              recognition.start();
            } catch (error) {
              if (recognitionRef.current === recognition) recognitionRef.current = null;
              console.warn("Speech recognition is temporarily busy; retrying.", error);
              recognitionRetryCount += 1;
              scheduleRecognitionRestart(Math.min(2000, 300 * recognitionRetryCount));
            }
          }

          restartInterviewRecognitionRef.current = startRecognition;
          startRecognition();
        } else {
          console.warn("Speech Recognition not supported in this browser.");
          stopListening(false);
        }
      } catch (err) {
        console.error("Could not capture local audio for streaming:", err);
        setIsListening(false);
        isListeningRef.current = false;
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
    ? 'Validating your responses and preparing your interview result...'
    : enrollmentResponseCount >= 5
      ? 'All five responses are recorded. Click “Validate Responses” in the transcript panel to receive your result.'
      : isMicTransitioning
        ? 'Submitting your response. Please wait for Professor Maxiel’s next question.'
        : isListening
          ? 'Your microphone is recording. When you finish speaking, click the microphone again to submit your response.'
          : isAiSpeaking
            ? 'Listen carefully to Professor Maxiel. When the question ends, click the microphone to start your response.'
            : 'Click the microphone to start answering. After speaking, click it again to stop and submit your response.';

  return (
    <>
      {isLlmLoading && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center text-white"
          style={programAccentStyle}
        >
          <div className="program-accent-spinner w-16 h-16 border-4 rounded-full animate-spin mb-6"></div>
          <h2 className="program-accent-on-dark text-3xl font-black mb-2">Downloading AI Brain...</h2>
          <p className="text-slate-300 max-w-md text-lg leading-relaxed mb-4">Please wait while the WebLLM model is loaded into your browser memory. This happens ONLY the first time you run the app!</p>
          <div className="bg-slate-900 border border-slate-700 px-6 py-4 rounded-2xl w-full max-w-md">
            <p className="program-accent-on-dark font-mono text-sm mb-2">{llmStatus}</p>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <div className="program-accent-fill h-full transition-all duration-300" style={{ width: `${llmProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}
      {hasLlmError && ['interview-type', 'university-setup', 'new-interview', 'interview-session', 'thesis-setup', 'thesis-session'].includes(activeTab) && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center text-white"
          style={programAccentStyle}
        >
          <div className="w-full max-w-lg rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-3xl font-black mb-3 text-rose-300">WebLLM Could Not Start</h2>
            <p className="text-slate-300 leading-relaxed mb-4">
              The interview AI runs locally in your browser with WebGPU. Use Chrome or Edge with hardware acceleration enabled, then try again.
            </p>
            <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left">
              <p className="font-mono text-sm text-rose-200 break-words">{llmError || llmStatus}</p>
            </div>
            <button
              onClick={retryWebLLM}
              className="program-accent-button mt-5 rounded-xl px-5 py-3 font-bold transition-colors"
            >
              Retry WebLLM
            </button>
          </div>
        </div>
      )}
      <div
        className="dashboard-shell min-h-screen bg-page text-ink flex overflow-hidden"
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
                <Dumbbell className="w-5 h-5" />
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
                  activeTab === 'profile' || isAccountMenuOpen ? 'bg-active' : 'bg-transparent hover:bg-active'
                }`}
              >
                <div className="program-accent-border h-10 w-10 shrink-0 overflow-hidden rounded-full border bg-slate-800">
                  <img
                    src={profile.profilePicture}
                    alt={`${profile.name || 'User'} profile`}
                    className="h-full w-full object-cover"
                  />
                </div>
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
                  <h1 className="text-4xl md:text-5xl font-bold text-ink tracking-tight">Welcome back, <span className="text-program-accent">{profile.name.split(' ')[0]}</span></h1>
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

            {activeTab === 'pre-test' && <PreTestPage apiUrl={API_URL} onSessionModeChange={setIsModuleSessionMode} />}

            {activeTab === 'drills' && <DrillsPage apiUrl={API_URL} onSessionModeChange={setIsModuleSessionMode} />}

            {activeTab === 'post-test' && <PostTestPage apiUrl={API_URL} onSessionModeChange={setIsModuleSessionMode} />}

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
                      {isStartingInterview ? 'Starting...' : 'Continue'}
                      {!isStartingInterview && <ArrowRight className="w-5 h-5" />}
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
                      <div className="absolute bottom-4 right-4 z-20 w-44 overflow-hidden rounded-xl border border-purple-400/40 bg-slate-950 shadow-xl">
                        <video ref={eyeTracker.videoRef} muted playsInline className="aspect-video w-full scale-x-[-1] object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-slate-200">
                          <span>{eyeTracker.status === 'tracking' ? 'Eye contact' : eyeTracker.status === 'blocked' ? 'Camera blocked' : eyeTracker.status === 'unavailable' ? 'Tracking unavailable' : 'Loading tracker'}</span>
                          <span className="text-purple-300">{eyeTracker.samples > 0 ? `${eyeTracker.score}%` : '—'}</span>
                        </div>
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
                                  disabled={thesisIsFinishing}
                                  className={`w-full py-3 ${thesisIsFinishing ? 'bg-slate-500 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500'} text-white rounded-xl font-bold transition-all shadow-lg shadow-purple-500/20 text-sm tracking-wide animate-fade-in`}
                                >
                                  {thesisIsFinishing ? 'Grading...' : 'Complete Defense'}
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
                      className={`relative ${isListening ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-slate-800 shadow-slate-900/40'} text-white w-20 h-20 rounded-[2rem] transition-all duration-300 flex items-center justify-center shadow-xl`}
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
              <div className="relative flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[#02040a] lg:overflow-hidden">

                {/* Unified interview room: primary stage and docked transcript */}
                <div className="grid w-full flex-none grid-cols-1 bg-[#02040a] lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_clamp(20rem,24vw,26rem)] lg:grid-rows-[minmax(0,1fr)_auto]">

                  {/* Primary 3D interview stage */}
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative m-3 flex min-h-[52svh] items-center justify-center overflow-hidden rounded-xl border border-[#263449] bg-[#111827] p-0 lg:col-start-1 lg:row-start-1 lg:m-5 lg:min-h-0"
                    style={{ backgroundColor: '#111827' }}
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
                    {isCameraEnabled && (
                      <div className="program-accent-dark-border absolute bottom-3 right-3 z-20 w-36 overflow-hidden rounded-xl border bg-[#0f172a] shadow-xl sm:bottom-4 sm:right-4 sm:w-44">
                        <video ref={eyeTracker.videoRef} muted playsInline className="aspect-video w-full scale-x-[-1] object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-slate-200">
                          <span>{eyeTracker.status === 'tracking' ? 'Eye contact' : eyeTracker.status === 'blocked' ? 'Camera blocked' : eyeTracker.status === 'unavailable' ? 'Tracking unavailable' : 'Loading tracker'}</span>
                          <span className="program-accent-on-dark">{eyeTracker.samples > 0 ? `${eyeTracker.score}%` : '—'}</span>
                        </div>
                      </div>
                    )}
                  </motion.div>

                  {/* Docked transcript and evaluation panel */}
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative flex min-h-[24rem] flex-col overflow-hidden border-t border-[#334155] bg-[#1e293b] p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:border-l lg:border-t-0 lg:p-5"
                    style={{ backgroundColor: 'rgba(30, 41, 59, 0.96)' }}
                  >
                    {interviewResult ? (
                      // --- EVALUATION RESULT UI ---
                      <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pr-2 animate-fade-in">
                        <div className="text-center space-y-3 mb-6 shrink-0 mt-2">
                          <div className={`mx-auto inline-flex items-center justify-center w-20 h-20 rounded-full mb-1 border-4 ${interviewResult.passed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                            <span className="text-2xl font-black">{interviewResult.total_score}%</span>
                          </div>
                          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Interview Complete</h2>
                          <p className="text-xs text-slate-400 leading-relaxed px-2">{interviewResult.passed ? 'Congratulations! You passed the interview.' : 'Keep practicing! You did not meet the passing criteria this time.'}</p>
                        </div>

                        <div className="space-y-4 shrink-0">
                          <h3 className="text-sm font-bold text-slate-200 border-b border-slate-700/50 pb-2">Performance Breakdown</h3>

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
                                <div key={idx} className={`bg-slate-900 p-3 rounded-xl border border-slate-800/50 ${breakdown.length % 2 !== 0 && idx === breakdown.length - 1 ? 'col-span-2 text-center' : ''}`}>
                                  <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider overflow-hidden text-ellipsis whitespace-nowrap" title={item.label}>{item.label}</p>
                                  <p className="text-program-accent text-xl font-black">{item.score || 0}</p>
                                </div>
                              ));
                            })()}
                          </div>

                          <div className="program-accent-surface program-accent-border mt-3 flex items-center justify-between rounded-xl border p-3">
                            <span className="text-xs font-bold uppercase tracking-wider">Camera Eye Contact</span>
                            <span className="text-xl font-black">{(interviewResult.eye_contact_samples || 0) > 0 ? `${Math.round(interviewResult.score_eye_contact)}%` : 'Unavailable'}</span>
                          </div>

                          {interviewResult.feedback_summary && (
                            <div className="program-accent-surface program-accent-border border p-4 rounded-xl mt-4">
                              <h4 className="text-[11px] uppercase tracking-wider font-bold mb-2">AI Feedback</h4>
                              <p className="text-xs text-slate-300 leading-relaxed">{interviewResult.feedback_summary}</p>
                            </div>
                          )}

                          <div className="program-accent-dark-border mt-4 rounded-xl border bg-[#334155] p-3 text-center">
                            <p className="mb-3 text-xs leading-relaxed text-[#e2e8f0]">
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
                        <h3 className="mb-3 shrink-0 border-b border-[#475569] pb-3 text-left text-xs font-bold uppercase tracking-[0.16em] text-[#f8fafc]">Interview Transcript</h3>

                        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 scroll-smooth">
                          {(aiResponseText || isAiSpeaking) && (
                            <div className="program-accent-dark-border rounded-lg border bg-[#334155] p-3 text-[#f8fafc]">
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

                              if (userLogs.length === 0 && !transcript) {
                                return (
                                  <div className="flex flex-1 flex-col items-center justify-center py-8">
                                    <User className="mb-3 h-7 w-7 text-[#94a3b8]" />
                                    <p className="px-4 text-center text-xs leading-relaxed text-[#cbd5e1]">Respond to the AI Professor. Your answers will be tracked here (Limit: 5).</p>
                                  </div>
                                );
                              }

                              return (
                                <>
                                  {userLogs.map((log, idx) => (
                                    <div key={idx} className="flex flex-col items-stretch animate-fade-in">
                                      <span className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-[#cbd5e1]">
                                        You · Response {idx + 1}
                                      </span>
                                      <div className="rounded-lg border border-[#334155] bg-[#0f172a] p-3 text-[#f8fafc]">
                                        <p className="text-xs leading-relaxed">{log.text}</p>
                                      </div>
                                    </div>
                                  ))}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="mt-3 shrink-0 border-t border-[#475569] pt-3">
                          {(() => {
                            const userTurns = conversationLog.filter(l => l.sender === 'user').length;
                            if (userTurns >= 5) {
                              return (
                                <div className="space-y-2 animate-fade-in">
                                  <p className="text-center text-xs leading-relaxed text-[#cbd5e1]">
                                    Five answers are ready. Validate them to calculate your score and feedback.
                                  </p>
                                  <button
                                    onClick={finishInterviewSession}
                                    disabled={isFinishingInterview}
                                    className={`w-full py-3 ${isFinishingInterview ? 'bg-[#64748b] cursor-not-allowed' : 'bg-[#16a34a] hover:bg-[#15803d]'} text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-900/20 text-sm tracking-wide`}
                                  >
                                    {isFinishingInterview ? 'Validating Responses...' : 'Validate Responses'}
                                  </button>
                                </div>
                              );
                            }
                            return (
                              <div className="text-center space-y-1">
                                <span className="block text-xs font-semibold text-[#e2e8f0]">{userTurns} / 5 Responses Recorded</span>
                                <span className="block text-[10px] text-[#94a3b8]">Complete all five responses to unlock validation.</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </motion.div>

                {/* Integrated meeting controls */}
                {!interviewResult && (
                  <div className="grid w-full shrink-0 items-center gap-3 border-t border-[#263449] bg-[#0b1120] px-4 py-3 lg:col-start-1 lg:row-start-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6 lg:px-6">
                    <div
                      role="status"
                      aria-live="polite"
                      className="min-w-0 text-center lg:max-w-2xl lg:text-left"
                    >
                      <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${isListening || enrollmentResponseCount >= 5 ? 'text-[#86efac]' : 'program-accent-on-dark'}`}>How to respond</p>
                      <p className="mt-1 text-xs font-semibold text-[#f8fafc]">Listen → Click microphone → Speak → Click microphone again to submit</p>
                      <p className={`mt-1.5 text-xs leading-relaxed ${isListening ? 'font-semibold text-[#86efac]' : 'text-[#cbd5e1]'}`}>
                        {enrollmentInstruction}
                      </p>
                    </div>

                    <div className="flex items-start justify-center gap-3 sm:gap-4">
                    <div className="relative flex flex-col items-center gap-1">
                      <button
                        onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                        className="group relative flex h-12 w-12 items-center justify-center rounded-lg bg-transparent text-[#cbd5e1] transition-all duration-300 hover:bg-[#171e2e] hover:text-white"
                        title="Add an attachment"
                        aria-label="Add an attachment"
                      >
                        <Plus className={`h-[22px] w-[22px] transition-transform duration-300 ${isAddMenuOpen ? 'rotate-45' : 'group-hover:scale-110'}`} />
                      </button>
                      <span className="text-[11px] font-semibold text-[#cbd5e1]">Attach</span>

                      {/* Attachment Popover */}
                      {isAddMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 w-48 bg-slate-800 border border-slate-700/80 rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden z-[100]"
                        >
                          <div className="flex flex-col p-1.5 space-y-1">
                            <button onClick={() => setIsAddMenuOpen(false)} className="flex items-center gap-3 w-full p-2.5 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all">
                              <div className="program-accent-dark-surface w-7 h-7 rounded-lg flex items-center justify-center shrink-0">
                                <Folder className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-xs font-semibold tracking-wide">Local Disk</span>
                            </button>
                            <button onClick={() => setIsAddMenuOpen(false)} className="flex items-center gap-3 w-full p-2.5 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all">
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
                        disabled={isMicTransitioning || enrollmentResponseCount >= 5}
                        className={`relative ${
                          isListening
                            ? 'program-accent-fill program-accent-border'
                            : isMicTransitioning || enrollmentResponseCount >= 5
                              ? 'border-[#64748b] bg-[#475569] text-[#cbd5e1] cursor-not-allowed'
                              : 'border-[#475569] bg-[#1e293b] text-[#e2e8f0] hover:border-[#64748b] hover:bg-[#334155] shadow-black/40'
                        } flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg transition-all duration-300`}
                        title={isListening ? 'Stop recording and submit answer' : 'Start recording your answer'}
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
                                style={{ backgroundColor: 'var(--program-accent-foreground)' }}
                                animate={{ height: `${height * 0.65}px` }}
                                transition={{ duration: 0.1, ease: 'linear' }}
                              />
                            ))}
                            <Mic className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            {Array.from(userAudioData).reverse().map((height, i) => (
                              <motion.div
                                key={`w-right-${i}`}
                                className="w-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--program-accent-foreground)' }}
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
                              borderColor: 'var(--program-accent)',
                            }}
                          />
                        )}
                      </button>
                      <div className="min-h-7 text-center leading-tight">
                        <span className={`block text-[11px] font-bold ${isListening ? 'program-accent-on-dark' : 'text-[#f8fafc]'}`}>
                          {isListening ? 'Recording...' : isMicTransitioning ? 'Submitting...' : enrollmentResponseCount >= 5 ? 'Answers Complete' : 'Start Answer'}
                        </span>
                        {isListening && <span className="mt-0.5 block text-[10px] font-medium text-[#cbd5e1]">Click to submit</span>}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setIsCameraEnabled(enabled => !enabled)}
                        className={`group flex h-12 w-12 items-center justify-center rounded-lg bg-transparent transition-all duration-300 hover:bg-[#171e2e] ${isCameraEnabled ? 'program-accent-on-dark' : 'text-[#cbd5e1] hover:text-white'}`}
                        title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on for eye-contact tracking'}
                        aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on for eye-contact tracking'}
                        aria-pressed={isCameraEnabled}
                      >
                        {isCameraEnabled ? <Camera className="h-[22px] w-[22px] transition-transform group-hover:scale-110" /> : <CameraOff className="h-[22px] w-[22px] transition-transform group-hover:scale-110" />}
                      </button>
                      <span className={`text-[11px] font-semibold ${isCameraEnabled ? 'program-accent-on-dark' : 'text-[#cbd5e1]'}`}>{isCameraEnabled ? 'Camera On' : 'Camera Off'}</span>
                    </div>
                    </div>
                    <div className="flex justify-center lg:justify-end">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => setIsLeaveModalOpen(true)}
                          className="group relative flex h-12 w-12 items-center justify-center rounded-lg bg-transparent text-[#fda4af] transition-all duration-300 hover:bg-[#3b1420] hover:text-[#fecdd3]"
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

            {/* Placeholders for settings tab */}
            {activeTab === 'settings' && (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-500 text-lg">This section is coming soon.</p>
              </div>
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
                className="max-w-4xl mx-auto space-y-8"
              >
                <div>
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Profile</h1>
                  <p className="text-lg text-slate-400 mt-2">Manage your account details and profile picture.</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-8">
                  <div className="flex items-center gap-8">
                    {/* Profile Picture with Camera Overlay */}
                    <div className="relative group">
                      <div className="group-hover-program-accent-border w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 overflow-hidden shrink-0 transition-colors">
                        <img
                          src={profile.profilePicture}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      </div>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Name */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-300">Full Name</label>
                      <input
                        type="text"
                        value={profile.name}
                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                      />
                    </div>

                    {/* Email */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-300">Email Address <span className="text-slate-500 ml-1 font-normal">(Read only)</span></label>
                      <input
                        type="email"
                        value={profile.email}
                        readOnly
                        title="Email address cannot be changed"
                        className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed transition-all duration-300"
                      />
                    </div>

                    <div className="space-y-3">
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
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-300">Department</label>
                      <input
                        type="text"
                        value={profile.department}
                        onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                        className="program-accent-focus w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 transition-all duration-300"
                      />
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end items-center gap-4">
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
