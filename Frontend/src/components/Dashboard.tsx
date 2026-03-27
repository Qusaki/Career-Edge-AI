import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
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
  Mic,
  MicOff,
  Send,
  PlusCircle,
  Paperclip,
  GraduationCap,
  Briefcase,
  Cloud,
  Folder
} from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'profile' | 'settings' | 'interview-type' | 'university-setup' | 'new-interview' | 'interview-session'>('dashboard');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedCompanyType, setSelectedCompanyType] = useState('');
  const [position, setPosition] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    password: '',
    department: '',
    profilePicture: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1'
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://54.179.46.220';

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
  }, [API_URL, onLogout]);

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

  const recognitionRef = React.useRef<any>(null);
  const audioQueueRef = React.useRef<string[]>([]);
  const isPlayingRef = React.useRef(false);
  const audioPlayerRef = React.useRef<HTMLAudioElement | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const animationRef = React.useRef<number>(0);
  const [audioData, setAudioData] = useState<number[]>(new Array(15).fill(20));

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

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        let finalT = '';
        let interimT = '';
        // Safely map through all results from index 0 to eliminate compounding issues
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalT += event.results[i][0].transcript;
          } else {
            interimT += event.results[i][0].transcript;
          }
        }
        const newTranscript = (finalT + ' ' + interimT).trim();
        transcriptRef.current = newTranscript;
        setTranscript(newTranscript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;

        cancelAnimationFrame(userAnimationRef.current);
        setUserAudioData([8, 8, 8]);
        if (userMediaStreamRef.current) {
          userMediaStreamRef.current.getTracks().forEach(track => track.stop());
          userMediaStreamRef.current = null;
        }

        // Auto-send if the browser natively stops and there is a transcript available
        if (transcriptRef.current && transcriptRef.current.trim().length > 0) {
          sendToGemini(transcriptRef.current);
          transcriptRef.current = '';
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        isListeningRef.current = false;
      };
    } else {
      console.warn('Speech Recognition API not supported in this browser.');
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
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
       animationRef.current = requestAnimationFrame(updateAudioData);
    } else {
       setAudioData(new Array(15).fill(20));
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
         try { await audioContextRef.current.resume(); } catch(e){}
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

  const sendToGemini = async (text: string) => {
    setAiResponseText(''); // Clear any previous errors
    setIsAiSpeaking(true); // Automatically triggers the sound wave visualizer to indicate loading
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/gemini/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        const errorText = await response.text();
        setAiResponseText(`Backend Error (${response.status}): ${errorText}`);
        setIsAiSpeaking(false);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        const rawText = await response.text();
        setAiResponseText(`Server returned invalid Content-Type: ${contentType}. (It might be returning HTML/JSON instead of a stream). First 100 chars: ${rawText.substring(0, 100)}`);
        setIsAiSpeaking(false);
        return;
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasReceivedFirstToken = false;

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          // Use regex to strictly split on both \n\n and \r\n\r\n
          const messages = buffer.split(/\r?\n\r?\n/);
          buffer = messages.pop() || '';

          for (const message of messages) {
            if (message.startsWith('event: ')) {
              const lines = message.split(/\r?\n/);
              const eventType = lines[0].replace('event: ', '').trim();
              const dataLine = lines.find(l => l.startsWith('data: '));
              if (dataLine) {
                const dataStr = dataLine.replace('data: ', '').trim();
                if (dataStr && dataStr !== 'null') {
                  try {
                    const data = JSON.parse(dataStr);

                    if (!hasReceivedFirstToken && (eventType === 'text' || eventType === 'error')) {
                      hasReceivedFirstToken = true;
                      setAiResponseText(''); // Clear "Thinking..." on first real interaction
                    }

                    if (eventType === 'text' && data.text) {
                      setAiResponseText(prev => prev + data.text);
                    } else if (eventType === 'audio' && data.audio_base64) {
                      const audioSrc = `data:audio/mp3;base64,${data.audio_base64}`;
                      audioQueueRef.current.push(audioSrc);
                      playNextAudio();
                    } else if (eventType === 'error') {
                      setAiResponseText(prev => prev + `\n\n[AI Error: ${data.error}]`);
                    }
                  } catch (e) {
                    console.error('Error parsing SSE data', e);
                  }
                }
              }
            }
          }
        }

        if (done) {
          if (!hasReceivedFirstToken) {
            setAiResponseText('Stream closed unexpectedly by the server without sending any data. (Check AWS proxy settings)!');
          }
          break;
        }
      }
    } catch (error: any) {
      console.error('Error sending to Gemini:', error);
      setAiResponseText(`Network Error: ${error.message || 'Failed to connect to backend'}`);
    } finally {
      if (audioQueueRef.current.length === 0) {
        setIsAiSpeaking(false);
      }
    }
  };

  const toggleListening = async () => {
    if (isListeningRef.current) {
      // Just hit stop, native onend listener will accurately trigger the backend send.
      recognitionRef.current?.stop();
    } else {
      setTranscript('');
      transcriptRef.current = '';
      setAiResponseText('');

      // Stop playing any active audio to prevent overlap
      isPlayingRef.current = false;
      setIsAiSpeaking(false);
      cancelAnimationFrame(animationRef.current);
      setAudioData(new Array(15).fill(20));
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      audioQueueRef.current = [];

      try { recognitionRef.current?.start(); } catch (e) { console.warn(e); }
      setIsListening(true);
      isListeningRef.current = true;

      // Start User Audio Analysis
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        userMediaStreamRef.current = stream;
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        userAudioContextRef.current = ctx;
        userAnalyserRef.current = ctx.createAnalyser();
        userAnalyserRef.current.fftSize = 64;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(userAnalyserRef.current);
        updateUserAudioData();
      } catch (err) {
        console.error("Could not capture local audio for visualizer:", err);
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

              {/* Top 3 Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { title: 'Total Interviews', value: '12', change: '+2 this week', color: 'text-sky-400' },
                  { title: 'Average Score', value: '85%', change: '+5% improvement', color: 'text-emerald-400' },
                  { title: 'Performance', value: 'Excellent', change: 'Keep up the great work!', color: 'text-amber-400' },
                ].map((stat, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between"
                  >
                    <h3 className="text-slate-400 font-medium">{stat.title}</h3>
                    <div className="mt-4">
                      <span className="text-4xl font-bold text-slate-100">{stat.value}</span>
                      <p className={`text-sm mt-2 font-medium ${stat.color}`}>{stat.change}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Bottom 3 Rows */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-200 mb-4">Let's Practice</h2>
                {[
                  { role: 'Frontend Developer', company: 'Tech Corp', score: '88%' },
                  { role: 'Full Stack Engineer', company: 'Startup Inc', score: '82%' },
                  { role: 'React Developer', company: 'Agency LLC', score: '91%' },
                  { role: 'Backend Developer', company: 'Cloud Systems', score: '85%' },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
                        <Video className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-200">{item.role}</h4>
                        <p className="text-sm text-slate-400">{item.company}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-emerald-400">{item.score}</span>
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Score</p>
                    </div>
                  </motion.div>
                ))}
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
                    onClick={() => setActiveTab('university-setup')}
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
                    <h3 className="text-xl font-bold text-slate-200 mb-2">Practice for Work</h3>
                    <p className="text-slate-400 text-sm">Job interview practice tailored to a specific role and company.</p>
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {activeTab === 'university-setup' && (
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
                  <h1 className="text-4xl font-bold text-slate-100 tracking-tight">University Enrollment</h1>
                  <p className="text-lg text-slate-400 mt-2">PRMSU CASTI Interview Setup</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-8">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-300">What course are you applying for?</label>
                    <input
                      type="text"
                      placeholder="e.g. BS Computer Science, BS Information Technology..."
                      className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 hover:shadow-md hover:shadow-black/20 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all duration-300"
                    />
                    <p className="text-xs text-slate-500">The AI will tailor questions based on your prospective course.</p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={() => setActiveTab('interview-session')}
                    className="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium flex items-center gap-2 transition-colors shadow-lg shadow-sky-500/20 text-lg"
                  >
                    Continue
                    <ArrowRight className="w-5 h-5" />
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
                    onClick={() => setActiveTab('interview-session')}
                    className="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium flex items-center gap-2 transition-colors shadow-lg shadow-sky-500/20 text-lg"
                  >
                    Continue
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {activeTab === 'interview-session' && (
            <div className="relative h-full flex flex-col items-center px-6 pt-6 pb-2 w-full">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-6xl mx-auto flex-1 bg-[#111827] rounded-2xl mb-6 mt-12 flex flex-col items-center justify-center overflow-hidden relative shadow-2xl p-8"
              >
                <div className="flex flex-col items-center justify-center gap-8 w-full max-w-3xl">

                  {isAiSpeaking ? (
                    <div className="flex items-center justify-center gap-[4px] sm:gap-[6px] h-40">
                      {audioData.map((height, i) => (
                        <motion.div
                          key={i}
                          className="w-2 sm:w-3 bg-sky-400 rounded-full"
                          animate={{ height: `${height}px` }}
                          transition={{ duration: 0.1, ease: "linear" }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="h-40 flex items-center justify-center">
                      {isListening ? (
                        <Mic className="w-20 h-20 text-emerald-400 animate-pulse" />
                      ) : (
                        <MicOff className="w-20 h-20 text-rose-500/80" />
                      )}
                    </div>
                  )}

                  <div className="w-full space-y-6 text-center">
                    {(() => {
                        const isSystemError = aiResponseText.startsWith('Backend Error') || aiResponseText.startsWith('Network Error') || aiResponseText.startsWith('Server returned') || aiResponseText.startsWith('Stream closed') || aiResponseText.includes('[AI Error:');
                        
                        return (
                          <>
                            {isSystemError && (
                              <div className="p-6 bg-rose-500/10 border border-rose-500/50 rounded-2xl">
                                <p className="text-rose-400 text-lg leading-relaxed">{aiResponseText}</p>
                              </div>
                            )}

                            {transcript && (
                              <p className="text-emerald-400 text-lg font-medium">"{transcript}"</p>
                            )}

                            {!transcript && !isSystemError && (
                              <p className="text-slate-400 text-lg font-medium">{isListening ? 'Listening...' : 'Click the microphone to start speaking'}</p>
                            )}
                          </>
                        );
                    })()}
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center justify-center gap-6 w-full max-w-4xl pb-0"
              >
                <div className="relative">
                  <button
                    onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                    className="bg-[#171e2e] hover:bg-[#1e293b] text-slate-200 w-16 h-16 rounded-2xl transition-all duration-300 flex items-center justify-center shrink-0 shadow-lg relative z-20"
                    title="Add File"
                  >
                    <Plus className={`w-6 h-6 transition-transform duration-300 ${isAddMenuOpen ? 'rotate-45' : ''}`} />
                  </button>

                  {/* Attachment Popover */}
                  {isAddMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="absolute right-0 bottom-[calc(100%+16px)] w-56 bg-slate-800 border border-slate-700/80 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden z-10"
                    >
                      <div className="flex flex-col p-2 space-y-1">
                        <button 
                          onClick={() => setIsAddMenuOpen(false)}
                          className="flex items-center gap-3 w-full p-3 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all shrink-0"
                        >
                          <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                             <Folder className="w-4 h-4 text-sky-400" />
                          </div>
                          <span className="text-sm font-medium">Local Files</span>
                        </button>
                        <button 
                          onClick={() => setIsAddMenuOpen(false)}
                          className="flex items-center gap-3 w-full p-3 text-left hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl transition-all shrink-0"
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                             <Cloud className="w-4 h-4 text-emerald-400" />
                          </div>
                          <span className="text-sm font-medium">Google Drive</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>

                <button
                  onClick={toggleListening}
                  className={`relative ${isListening ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/30'} text-white w-24 h-24 rounded-[2rem] transition-all duration-300 flex items-center justify-center shrink-0 shadow-lg`}
                  title={isListening ? "Stop Microphone" : "Start Microphone"}
                >
                  {isListening ? (
                    <div className="flex items-center justify-center gap-[6px] h-10 w-full relative z-10">
                       {[...userAudioData, ...Array.from(userAudioData).reverse()].map((height, i) => (
                           <motion.div key={`w-${i}`} className="w-[4px] bg-white/95 rounded-full" animate={{height: `${height}px`}} transition={{ duration: 0.1, ease: 'linear' }} />
                       ))}
                    </div>
                  ) : (
                    <MicOff className="w-10 h-10 relative z-10" />
                  )}
                  
                  {isListening && (
                    <span className="absolute inset-0 rounded-[2rem] border-4 border-emerald-400 opacity-0" style={{ animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
                  )}
                </button>

                <button
                  onClick={() => setIsLeaveModalOpen(true)}
                  className="bg-[#171e2e] hover:bg-rose-500/10 text-slate-200 hover:text-rose-500 w-16 h-16 rounded-2xl transition-all duration-300 flex items-center justify-center shrink-0"
                  title="Leave"
                >
                  <LogOut className="w-8 h-8" />
                </button>
              </motion.div>
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
                    onClick={() => {
                      setIsLeaveModalOpen(false);
                      setIsAiSpeaking(false);
                      setIsListening(false);
                      if (audioPlayerRef.current) audioPlayerRef.current.pause();
                      try { recognitionRef.current?.abort(); } catch(e) {}
                      setActiveTab('dashboard');
                    }}
                    className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-medium transition-colors shadow-lg shadow-rose-500/20"
                  >
                    Leave
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* Placeholders for other tabs */}
          {(activeTab === 'history' || activeTab === 'analytics' || activeTab === 'settings') && (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-500 text-lg">This section is coming soon.</p>
            </div>
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
