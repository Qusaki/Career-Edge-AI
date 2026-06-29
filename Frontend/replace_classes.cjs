const fs = require('fs');

const file = 'c:/Users/John Marcel Aleman/Desktop/Career-Edge-AI/Frontend/src/components/Dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// The goal is to separate the Sidebar, Main Background, and Cards.
// 1. Root wrapper: min-h-screen bg-neutral-950 text-neutral-50 -> min-h-screen bg-slate-50 text-slate-900
content = content.replace(/bg-neutral-950 text-neutral-50/g, 'bg-slate-50 text-slate-900');

// 2. Sidebar: <aside className="w-64 bg-neutral-900 border-r border-neutral-800
content = content.replace(/<aside className="w-64 bg-neutral-900 border-r border-neutral-800/g, '<aside className="w-64 bg-[#0B1120] border-r border-[#172554] text-white');
// Sidebar active items bg-violet-500/10 -> bg-[#ca8a04]/20 text-[#ca8a04]
// Wait, we can keep violet and just map violet to gold in index.css

// 3. Main Dashboard cards are usually "bg-neutral-900 border border-neutral-800"
content = content.replace(/bg-neutral-900 border border-neutral-800/g, 'bg-white shadow-sm border border-slate-200 text-slate-800');

// 4. Other bg-neutral-900 instances (like the stats cards without border-neutral-800 if they exist)
content = content.replace(/bg-neutral-900/g, 'bg-white shadow-sm border border-slate-200');

// 5. Text colors in main area
// text-neutral-100 (which were white) -> text-slate-800
content = content.replace(/text-neutral-100/g, 'text-slate-800');
content = content.replace(/text-neutral-200/g, 'text-slate-700');
content = content.replace(/text-neutral-300/g, 'text-slate-600');
content = content.replace(/text-neutral-400/g, 'text-slate-500');

// 6. Fix any explicit white text that should be dark
// "bg-violet-500 hover:bg-violet-400 text-white" -> this is fine (gold button with white text)

// 7. Fix Logo text
content = content.replace(/<span className="font-bold text-xl tracking-tight text-white">Career Edge<\/span>/g, '<span className="font-bold text-xl tracking-tight text-[#ca8a04]">Career Edge</span>');

fs.writeFileSync(file, content, 'utf8');
console.log('Classes updated!');
