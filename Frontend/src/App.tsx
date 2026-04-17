import { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Mic, FileText, CheckCircle, BarChart, Play, ArrowRight, Github, Twitter, Linkedin, Sparkles, BrainCircuit, Target, GraduationCap, Menu, X, MessageSquare, Video, Plus, Send, MousePointer2, Paperclip, LogOut, MapPin, Phone, Mail, Globe } from 'lucide-react';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';

const MorphingGraphic = () => {
  const [isResume, setIsResume] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const smoothMouseX = useSpring(mouseX, { stiffness: 300, damping: 30 });
  const smoothMouseY = useSpring(mouseY, { stiffness: 300, damping: 30 });

  const rotateX = useTransform(smoothMouseY, [-0.5, 0.5], ["15deg", "-15deg"]);
  const rotateY = useTransform(smoothMouseX, [-0.5, 0.5], ["-15deg", "15deg"]);

  useEffect(() => {
    if (isHovered) return;
    const interval = setInterval(() => {
      setIsResume((prev) => !prev);
    }, 4000);
    return () => clearInterval(interval);
  }, [isHovered]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xRel = e.clientX - rect.left;
    const yRel = e.clientY - rect.top;
    mouseX.set(xRel / rect.width - 0.5);
    mouseY.set(yRel / rect.height - 0.5);
  };

  const handlePointerEnter = () => setIsHovered(true);
  const handlePointerLeave = () => {
    setIsHovered(false);
    mouseX.set(0);
    mouseY.set(0);
  };

  const handleDragEnd = (e: any, info: any) => {
    if (info.offset.x > 30) {
      setIsResume(true);
    } else if (info.offset.x < -30) {
      setIsResume(false);
    }
  };

  const resumeStates = [];

  // 16 Background Bars
  for (let i = 0; i < 16; i++) {
    resumeStates.push({
      x: i * 20,
      y: 0,
      w: i === 15 ? 20 : 22, // Increased from 21 to 22 to prevent subpixel gaps
      h: 500,
      r: i === 0 ? "24px 0px 0px 24px" : i === 15 ? "0px 24px 24px 0px" : "0px",
      color: "#1e293b", // slate-800
      isBg: true
    });
  }

  // 15 Content Bars
  const content = [
    { x: 40, y: 50, w: 60, h: 60, r: "30px", color: "#38bdf8" }, // Avatar
    { x: 120, y: 60, w: 140, h: 14, r: "4px", color: "#f1f5f9" }, // Name
    { x: 120, y: 85, w: 80, h: 8, r: "4px", color: "#64748b" }, // Title

    { x: 40, y: 140, w: 240, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 160, w: 220, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 180, w: 190, h: 6, r: "3px", color: "#64748b" },

    { x: 40, y: 230, w: 90, h: 10, r: "4px", color: "#f1f5f9" },
    { x: 40, y: 255, w: 240, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 275, w: 230, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 295, w: 200, h: 6, r: "3px", color: "#64748b" },

    { x: 40, y: 345, w: 90, h: 10, r: "4px", color: "#f1f5f9" },
    { x: 40, y: 370, w: 240, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 390, w: 210, h: 6, r: "3px", color: "#64748b" },
    { x: 40, y: 410, w: 160, h: 6, r: "3px", color: "#64748b" },

    { x: 40, y: 450, w: 100, h: 6, r: "3px", color: "#64748b" },
  ];

  resumeStates.push(...content);

  return (
    <div className="relative w-[320px] h-[500px] flex items-center justify-center" style={{ perspective: 1000 }}>
      <motion.div
        ref={containerRef}
        className="relative w-full h-full"
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {/* Drag/Click Overlay */}
        <motion.div
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={() => setIsResume(!isResume)}
          style={{ transform: "translateZ(50px)" }}
        />

        {/* Resume Shadow & Border Overlay */}
        <motion.div
          className="absolute inset-0 rounded-[24px] pointer-events-none"
          initial={false}
          animate={{
            boxShadow: isResume ? "0 25px 50px -12px rgba(0, 0, 0, 0.5)" : "0 0px 0px 0px rgba(0, 0, 0, 0)",
            border: isResume ? "1px solid rgba(51, 65, 85, 0.5)" : "0px solid rgba(51, 65, 85, 0)",
          }}
          transition={{ duration: 0.8 }}
          style={{ transform: "translateZ(1px)" }}
        />

        <div className="absolute inset-0 w-full h-full" style={{ transformStyle: "preserve-3d" }}>
          {resumeStates.map((resState, i) => {
            const waveX = i * 10 + 5;
            const waveW = 6;

            const progress = i / 30;
            const envelope = Math.sin(progress * Math.PI);
            const baseH = 10 + 20 * envelope;
            const maxH = baseH + (100 + Math.sin(i * 1.2) * 40 + Math.cos(i * 0.7) * 20) * envelope;

            return (
              <motion.div
                key={i}
                className="absolute origin-center left-0 top-0"
                initial={false}
                animate={
                  isResume
                    ? {
                      x: resState.x,
                      y: resState.y,
                      width: resState.w,
                      height: resState.h,
                      borderRadius: resState.r,
                      backgroundColor: resState.color,
                      z: resState.isBg ? 0 : 30,
                      opacity: 1,
                    }
                    : {
                      x: waveX,
                      y: [250 - baseH / 2, 250 - maxH / 2, 250 - baseH / 2],
                      width: waveW,
                      height: [baseH, maxH, baseH],
                      borderRadius: "6px",
                      backgroundColor: "#38bdf8",
                      z: 0, // Set to 0 to prevent 3D clipping during morph transition
                      opacity: 0.8,
                    }
                }
                transition={
                  isResume
                    ? {
                      duration: 0.8,
                      ease: [0.25, 1, 0.5, 1],
                      delay: i * 0.015,
                    }
                    : {
                      y: { duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.05 },
                      height: { duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.05 },
                      x: { duration: 0.8, ease: [0.25, 1, 0.5, 1] },
                      width: { duration: 0.8, ease: [0.25, 1, 0.5, 1] },
                      backgroundColor: { duration: 0.8 },
                      borderRadius: { duration: 0.8 },
                      z: { duration: 0.8, ease: [0.25, 1, 0.5, 1] },
                      opacity: { duration: 0.8 },
                    }
                }
              />
            );
          })}
        </div>
      </motion.div>

      {/* Label indicating state */}
      <div className="absolute -bottom-16 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none">
        <motion.div
          className="px-4 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/50 text-xs font-medium text-sky-400 backdrop-blur-md shadow-lg"
          layout
        >
          {isResume ? "Perfect Resume" : "Voice Analysis"}
        </motion.div>
        <span className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">
          Drag or Click to Interact
        </span>
      </div>
    </div>
  );
};

