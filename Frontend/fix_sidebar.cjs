const fs = require('fs');

const file = 'c:/Users/John Marcel Aleman/Desktop/Career-Edge-AI/Frontend/src/components/Dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// The sidebar starts at <aside className="w-64 bg-[#0B1120]...
// and ends at </aside>. 
// I need to change text-slate-* inside the sidebar back to text-white or text-neutral-* for readability.
// Since it's hard to parse HTML with regex, let's target the specific components in the sidebar.

// Profile Area Name:
content = content.replace(/<h3 className="font-medium text-sm text-slate-700 truncate">\{profile\.name\}<\/h3>/g, '<h3 className="font-medium text-sm text-white truncate">{profile.name}</h3>');

// Sidebar nav items:
// Dashboard, History, Analytics, Settings
content = content.replace(/text-slate-500 hover:bg-white shadow-sm border border-slate-200 hover:text-slate-700/g, 'text-neutral-400 hover:bg-[#172554] hover:text-white border-transparent shadow-none bg-transparent');

// The script previously replaced:
// hover:bg-neutral-800 -> hover:bg-white shadow-sm border border-slate-200
// We need to fix the sidebar buttons.
content = content.replace(/hover:bg-white shadow-sm border border-slate-200 hover:text-slate-700/g, 'hover:bg-[#172554] hover:text-white');
content = content.replace(/text-slate-500 hover:bg-\[#172554\]/g, 'text-neutral-400 hover:bg-[#172554]');

// Locked button:
content = content.replace(/bg-white shadow-sm border border-slate-200 text-slate-500 cursor-not-allowed/g, 'bg-[#0f172a] text-neutral-500 cursor-not-allowed border-[#1e293b]');
content = content.replace(/<Lock className="w-4 h-4 text-slate-500" \/>/g, '<Lock className="w-4 h-4 text-neutral-500" />');

// Sign out button:
content = content.replace(/text-slate-500 hover:bg-\[#172554\] hover:text-white font-medium transition-colors/g, 'text-neutral-400 hover:bg-[#172554] hover:text-white font-medium transition-colors');

// Any remaining broken sidebar backgrounds:
content = content.replace(/bg-white shadow-sm border border-slate-200\/50/g, 'bg-[#0B1120] border-transparent');
content = content.replace(/bg-white shadow-sm border border-slate-200\/80/g, 'bg-[#0B1120] border-transparent');

fs.writeFileSync(file, content, 'utf8');
console.log('Sidebar text fixed!');
