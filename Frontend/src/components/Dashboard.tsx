import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { ProfessorModel } from './ProfessorModel';
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
  Lock
} from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'profile' | 'settings' | 'interview-type' | 'university-setup' | 'new-interview' | 'interview-session' | 'interview-result'>('dashboard');
  const [prevTab, setPrevTab] = useState<string>('dashboard');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewResult, setInterviewResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    password: '',
    department: '',
    profilePicture: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1'
  });

  // Calculate statistics once for reuse
  const stats = (() => {
    // Only count interviews that have been completed with a score > 0
    const scoredHistory = interviewHistory.filter(item => (item.total_score || 0) > 0);
    const totalInterviews = scoredHistory.length;
    const scoredCount = scoredHistory.length;
    
    const avgScore = scoredCount > 0 
      ? parseFloat((scoredHistory.reduce((acc, curr) => acc + (curr.total_score || 0), 0) / scoredCount).toFixed(2))
      : 0;
    
    let performance = "N/A";
    let perfColor = "text-slate-400";
    let perfMsg = "Complete interviews to see performance";
    if (scoredCount > 0) {
        if (avgScore >= 90) { performance = "Excellent"; perfColor = "text-sky-400"; perfMsg = "Keep up the great work!"; }
        else if (avgScore >= 75) { performance = "Good"; perfColor = "text-emerald-400"; perfMsg = "Solid understanding."; }
        else if (avgScore >= 60) { performance = "Passing"; perfColor = "text-amber-400"; perfMsg = "You're getting warmer."; }
        else { performance = "Needs Practice"; perfColor = "text-rose-400"; perfMsg = "Keep practicing!"; }
    }
    
    // Calculate skill breakdown averages based on scored interviews only
    const dep = profile.department?.toUpperCase();
    let skillBreakdown = [];
    
    if (scoredCount > 0) {
      if (dep === 'CTE') {
        skillBreakdown = [
          { label: "Subject Matter", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cte_subject_matter || 0), 0) / scoredCount), color: 'bg-sky-500' },
          { label: "Teaching Apt.", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cte_teaching || 0), 0) / scoredCount), color: 'bg-emerald-500' },
          { label: "Motivation", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cte_motivation || 0), 0) / scoredCount), color: 'bg-indigo-500' },
          { label: "Problem Solving", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cte_problem_solving || 0), 0) / scoredCount), color: 'bg-amber-500' },
          { label: "Communication", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cte_communication || 0), 0) / scoredCount), color: 'bg-rose-500' },
        ];
      } else if (dep === 'CBAPA') {
        skillBreakdown = [
          { label: "Business Fund.", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cbapa_business || 0), 0) / scoredCount), color: 'bg-sky-500' },
          { label: "Analytical", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cbapa_analytical || 0), 0) / scoredCount), color: 'bg-emerald-500' },
          { label: "Leadership", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cbapa_leadership || 0), 0) / scoredCount), color: 'bg-indigo-500' },
          { label: "Ethical", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cbapa_ethical || 0), 0) / scoredCount), color: 'bg-amber-500' },
          { label: "Communication", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_cbapa_communication || 0), 0) / scoredCount), color: 'bg-rose-500' },
        ];
      } else {
        skillBreakdown = [
          { label: "Technical", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_technical || 0), 0) / scoredCount), color: 'bg-sky-500' },
          { label: "Problem Solving", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_problem_solving || 0), 0) / scoredCount), color: 'bg-emerald-500' },
          { label: "Coding Basics", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_coding || 0), 0) / scoredCount), color: 'bg-indigo-500' },
          { label: "Soft Skills", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_soft_skills || 0), 0) / scoredCount), color: 'bg-amber-500' },
          { label: "Communication", value: Math.round(scoredHistory.reduce((acc, curr) => acc + (curr.score_communication || 0), 0) / scoredCount), color: 'bg-rose-500' },
        ];
      }
    } else {
      // Defaults if no history with scores
      const labels = dep === 'CTE' ? ["Subject Matter", "Teaching Apt.", "Motivation", "Problem Solving", "Communication"] : dep === 'CBAPA' ? ["Business Fund.", "Analytical", "Leadership", "Ethical", "Communication"] : ["Technical", "Problem Solving", "Coding Basics", "Soft Skills", "Communication"];
      skillBreakdown = labels.map((label, i) => ({ label, value: 0, color: ['bg-sky-500', 'bg-emerald-500', 'bg-indigo-500', 'bg-amber-500', 'bg-rose-500'][i] }));
    }

    return { totalInterviews, avgScore, performance, perfColor, perfMsg, skillBreakdown };
  })();

  const renderStatCards = (delay = 0) => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.1 }} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
        <h3 className="text-slate-400 font-medium">Total Interviews</h3>
        <div className="mt-4">
          <span className="text-4xl font-bold text-slate-100">{stats.totalInterviews}</span>
          <p className="text-sm mt-2 font-medium text-sky-400">Total lifetime</p>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.2 }} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
        <h3 className="text-slate-400 font-medium">Average Score</h3>
        <div className="mt-4">
          <span className="text-4xl font-bold text-slate-100">{stats.avgScore}%</span>
          <p className="text-sm mt-2 font-medium text-emerald-400">Overall average</p>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.3 }} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
        <h3 className="text-slate-400 font-medium">Performance</h3>
        <div className="mt-4">
          <span className="text-4xl font-bold text-slate-100">{stats.performance}</span>
          <p className={`text-sm mt-2 font-medium ${stats.perfColor}`}>{stats.perfMsg}</p>
        </div>
      </motion.div>
    </div>
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://54.179.46.220';

  const fetchHistory = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/interview/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInterviewHistory(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [API_URL]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
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
          setProfile({
            name: `${data.firstname || ''} ${data.lastname || ''}`.trim() || 'Guest User',
            email: data.email || '',
            password: '',
            department: data.department || '',
            profilePicture: data.profile_picture_url || 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1'
          });
        } else {
          onLogout();
        }
      } catch (error) {
        console.error('Failed to fetch user:', error);
      }
    };
    fetchUser();
    fetchHistory();
  }, [API_URL, onLogout, fetchHistory]);

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

      const nameParts = profile.name.trim().split(' ');
      const firstname = nameParts[0] || '';
      const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      formData.append('firstname', firstname);
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
          name: `${updatedUser.firstname || ''} ${updatedUser.lastname || ''}`.trim() || 'Guest User',
          email: updatedUser.email || '',
          password: '',
          department: updatedUser.department || '',
          profilePicture: updatedUser.profile_picture_url || profile.profilePicture
        });
        setSelectedFile(null);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
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
  const [conversationLog, setConversationLog] = useState<{sender: 'user' | 'ai', text: string}[]>([]);

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

  useEffect(() => {
    // Mount the single persistent audio tag safely
    audioPlayerRef.current = new Audio();
  }, []);

  const transcriptRef = React.useRef('');
  const isListeningRef = React.useRef(false);
  const userAudioContextRef = React.useRef<AudioContext | null>(null);
  const userAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const userMediaStreamRef = React.useRef<MediaStream | null>(null);
  const userAnimationRef = React.useRef<number>(0);
  const [userAudioData, setUserAudioData] = useState<number[]>(new Array(3).fill(8));
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isMicTransitioning, setIsMicTransitioning] = useState(false);

  const processorRef = React.useRef<ScriptProcessorNode | null>(null);



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

  const startInterviewSession = async () => {
    setIsStartingInterview(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/interview/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        sessionIdRef.current = data.id;
        setSessionId(data.id);
        setActiveTab('interview-session');

        // Connect WebSocket natively
        const protocol = API_URL.startsWith('https') ? 'wss:' : 'ws:';
        const host = API_URL.replace(/^https?:\/\//, '');
        const wsUrl = `${protocol}//${host}/interview/${data.id}/chat?token=${token}`;
        
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // Send an initial kick-off text to reliably trigger the AI's introduction.
          // Do NOT start the mic here — we wait for the AI to finish its intro first,
          // otherwise the mic picks up the AI's own voice (echo) and confuses Gemini's VAD.
          ws.send(JSON.stringify({ text: "Hello! I am here and ready to begin the interview.", end_of_turn: true }));
        };

        ws.onmessage = async (event) => {
          if (event.data instanceof Blob) {
            const arrayBuffer = await event.data.arrayBuffer();
            playPCM(arrayBuffer);
          } else {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'turn_complete') {
                console.log('[Interview] AI turn_complete received');
                setAiResponseText(prev => {
                   if (prev.trim()) {
                      setConversationLog(log => [...log, { sender: 'ai', text: prev.trim() }]);
                   }
                   return prev;
                });
                // Wait for all scheduled audio buffers to finish playing
                const remaining = audioContextRef.current 
                  ? (nextPlayTimeRef.current - audioContextRef.current.currentTime) * 1000
                  : 0;
                const delay = Math.max(remaining, 500); // at least 500ms buffer
                console.log(`[Interview] Waiting ${delay}ms for playback to finish`);
                setTimeout(() => {
                  setIsAiSpeaking(false);
                  isAiSpeakingRef.current = false;
                  isPlayingRef.current = false;
                  if (!isListeningRef.current) {
                    console.log('[Interview] Starting mic after AI finished');
                    toggleListening();
                  }
                }, delay);
              } else if (msg.audio_base64) {
                 const binaryString = window.atob(msg.audio_base64);
                 const bytes = new Uint8Array(binaryString.length);
                 for (let i = 0; i < binaryString.length; i++) {
                   bytes[i] = binaryString.charCodeAt(i);
                 }
                 playPCM(bytes.buffer, msg.lip_sync);
              } else if (msg.text) {
                setAiResponseText(prev => prev + msg.text);
              }
            } catch(e) { console.error('[Interview] WS parse error:', e); }
          }
        };

        ws.onerror = (e) => {
           console.error("WebSocket Error:", e);
           setAiResponseText("Connection to AI failed.");
           setIsAiSpeaking(false);
        };
        
        ws.onclose = () => {
           setIsAiSpeaking(false);
        };

      } else {
        const errorText = await response.text();
        console.error("Failed to start interview:", errorText);
        alert(`Failed to start session: ${errorText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Network error starting interview: ${err.message}`);
    } finally {
      setIsStartingInterview(false);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    isListeningRef.current = false;
    
    if (recognitionRef.current) {
        recognitionRef.current.stop();
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(track => track.stop());
      userMediaStreamRef.current = null;
    }
    
    if (userAudioContextRef.current) {
      userAudioContextRef.current.close();
      userAudioContextRef.current = null;
    }
    
    cancelAnimationFrame(userAnimationRef.current);
    setUserAudioData([8, 8, 8]);
  };

  const exitInterview = () => {
    stopListening();
    setIsLeaveModalOpen(false);
    setIsAiSpeaking(false);
    setIsListening(false);
    setSessionId(null);
    setConversationLog([]);
    setInterviewResult(null);
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
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/interview/${sessionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation: conversationLog })
      });
      if (response.ok) {
        const data = await response.json();
        setInterviewResult(data);
        stopListening();
        setIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        setIsListening(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        // Do NOT change activeTab here; keep user on the session tab so the split view handles the evaluation natively!
        // setActiveTab('interview-result'); 
      } else {
        alert("Failed to grade interview. Please try again.");
      }
    } catch (e) {
      console.error(e);
      alert("Network error finishing interview.");
    } finally {
      setIsFinishingInterview(false);
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
    if (isListeningRef.current) {
      stopListening();
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
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            
            recognition.onresult = (e: any) => {
               if (isAiSpeakingRef.current) return;
               let finalTranscript = '';
               for (let i = e.resultIndex; i < e.results.length; i++) {
                  if (e.results[i].isFinal) {
                     finalTranscript += e.results[i][0].transcript;
                  }
               }
               
               if (finalTranscript) {
                  setTranscript(prev => prev + " " + finalTranscript);
                  setConversationLog(prev => {
                      const updatedLog = [...prev, { sender: 'user' as const, text: finalTranscript.trim() }];
                      return updatedLog;
                  });
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                     wsRef.current.send(JSON.stringify({ text: finalTranscript.trim(), end_of_turn: true }));
                  }
                  stopListening();
               }
            };
            
            recognition.onerror = (e: any) => console.error("STT Error", e);
            recognition.onend = () => {
               if (isListeningRef.current) {
                  recognition.start();
               }
            }
            
            recognitionRef.current = recognition;
            recognition.start();
        } else {
            console.warn("Speech Recognition not supported in this browser.");
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex overflow-hidden">
      {/* Sidebar */}
      {activeTab !== 'interview-type' && activeTab !== 'university-setup' && activeTab !== 'new-interview' && activeTab !== 'interview-session' && (
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen shrink-0">
          {/* Logo Area */}
          <div className="h-20 px-6 border-b border-slate-800 flex items-center shrink-0">
            <span className="font-bold text-xl tracking-tight text-white">Career Edge</span>
          </div>

          {/* Profile Area */}
          <div className="p-4 border-b border-slate-800">
            <button
              onClick={() => setActiveTab('profile')}
              className={`w-full text-left bg-slate-800/50 border ${activeTab === 'profile' ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/80'} rounded-xl p-3 flex items-center gap-3 transition-all duration-200`}
            >
              <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 overflow-hidden shrink-0">
                <img
                  src={profile.profilePicture}
                  alt="User"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="overflow-hidden">
                <h3 className="font-medium text-sm text-slate-200 truncate">{profile.name}</h3>
                <p className="text-xs text-sky-400 font-medium mt-0.5 truncate">{profile.department}</p>
              </div>
            </button>
          </div>

          {/* Main Action */}
          <div className="p-4">
            {['CCIT', 'CTE', 'CBAPA'].includes(profile.department?.toUpperCase() || '') ? (
              <button
                onClick={() => {
                  setSelectedCompanyType('');
                  setPosition('');
                  setActiveTab('interview-type');
                }}
                className="w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-lg bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20"
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
          <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${activeTab === 'history' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <Video className="w-5 h-5" />
              History
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${activeTab === 'analytics' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <BarChart2 className="w-5 h-5" />
              Analytics
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${activeTab === 'settings' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <Settings className="w-5 h-5" />
              Settings
            </button>
          </nav>

          {/* Logout */}
          <div className="p-4 border-t border-slate-800">
            <button
              onClick={onLogout}
              className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 font-medium transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 md:p-12">

          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-8">
              {/* Page Title */}
              <div>
                <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Welcome back, {profile.name.split(' ')[0]}</h1>
                <p className="text-lg text-slate-400 mt-2">Here's an overview of your interview progress.</p>
              </div>

              {renderStatCards()}

              {/* History List */}
              <div className="mt-8 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold text-slate-100 italic tracking-tight">Recent Sessions</h2>
                  {interviewHistory.length > 5 && (
                    <button 
                      onClick={() => setActiveTab('history')}
                      className="text-xs font-bold text-sky-400 hover:text-sky-300 transition-colors uppercase tracking-widest"
                    >
                      View All
                    </button>
                  )}
                </div>
                
                {interviewHistory.filter(item => (item.total_score || 0) > 0).length === 0 ? (
                   <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-10 text-center backdrop-blur-sm">
                      <p className="text-slate-500 text-sm">No interviews completed yet.</p>
                      <button onClick={() => setActiveTab('interview-type')} className="mt-4 text-sky-400 text-sm font-bold hover:underline">Start your first interview</button>
                   </div>
                ) : (
                  <div className="space-y-3">
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
                        className="bg-slate-900/40 border border-slate-800/60 hover:border-sky-500/30 rounded-2xl p-4 flex items-center justify-between hover:bg-slate-800/80 transition-all cursor-pointer group backdrop-blur-sm"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-sky-400 group-hover:bg-sky-500/10 transition-all">
                            <Video className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm text-slate-200 group-hover:text-sky-400 transition-colors">Interview #{filteredList.length - i}</h4>
                            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{new Date(item.start_time).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span className={`text-lg font-black ${item.total_score >= 70 ? 'text-emerald-400' : 'text-sky-400'}`}>{item.total_score || 0}%</span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-sky-400 group-hover:translate-x-1 transition-all" />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                  <button
                    onClick={startInterviewSession}
                    disabled={isStartingInterview}
                    className="bg-slate-900 border border-slate-800 hover:border-sky-500 hover:ring-1 hover:ring-sky-500 rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-300 group"
                  >
                    <div className="w-16 h-16 bg-sky-500/10 text-sky-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                      <GraduationCap className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-200 mb-2">University Enrollment</h3>
                    <p className="text-slate-400 text-sm">PRMSU CASTI entrance interview practice.</p>
                  </button>

                  <button
                    onClick={() => setActiveTab('new-interview')}
                    className="bg-slate-900 border border-slate-800 hover:border-sky-500 hover:ring-1 hover:ring-sky-500 rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-300 group"
                  >
                    <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                      <Briefcase className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-200 mb-2">Thesis Interview</h3>
                    <p className="text-slate-400 text-sm">Thesis Interview for students defending their thesis title or the project they've developed.</p>
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
                        className={`w-full bg-slate-950 border ${isDropdownOpen ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-800 hover:border-slate-700 hover:shadow-md hover:shadow-black/20'} rounded-xl px-4 py-3 pr-10 transition-all duration-300 cursor-pointer flex items-center justify-between`}
                      >
                        <span className={`truncate ${!selectedCompanyType ? 'text-slate-500' : 'text-slate-200'}`}>
                          {selectedCompanyType ? companyTypes.find(t => t.value === selectedCompanyType)?.label : 'Select company type...'}
                        </span>
                        <ChevronDown className={`absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-hover:text-sky-400 transition-all duration-300 pointer-events-none ${isDropdownOpen ? 'rotate-180 text-sky-400' : ''}`} />
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
                                ? 'bg-sky-500/10 text-sky-400 font-medium'
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
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 hover:shadow-md hover:shadow-black/20 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all duration-300"
                    />
                    <p className="text-xs text-slate-500">The AI will ask technical and behavioral questions specific to this role.</p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={startInterviewSession}
                    disabled={isStartingInterview}
                    className={`px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium flex items-center gap-2 transition-colors shadow-lg shadow-sky-500/20 text-lg ${isStartingInterview ? 'opacity-75 cursor-not-allowed' : ''}`}
                  >
                    {isStartingInterview ? 'Starting...' : 'Continue'}
                    {!isStartingInterview && <ArrowRight className="w-5 h-5" />}
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {activeTab === 'interview-session' && (
            <div className="relative h-full flex flex-col items-center px-4 pt-6 w-full">
              
              {/* TOP ROW: 3D MODEL & RESPONSE LOG */}
              <div className="w-full max-w-7xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-8 h-[600px]">
                
                {/* LEFT COLUMN: HORIZONTAL 3D MODEL */}
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
                        analyserNode={activeAnalyser} 
                        mouthCues={mouthCues}
                        currentAudioTime={currentAudioStartTime}
                        audioContext={audioContextRef.current}
                      />
                    </Canvas>
                  </div>
                </motion.div>

                {/* RIGHT COLUMN: USER RESPONSES & EVALUATION */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="lg:col-span-4 bg-[#1e293b]/80 backdrop-blur-md rounded-[2rem] p-6 flex flex-col relative shadow-xl overflow-hidden border border-slate-800/80"
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
                                <p className="text-xl font-black text-sky-400">{item.score || 0}</p>
                              </div>
                            ));
                          })()}
                        </div>

                        {interviewResult.feedback_summary && (
                          <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mt-4">
                            <h4 className="text-[11px] uppercase tracking-wider font-bold text-indigo-400 mb-2">AI Feedback</h4>
                            <p className="text-xs text-slate-300 leading-relaxed">{interviewResult.feedback_summary}</p>
                          </div>
                        )}
                        
                        <button onClick={exitInterview} className="w-full mt-4 py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-xl font-bold transition-colors shadow-lg shrink-0">
                          Go to Dashboard
                        </button>
                      </div>
                    </div>
                  ) : (
                    // --- TRANSCRIPT HISTORY UI ---
                    <div className="flex flex-col h-full">
                      <h3 className="text-sm font-bold text-slate-300 border-b border-slate-700/50 pb-3 mb-4 shrink-0 uppercase tracking-widest text-center">User Responses</h3>
                      
                      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-1 scroll-smooth">
                        {(() => {
                           // Filter explicitly only for user responses
                           const userLogs = conversationLog.filter((log) => log.sender === 'user');
                           
                           if (userLogs.length === 0 && !transcript) {
                             return (
                               <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                                  <User className="w-8 h-8 text-slate-500 mb-3" />
                                  <p className="text-slate-400 text-xs text-center px-4 leading-relaxed">Respond to the AI Professor. Your answers will be tracked here (Limit: 5).</p>
                               </div>
                             );
                           }

                           return (
                             <>
                               {userLogs.map((log, idx) => (
                                 <div key={idx} className="flex flex-col items-stretch animate-fade-in">
                                    <span className="text-[10px] font-bold uppercase tracking-wider mb-1 text-emerald-500/80 px-1">
                                       Response {idx + 1}
                                    </span>
                                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 shadow-sm">
                                       <p className="leading-relaxed text-xs">{log.text}</p>
                                    </div>
                                 </div>
                               ))}
                             </>
                           );
                        })()}
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-700/50 shrink-0">
                        {(() => {
                           const userTurns = conversationLog.filter(l => l.sender === 'user').length;
                           if (userTurns >= 5) {
                             return (
                               <button
                                 onClick={finishInterviewSession}
                                 disabled={isFinishingInterview}
                                 className={`w-full py-3 ${isFinishingInterview ? 'bg-slate-500 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-400'} text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 text-sm tracking-wide animate-fade-in`}
                               >
                                 {isFinishingInterview ? 'Grading...' : 'Complete Interview'}
                               </button>
                             );
                           }
                           return (
                             <div className="text-center">
                               <span className="text-xs font-medium text-slate-500">{userTurns} / 5 Questions Evaluated</span>
                             </div>
                           );
                        })()}
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>

              {/* BOTTOM ROW: CONTROLS (Floating below everything) */}
              {!interviewResult && (
                <div className="flex items-center justify-center gap-6 w-full max-w-lg mx-auto pb-4 shrink-0">
                      <div className="relative">
                        <button
                          onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                          className="bg-[#171e2e] hover:bg-[#1e293b] border border-slate-800 text-slate-300 hover:text-white w-14 h-14 rounded-2xl transition-all duration-300 flex items-center justify-center shadow-lg group relative"
                          title="Add File"
                        >
                          <Plus className={`w-5 h-5 transition-transform duration-300 ${isAddMenuOpen ? 'rotate-45' : 'group-hover:scale-110'}`} />
                        </button>

                        {/* Attachment Popover */}
                        {isAddMenuOpen && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 w-48 bg-slate-800 border border-slate-700/80 rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden z-[100]"
                          >
                            <div className="flex flex-col p-1.5 space-y-1">
                              <button onClick={() => setIsAddMenuOpen(false)} className="flex items-center gap-3 w-full p-2.5 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all">
                                <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                                  <Folder className="w-3.5 h-3.5 text-sky-400" />
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

                      <div className={`relative ${isListening ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-slate-800 shadow-slate-900/40'} text-white w-20 h-20 rounded-[2rem] transition-all duration-300 flex items-center justify-center shadow-xl`}>
                        {isListening ? (
                          <div className="flex items-center justify-center gap-1.5 h-8 w-full relative z-10 px-4">
                            {[...userAudioData, ...Array.from(userAudioData).reverse()].map((height, i) => (
                              <motion.div key={`w-${i}`} className="w-[3px] bg-white rounded-full" animate={{ height: `${height * 0.7}px` }} transition={{ duration: 0.1, ease: 'linear' }} />
                            ))}
                          </div>
                        ) : (
                          <Mic className={`w-8 h-8 relative z-10 ${isMicTransitioning ? 'text-sky-400' : 'text-slate-400'}`} />
                        )}
                        {isListening && <span className="absolute inset-0 rounded-[2rem] border-4 border-emerald-400 opacity-0" style={{ animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }} />}
                      </div>

                      <button
                        onClick={() => setIsLeaveModalOpen(true)}
                        className="bg-[#171e2e] hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 text-slate-300 hover:text-rose-500 w-14 h-14 rounded-2xl transition-all duration-300 flex items-center justify-center shadow-lg group relative"
                        title="Leave/End Session"
                      >
                        <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
                      </button>
                </div>
              )}
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
                <h3 className="text-xl font-bold text-white text-center mb-3">Leave Interview?</h3>
                <p className="text-slate-400 text-center mb-8 text-sm leading-relaxed px-2">
                  Are you sure you want to end this interview session? Your progress and current context will be cleared.
                </p>
                <div className="flex gap-4 w-full">
                  <button
                    onClick={() => setIsLeaveModalOpen(false)}
                    className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={exitInterview}
                    className="flex-1 py-3 px-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium transition-colors shadow-lg shadow-sky-500/20"
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
              className="max-w-4xl mx-auto space-y-8"
            >
              <div>
                <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Interview History</h1>
                <p className="text-lg text-slate-400 mt-2">Relive your past sessions and track your progress over time.</p>
              </div>

              <div className="space-y-4">
                {interviewHistory.filter(item => (item.total_score || 0) > 0).length === 0 ? (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-16 text-center backdrop-blur-sm">
                    <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-600">
                      <Video className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-200">No interviews yet</h3>
                    <p className="text-slate-500 mt-2 max-w-sm mx-auto">Start your first interview session to see your performance history here.</p>
                    <button 
                      onClick={() => setActiveTab('dashboard')}
                      className="mt-8 px-6 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-bold transition-all shadow-lg shadow-sky-500/20"
                    >
                      Start Practicing
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 pb-12">
                    {interviewHistory.filter(item => (item.total_score || 0) > 0).map((item, i, filteredList) => (
                      <motion.div
                        key={item.id || i}
                        onClick={() => {
                          setInterviewResult(item);
                          setPrevTab(activeTab);
                          setActiveTab('interview-result');
                        }}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="bg-slate-900 border border-slate-800/50 rounded-2xl p-6 flex items-center justify-between hover:bg-slate-800/80 hover:border-sky-500/30 transition-all cursor-pointer group shadow-xl backdrop-blur-sm"
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-sky-400 group-hover:bg-sky-500/10 transition-all duration-300">
                            <Video className="w-7 h-7" />
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <h4 className="font-bold text-xl text-slate-100 tracking-tight group-hover:text-sky-400 transition-colors">Interview #{filteredList.length - i}</h4>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${item.passed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                {item.passed ? 'PASSED' : 'NOT PASSED'}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500 mt-1 font-medium italic">
                              {profile.department || 'General'} Assessment • {new Date(item.start_time).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-right min-w-[100px]">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mb-1">Final Score</p>
                            <span className={`text-3xl font-black ${item.total_score >= 75 ? 'text-emerald-400' : item.total_score >= 50 ? 'text-sky-400' : 'text-rose-400'}`}>
                              {item.total_score || 0}%
                            </span>
                          </div>
                          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-800 text-slate-500 group-hover:bg-sky-500 group-hover:text-white transition-all duration-300 shadow-inner">
                            <ChevronRight className="w-6 h-6" />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div>
                <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Analytics</h1>
                <p className="text-lg text-slate-400 mt-2">In-depth overview of your overall interview performance.</p>
              </div>

              {renderStatCards()}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm">
                  <h3 className="text-xl font-bold text-slate-100 mb-6 italic tracking-tight">Skill Breakdown</h3>
                  <div className="space-y-6">
                    {stats.skillBreakdown.map((skill, idx) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                          <span>{skill.label}</span>
                          <span className="text-slate-200">{skill.value}%</span>
                        </div>
                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }} 
                            animate={{ width: `${skill.value}%` }} 
                            transition={{ duration: 1, delay: 0.5 + (idx * 0.1) }}
                            className={`h-full ${skill.color} rounded-full`} 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm flex flex-col justify-center items-center text-center space-y-4">
                   <div className="w-16 h-16 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-400">
                      <BarChart2 className="w-8 h-8" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-100 italic tracking-tight">Insight Generator</h3>
                   <p className="text-slate-400 text-sm leading-relaxed px-4 italic">
                      "Your communication clarity is improving! Focus on structural answers for coding sessions to reach 'Excellent' status."
                   </p>
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
                <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Past Evaluation</h1>
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
                </div>

                <div className="space-y-6">
                  <h3 className="text-sm font-bold text-slate-200 border-b border-slate-700/50 pb-2">Performance Breakdown</h3>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                        <div key={idx} className={`bg-slate-900 p-4 rounded-2xl border border-slate-800/50 text-center ${breakdown.length % 3 !== 0 && idx === breakdown.length - 1 ? 'sm:col-span-3' : ''}`}>
                          <p className="text-xs text-slate-400 mb-1 uppercase tracking-wider">{item.label}</p>
                          <p className="text-2xl font-black text-sky-400">{item.score || 0}</p>
                        </div>
                      ));
                    })()}
                  </div>

                  {interviewResult.feedback_summary && (
                    <div className="bg-indigo-500/10 border border-indigo-500/20 p-6 rounded-2xl mt-6 text-left">
                      <h4 className="text-sm uppercase tracking-wider font-bold text-indigo-400 mb-3">AI Feedback Summary</h4>
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
                {/* Profile Picture */}
                <div className="flex items-center gap-6">
                  <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 overflow-hidden shrink-0">
                    <img
                      src={profile.profilePicture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-slate-200">Profile Picture</h3>
                    <p className="text-sm text-slate-400 mb-3">PNG, JPG up to 5MB</p>
                    <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors border border-slate-700 cursor-pointer inline-block">
                      Change Picture
                      <input
                        type="file"
                        accept="image/png, image/jpeg"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
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
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all duration-300"
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

                  {/* Password */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-300">Password</label>
                    <input
                      type="password"
                      value={profile.password}
                      onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all duration-300"
                    />
                  </div>

                  {/* Department */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-300">Department</label>
                    <input
                      type="text"
                      value={profile.department}
                      onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all duration-300"
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
                    className="px-6 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium transition-colors shadow-lg shadow-sky-500/20 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}



        </div>
      </main>
    </div>
  );
};
