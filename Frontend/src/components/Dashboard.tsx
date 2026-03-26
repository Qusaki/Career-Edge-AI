import React, { useState } from 'react';
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
  Send,
  PlusCircle,
  Paperclip
} from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'settings' | 'new-interview' | 'interview-session'>('dashboard');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedCompanyType, setSelectedCompanyType] = useState('');
  const [position, setPosition] = useState('');

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
      {activeTab !== 'new-interview' && activeTab !== 'interview-session' && (
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen shrink-0">
          {/* Logo Area */}
          <div className="h-20 px-6 border-b border-slate-800 flex items-center shrink-0">
            <span className="font-bold text-xl tracking-tight text-white">Career Edge</span>
          </div>

          {/* Profile Area */}
          <div className="p-4 border-b border-slate-800">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 overflow-hidden shrink-0">
                <img 
                  src="https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1" 
                  alt="User" 
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="overflow-hidden">
                <h3 className="font-medium text-sm text-slate-200 truncate">John Doe</h3>
                <p className="text-xs text-sky-400 font-medium mt-0.5 truncate">CCIT</p>
              </div>
            </div>
          </div>

          {/* Main Action */}
          <div className="p-4">
            <button 
              onClick={() => {
                setSelectedCompanyType('');
                setPosition('');
                setActiveTab('new-interview');
              }}
              className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-lg ${activeTab === 'new-interview' ? 'bg-sky-600 text-white shadow-sky-600/20' : 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20'}`}
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
                <h1 className="text-4xl font-bold text-slate-100 tracking-tight">Welcome back, John</h1>
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

          {activeTab === 'new-interview' && (
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
                              className={`px-4 py-3 cursor-pointer transition-colors duration-200 flex items-center ${
                                selectedCompanyType === type.value 
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
                className="w-full max-w-6xl mx-auto flex-1 bg-[#111827] rounded-2xl mb-6 mt-2 flex items-center justify-center overflow-hidden relative shadow-2xl"
              >
                <div className="flex flex-col items-center justify-center gap-8">
                  <div className="flex items-center justify-center gap-2 h-32">
                    {[1, 2, 3, 5, 8, 5, 3, 2, 1].map((val, i) => (
                      <motion.div
                        key={i}
                        className="w-2 sm:w-3 bg-sky-400 rounded-full"
                        animate={{
                          height: [20, 20 + val * 10, 20],
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
                  <p className="text-slate-400 text-lg font-medium animate-pulse">AI is listening...</p>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center justify-center gap-6 w-full max-w-4xl pb-0"
              >
                <button 
                  className="bg-[#171e2e] hover:bg-[#1e293b] text-slate-200 w-16 h-16 rounded-2xl transition-all duration-300 flex items-center justify-center shrink-0"
                  title="Add File"
                >
                  <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                  </svg>
                </button>

                <button 
                  className="bg-[#2a364d] hover:bg-[#364563] text-white w-24 h-24 rounded-[2rem] transition-all duration-300 flex items-center justify-center shrink-0"
                  title="Toggle Microphone"
                >
                  <svg viewBox="0 0 24 24" className="w-12 h-12" fill="currentColor">
                    <path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5z" />
                    <path d="M5 9v2a7 7 0 0 0 6 6.93V22h2v-4.07A7 7 0 0 0 19 11V9h-2v2a5 5 0 0 1-10 0V9H5z" />
                  </svg>
                </button>

                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="bg-[#171e2e] hover:bg-[#1e293b] text-slate-200 w-16 h-16 rounded-2xl transition-all duration-300 flex items-center justify-center shrink-0"
                  title="Leave"
                >
                  <LogOut className="w-8 h-8" />
                </button>
              </motion.div>
            </div>
          )}

          {/* Placeholders for other tabs */}
          {(activeTab === 'history' || activeTab === 'analytics' || activeTab === 'settings') && (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-500 text-lg">This section is coming soon.</p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
};