const LaptopMockup = ({ children }: { children: React.ReactNode }) => (
  <div className="relative mx-auto w-full max-w-[800px]">
    {/* Laptop Screen */}
    <div className="relative bg-slate-800 rounded-t-xl border-[6px] border-slate-800 shadow-2xl">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-3 bg-slate-900 rounded-b-md flex justify-center items-center z-20">
        <div className="w-1 h-1 rounded-full bg-slate-700" />
      </div>
      <div className="relative bg-slate-950 rounded-lg overflow-hidden aspect-[16/10]">
        {children}
      </div>
    </div>
    {/* Laptop Base */}
    <div className="relative bg-slate-700 h-3 rounded-b-2xl shadow-xl flex justify-center">
      <div className="w-1/4 h-1 bg-slate-600 rounded-b-sm" />
    </div>
  </div>
);

const InterviewMockup = () => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [responses, setResponses] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);

  const sampleResponses = [
    "I am applying for the CCIT program because I have a strong passion for technology and software development.",
    "My academic background includes strong grades in Mathematics and Computer subjects throughout high school.",
    "I see myself contributing to the field through research in artificial intelligence and data systems.",
  ];

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const run = async () => {
      await sleep(1500);
      for (const resp of sampleResponses) {
        if (!isMounted) break;
        setIsListening(true);
        await sleep(2000);
        if (!isMounted) break;
        setIsListening(false);
        await sleep(300);
        setResponses(prev => [...prev.slice(-2), resp]);
        await sleep(3500);
      }
      // reset loop
      await sleep(1000);
      if (isMounted) setResponses([]);
      run();
    };
    run();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="w-full h-full bg-[#0b1120] flex flex-col relative overflow-hidden">
      {/* Timer pill */}
      <div className="flex justify-center pt-3 pb-2 shrink-0">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/50 text-[10px] sm:text-xs text-slate-300 font-mono font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {fmt(elapsedSeconds)} / 30:00
        </div>
      </div>

      {/* Main area: professor left, responses right */}
      <div className="flex-1 flex gap-3 px-3 pb-2 min-h-0">
        {/* Left: Professor panel */}
        <div className="flex-1 bg-slate-900/60 rounded-xl border border-slate-800/60 relative overflow-hidden flex flex-col items-center justify-center">
          {/* Label */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800/90 border border-slate-700/50">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            <span className="text-[9px] text-slate-300 font-semibold">Enrollment Interview • Prof. Maxiel</span>
          </div>

          {/* AI voice visualization (replaced human icon) */}
          <div className="relative flex flex-col items-center justify-center h-full">
            <div className="absolute inset-0 bg-sky-500/10 blur-[60px] rounded-full" />
            {/* AI voice bars */}
            <div className="flex items-end gap-0.5 h-6">
              {[0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 0.3, 0.7, 1, 0.5].map((h, i) => (
                <motion.div
                  key={i}
                  className="w-1 rounded-full bg-sky-400"
                  animate={{ height: [`${h * 8}px`, `${h * 22}px`, `${h * 8}px`] }}
                  transition={{ duration: 1.2 + i * 0.05, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: Responses panel */}
        <div className="w-[42%] bg-slate-900/60 rounded-xl border border-slate-800/60 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800/60 shrink-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Your Responses</span>
          </div>
          <div className="flex-1 overflow-hidden px-2 py-2 flex flex-col gap-2 justify-end">
            {responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-1 opacity-40">
                <Mic className="w-5 h-5 text-slate-500" />
                <span className="text-[9px] text-slate-500 text-center">Respond to Prof. Maxiel's questions.</span>
              </div>
            ) : (
              responses.map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-800/60 rounded-lg px-2 py-1.5 border border-slate-700/40"
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    <div className="w-3 h-3 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                      <span className="text-[6px] text-sky-400 font-bold">U</span>
                    </div>
                    <span className="text-[8px] text-slate-500 font-medium">You</span>
                  </div>
                  <p className="text-[8px] sm:text-[9px] text-slate-300 leading-relaxed line-clamp-3">{r}</p>
                </motion.div>
              ))
            )}
          </div>
          <div className="px-3 py-2 border-t border-slate-800/60 shrink-0">
            <span className="text-[8px] text-slate-600">{responses.length} / 5 Responses Recorded</span>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 pb-3 shrink-0">
        {/* Mic */}
        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-300 ${isListening ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-slate-800'}`}>
          {isListening ? (
            <div className="flex items-end gap-0.5 h-5">
              {[0.6, 1, 0.7, 0.9, 0.5].map((h, i) => (
                <motion.div key={i} className="w-0.5 bg-white rounded-full"
                  animate={{ height: [`${h * 6}px`, `${h * 16}px`, `${h * 6}px`] }}
                  transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
                />
              ))}
            </div>
          ) : (
            <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
          )}
          {isListening && <span className="absolute w-10 h-10 sm:w-12 sm:h-12 rounded-2xl border-2 border-emerald-400 opacity-0" style={{ animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />}
        </div>
        {/* Leave */}
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400">
          <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </div>
      </div>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
  <motion.div
    whileHover={{ y: -5 }}
    className="h-full bg-slate-900/50 border border-slate-800/50 p-6 rounded-2xl flex gap-4 items-start hover:bg-slate-800/50 transition-colors"
  >
    <div className="p-3 bg-slate-800 rounded-xl border border-slate-700/50 flex-shrink-0">
      {icon}
    </div>
    <div>
      <h3 className="text-lg font-semibold text-slate-200 mb-2">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
    </div>
  </motion.div>
);

export default function App() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState<'landing' | 'auth' | 'dashboard'>('landing');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  const openAuth = (mode: 'signin' | 'signup') => {
    setAuthMode(mode);
    setCurrentView('auth');
    setIsMenuOpen(false); // close mobile menu if open
  };

  if (currentView === 'auth') {
    return <AuthPage onBack={() => setCurrentView('landing')} onSuccess={() => setCurrentView('dashboard')} initialMode={authMode} />;
  }

  if (currentView === 'dashboard') {
    return <Dashboard onLogout={() => { localStorage.removeItem('token'); setCurrentView('landing'); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-sky-500/30 overflow-x-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-sky-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xl tracking-tight">Career Edge</span>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Features</a>
            <a href="#" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">How it Works</a>
            <a href="#" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Contact</a>
            <a href="#" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">About</a>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <button onClick={() => openAuth('signin')} className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Sign In</button>
            <button onClick={() => openAuth('signup')} className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition-colors shadow-lg shadow-sky-500/20">
              Get Started
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button className="md:hidden p-2 text-slate-300" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <div className="md:hidden absolute top-20 left-0 right-0 bg-slate-900 border-b border-slate-800 p-6 flex flex-col gap-4 shadow-2xl">
            <a href="#" className="text-slate-300 font-medium py-2">Features</a>
            <a href="#" className="text-slate-300 font-medium py-2">How it Works</a>
            <a href="#" className="text-slate-300 font-medium py-2">Contact</a>
            <a href="#" className="text-slate-300 font-medium py-2">About</a>
            <hr className="border-slate-800 my-2" />
            <button onClick={() => openAuth('signin')} className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium mb-2">Sign In</button>
            <button onClick={() => openAuth('signup')} className="w-full py-3 rounded-lg bg-sky-500 text-white font-medium">Get Started</button>
          </div>
        )}
      </nav>

      <main className="relative z-10 pt-24 pb-16">
        {/* Hero Section */}
        <section className="container mx-auto px-6 pt-12 pb-24 md:pt-24 md:pb-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Text */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="flex flex-col gap-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium w-fit">
                <Sparkles className="w-3.5 h-3.5" />
                AI-Powered Interview Prep
              </div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
                Your Voice turns into a <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">bright opportunity.</span>
              </h1>
              <p className="text-lg md:text-xl text-slate-400 leading-relaxed max-w-xl">
                Practice with our AI-driven interview simulator. Perfect your pitch, refine your answers, and land your dream job with confidence.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mt-4">
                <button onClick={() => openAuth('signup')} className="px-8 py-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold transition-all shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 group">
                  Start Practicing
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
                <button 
                  onClick={() => document.getElementById('campus-map')?.scrollIntoView({ behavior: 'smooth' })}
                  className="px-8 py-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-all flex items-center justify-center gap-2 group border border-slate-700"
                >
                  <MapPin className="w-4 h-4 text-sky-400" />
                  Find Campus
                </button>
              </div>
            </motion.div>

            {/* Right Graphic */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex justify-center relative"
            >
              <div className="absolute inset-0 bg-sky-500/20 blur-[100px] rounded-full opacity-50" />
              <MorphingGraphic />
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section className="container mx-auto px-6 py-24 border-t border-slate-800/50">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Master every interview scenario</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">Our advanced AI analyzes your responses in real-time, providing actionable feedback to help you improve.</p>
          </div>

          <div className="flex flex-col gap-16">
            {/* Top large block */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="w-full h-full"
            >
              <LaptopMockup>
                <InterviewMockup />
              </LaptopMockup>
            </motion.div>

            {/* Bottom 3 smaller blocks */}
            <div className="grid lg:grid-cols-3 gap-6 items-stretch">
              <motion.div className="h-full" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }}>
                <FeatureCard
                  icon={<BrainCircuit className="w-6 h-6 text-sky-400" />}
                  title="Real-time AI Feedback"
                  description="Get instant analysis on your pacing, tone, and keyword usage as you speak, helping you adjust on the fly."
                />
              </motion.div>
              <motion.div className="h-full" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}>
                <FeatureCard
                  icon={<GraduationCap className="w-6 h-6 text-emerald-400" />}
                  title="Department & Course Readiness"
                  description="Practice with questions tailored to your chosen department — CCIT, CTE, or CBAPA — preparing you for real university enrollment interviews."
                />
              </motion.div>
              <motion.div className="h-full" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }}>
                <FeatureCard
                  icon={<BarChart className="w-6 h-6 text-amber-400" />}
                  title="Confidence Analysis"
                  description="Track your progress over time with detailed metrics on your interview performance and confidence scores."
                />
              </motion.div>
            </div>
          </div>
        </section>

        {/* Campus Location Section */}
        <section id="campus-map" className="container mx-auto px-6 py-24 border-t border-slate-800/50">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="flex flex-col gap-8"
            >
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium w-fit mb-4">
                  <MapPin className="w-3.5 h-3.5" />
                  Our Location
                </div>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Explore the <span className="text-emerald-400">PRMSU Castillejos Campus</span></h2>
                <p className="text-slate-400 text-lg leading-relaxed">
                  The PRMSU Castillejos Campus is dedicated to providing quality education closer to the community. Practice your interviews right here or visit us to explore our specialized course offerings.
                </p>
                <div className="mt-6">
                  <a 
                    href="https://www.google.com/maps/dir/?api=1&destination=14.914655,120.197460" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sky-400 font-bold hover:text-sky-300 transition-colors uppercase tracking-widest text-xs"
                  >
                    Get Directions
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                <div className="flex gap-4 items-start p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-sky-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-200 mb-1">Address</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">San Nicolas, Sitio Baring,<br />Castillejos, Zambales</p>
                  </div>
                </div>
                <div className="flex gap-4 items-start p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-200 mb-1">Email</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">prmsucaste1@gmail.com</p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative rounded-[2.5rem] overflow-hidden border border-slate-800 shadow-2xl h-[400px] group"
            >
              <div className="absolute inset-0 bg-sky-500/10 z-10 pointer-events-none group-hover:opacity-0 transition-opacity duration-500" />
              <iframe
                title="PRMSU Castillejos Campus Map"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1927.7012267434372!2d120.19745969839475!3d14.914654999999996!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x339679f962c794c9%3A0x794784a72428c0c5!2sPRESIDENT%20RAMON%20MAGSAYSAY%20STATE%20UNIVERSITY!5e0!3m2!1sen!2sph!4v1776418690828!5m2!1sen!2sph"
                width="100%"
                height="100%"
                style={{ border: 0, filter: 'invert(90%) hue-rotate(180deg) brightness(0.8) contrast(1.2)' }}
                allowFullScreen={true}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="relative z-0"
              />
            </motion.div>
          </div>
        </section>

        {/* Callout section hidden for now */}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 bg-slate-950 pt-16 pb-8 relative z-10">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
            <div className="col-span-2 md:col-span-1 flex flex-col gap-4 pr-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-bold text-lg tracking-tight text-slate-200">Career Edge</span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Empowering candidates to showcase their true potential through AI-driven interview practice and feedback.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-slate-200 mb-4">Product</h4>
              <ul className="flex flex-col gap-3 text-sm text-slate-400">
                <li><a href="#" className="hover:text-sky-400 transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Use Cases</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Enterprise</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-slate-200 mb-4">Resources</h4>
              <ul className="flex flex-col gap-3 text-sm text-slate-400">
                <li><a href="#" className="hover:text-sky-400 transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Interview Guides</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Community</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-slate-200 mb-4">Company</h4>
              <ul className="flex flex-col gap-3 text-sm text-slate-400">
                <li><a href="#" className="hover:text-sky-400 transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-sky-400 transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-800/50 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              © {new Date().getFullYear()} Career Edge Inc. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center hover:bg-slate-800 hover:border-slate-700 transition-all group">
                <Twitter className="w-4 h-4 text-slate-400 group-hover:text-sky-400" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center hover:bg-slate-800 hover:border-slate-700 transition-all group">
                <Linkedin className="w-4 h-4 text-slate-400 group-hover:text-sky-400" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center hover:bg-slate-800 hover:border-slate-700 transition-all group">
                <Github className="w-4 h-4 text-slate-400 group-hover:text-sky-400" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
