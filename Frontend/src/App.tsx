import { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Mic, FileText, CheckCircle, BarChart, Play, ArrowRight, Github, Twitter, Linkedin, Sparkles, BrainCircuit, Target, Menu, X, MessageSquare, Video, Plus, Send, MousePointer2, Paperclip } from 'lucide-react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const micRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);

  const [videoEnabled, setVideoEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [inputText, setInputText] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [hasAttachment, setHasAttachment] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 150, y: 150 });
  const [isClicking, setIsClicking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCursor, setShowCursor] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const getPos = (ref: React.RefObject<HTMLElement | null>) => {
      if (!ref.current || !containerRef.current) return null;
      const rect = ref.current.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      return {
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + rect.height / 2
      };
    };

    const moveCursor = async (ref: React.RefObject<HTMLElement | null>) => {
      const pos = getPos(ref);
      if (pos) {
        setCursorPos(pos);
        await sleep(600); // Wait for movement
      }
    };

    const click = async () => {
      setIsClicking(true);
      await sleep(150);
      setIsClicking(false);
      await sleep(150);
    };

    const runSequence = async () => {
      await sleep(1000); // Initial delay
      if (!isMounted) return;
      setShowCursor(true);

      while (isMounted) {
        // Reset
        setVideoEnabled(false);
        setMicEnabled(false);
        setInputText("");
        setShowMenu(false);
        setHasAttachment(false);
        setIsExpanded(false);
        
        // Move cursor to center initially
        if (containerRef.current) {
          setCursorPos({
            x: containerRef.current.offsetWidth / 2,
            y: containerRef.current.offsetHeight / 2
          });
        }
        await sleep(1000);
        if (!isMounted) break;

        setIsExpanded(true);
        await sleep(1000); // Wait for expansion

        // 1. Click Video
        await moveCursor(videoRef);
        if (!isMounted) break;
        await click();
        setVideoEnabled(true);
        await sleep(400);

        // 2. Click Mic
        await moveCursor(micRef);
        if (!isMounted) break;
        await click();
        setMicEnabled(true);
        await sleep(400);

        // 3. Click Input
        await moveCursor(inputRef);
        if (!isMounted) break;
        await click();
        
        // Type
        const text = "Here is my resume";
        for (let i = 0; i <= text.length; i++) {
          if (!isMounted) break;
          setInputText(text.slice(0, i));
          await sleep(80);
        }
        await sleep(400);

        // 4. Click Plus
        await moveCursor(plusRef);
        if (!isMounted) break;
        await click();
        setShowMenu(true);
        await sleep(600); // Wait for menu to animate in

        // 5. Click Resume
        await moveCursor(resumeRef);
        if (!isMounted) break;
        await click();
        setShowMenu(false);
        setHasAttachment(true);
        await sleep(400);

        // 6. Click Send
        await moveCursor(sendRef);
        if (!isMounted) break;
        await click();
        setInputText("");
        setHasAttachment(false);
        
        // Wait before restarting
        await sleep(2000);
      }
    };

    runSequence();
    return () => { isMounted = false; };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-900/80 backdrop-blur-xl flex flex-col relative overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-row gap-4 p-4">
        {/* Video placeholder / Main Area */}
        <div className="flex-1 bg-slate-950/50 rounded-xl relative overflow-hidden border border-slate-800/50 group flex flex-col items-center justify-center">
          
          {/* PiP User Avatar */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 w-20 h-28 sm:w-28 sm:h-36 bg-slate-800 rounded-lg border border-slate-700/50 overflow-hidden shadow-2xl z-10">
            <img 
              src="https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1" 
              alt="You" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute bottom-1.5 left-1.5 sm:bottom-2 sm:left-2 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] text-white font-medium flex items-center gap-1">
              You
            </div>
          </div>

          {/* Sound Wave */}
          <div className="flex items-center justify-center gap-1.5 h-24">
            {[1, 2.5, 4, 6, 4, 2.5, 1].map((val, i) => (
              <motion.div
                key={i}
                className="w-1.5 sm:w-2 bg-sky-400 rounded-full"
                animate={{
                  height: [15, 15 + val * 8, 15],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.1,
                }}
              />
            ))}
          </div>

          {/* Bottom Bar: Message Box widening */}
          <div className="absolute bottom-2 sm:bottom-4 left-0 right-0 flex justify-center items-center gap-1.5 sm:gap-2 px-2 sm:px-4">
            <div 
              ref={videoRef}
              className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 ${videoEnabled ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >
              <Video className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div 
              ref={micRef}
              className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 ${micEnabled ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >
              <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>

            <motion.div 
              className="h-8 sm:h-10 bg-slate-800 rounded-full flex items-center relative overflow-visible w-full max-w-[200px] sm:max-w-[320px]"
              initial={{ width: 32 }}
              animate={{ width: isExpanded ? "100%" : 32 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            >
              {/* Expanded Content */}
              <motion.div 
                className="flex items-center justify-between w-full px-1 absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.3, delay: isExpanded ? 0.3 : 0 }}
                style={{ pointerEvents: isExpanded ? 'auto' : 'none' }}
              >
                <div className="relative">
                  <div 
                    ref={plusRef}
                    className="w-6 h-6 sm:w-8 sm:h-8 rounded-full hover:bg-slate-700 flex items-center justify-center text-slate-400 cursor-pointer flex-shrink-0"
                  >
                    <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </div>
                  
                  {/* Popup Menu */}
                  <motion.div 
                    className="absolute bottom-[120%] left-0 w-32 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: showMenu ? 1 : 0, y: showMenu ? 0 : 10, scale: showMenu ? 1 : 0.95 }}
                    style={{ pointerEvents: showMenu ? 'auto' : 'none' }}
                  >
                    <button 
                      ref={resumeRef}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"
                    >
                      <FileText className="w-3 h-3" /> Resume.pdf
                    </button>
                  </motion.div>
                </div>

                <div 
                  ref={inputRef}
                  className="flex-1 px-1 sm:px-2 text-[10px] sm:text-xs text-slate-300 truncate flex items-center gap-1 h-full cursor-text"
                >
                  {hasAttachment && (
                    <div className="bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Paperclip className="w-3 h-3" />
                      <span className="text-[8px] sm:text-[10px]">Resume.pdf</span>
                    </div>
                  )}
                  {inputText || (!hasAttachment && <span className="text-slate-500">Type a message...</span>)}
                  {/* Blinking cursor */}
                  {isExpanded && <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 h-3 sm:h-4 bg-sky-400 inline-block ml-0.5" />}
                </div>
                
                <div 
                  ref={sendRef}
                  className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-sky-500 flex items-center justify-center text-white cursor-pointer flex-shrink-0"
                >
                  <Send className="w-3 h-3 ml-0.5" />
                </div>
              </motion.div>
              
              {/* Initial Message Icon */}
              <motion.div 
                className="absolute inset-0 flex items-center justify-center text-slate-400"
                initial={{ opacity: 1 }}
                animate={{ opacity: isExpanded ? 0 : 1 }}
                transition={{ duration: 0.3 }}
                style={{ pointerEvents: isExpanded ? 'none' : 'auto' }}
              >
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Animated Cursor */}
      {showCursor && (
        <motion.div
          className="absolute z-50 pointer-events-none"
          animate={{ 
            left: cursorPos.x, 
            top: cursorPos.y,
            scale: isClicking ? 0.8 : 1
          }}
          transition={{ 
            left: { duration: 0.5, ease: "easeInOut" },
            top: { duration: 0.5, ease: "easeInOut" },
            scale: { duration: 0.1 }
          }}
          style={{ x: "-20%", y: "-20%" }} // Offset so the tip of the cursor is at the coordinate
        >
          <MousePointer2 className="w-5 h-5 sm:w-6 sm:h-6 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" fill="#0f172a" />
        </motion.div>
      )}
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
  <motion.div 
    whileHover={{ y: -5 }}
    className="bg-slate-900/50 border border-slate-800/50 p-6 rounded-2xl flex gap-4 items-start hover:bg-slate-800/50 transition-colors"
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
                  <button className="px-8 py-4 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700 text-white font-semibold transition-all flex items-center justify-center gap-2">
                    <Play className="w-4 h-4" />
                    Watch Demo
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
             <div className="grid lg:grid-cols-3 gap-6">
               <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }}>
                 <FeatureCard 
                   icon={<BrainCircuit className="w-6 h-6 text-sky-400" />}
                   title="Real-time AI Feedback"
                   description="Get instant analysis on your pacing, tone, and keyword usage as you speak, helping you adjust on the fly."
                 />
               </motion.div>
               <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}>
                 <FeatureCard 
                   icon={<Target className="w-6 h-6 text-emerald-400" />}
                   title="Industry-Specific Questions"
                   description="Practice with a curated library of questions tailored to your specific role, seniority, and target company."
                 />
               </motion.div>
               <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }}>
                 <FeatureCard 
                   icon={<BarChart className="w-6 h-6 text-amber-400" />}
                   title="Confidence Analysis"
                   description="Track your progress over time with detailed metrics on your interview performance and confidence scores."
                 />
               </motion.div>
             </div>
           </div>
        </section>

        {/* Callout Section */}
        <section className="container mx-auto px-6 py-24">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl mx-auto text-center flex flex-col items-center"
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Ready to ace your next interview?</h2>
            <p className="text-lg text-slate-400 mb-12 max-w-2xl">
              Join thousands of candidates who have successfully landed their dream jobs using our platform.
            </p>
            
            {/* Large block below text as per wireframe */}
            <div className="w-full bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 -mt-20 -mr-20 w-64 h-64 bg-sky-500/20 blur-[80px] rounded-full pointer-events-none" />
              <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-64 h-64 bg-indigo-500/20 blur-[80px] rounded-full pointer-events-none" />
              
              <div className="relative z-10">
                <h3 className="text-2xl md:text-3xl font-semibold mb-8 text-white">Start your free trial today</h3>
                <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-xl mx-auto">
                  <input 
                    type="email" 
                    placeholder="Enter your email address" 
                    className="px-5 py-4 rounded-xl bg-slate-950/50 border border-slate-700 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-slate-200 w-full sm:w-auto flex-1 transition-all"
                  />
                  <button onClick={() => openAuth('signup')} className="px-8 py-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold transition-colors whitespace-nowrap shadow-lg shadow-sky-500/25">
                    Get Started Free
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-4">No credit card required. 14-day free trial.</p>
              </div>
            </div>
          </motion.div>
        </section>
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
