const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

// 1. Inject db import
if (!content.includes("import { db }")) {
    content = content.replace("import { useWebLLM } from '../hooks/useWebLLM';", "import { useWebLLM } from '../hooks/useWebLLM';\nimport { db } from '../db';");
}

// 2. Patch fetchProfile
const fetchProfileRegex = /  const fetchProfile = async \(\) => \{[\s\S]*?(?=  const fetchHistory = async \(\) => \{)/;
const newFetchProfile = `  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(\`\${API_URL}/users/me\`, {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      if (response.ok) {
        const data = await response.json();
        setProfile({
          firstName: data.first_name,
          department: data.department || '',
          profilePicture: data.profile_picture_url || \`https://api.dicebear.com/7.x/micah/svg?seed=\${data.first_name || 'Alex'}&backgroundColor=cbd5e1\`
        });
        
        db.profile.put({
          id: 1,
          first_name: data.first_name,
          department: data.department,
          profile_picture_url: data.profile_picture_url
        }).catch(console.error);
      }
    } catch (e) {
      console.warn("Offline: loading profile from cache");
      const cached = await db.profile.get(1);
      if (cached) {
        setProfile({
          firstName: cached.first_name,
          department: cached.department || '',
          profilePicture: cached.profile_picture_url || \`https://api.dicebear.com/7.x/micah/svg?seed=\${cached.first_name || 'Alex'}&backgroundColor=cbd5e1\`
        });
      }
    }
  };

`;

if (fetchProfileRegex.test(content)) {
    content = content.replace(fetchProfileRegex, newFetchProfile);
    console.log("Success fetchProfile patched.");
} else {
    console.log("Failed to find fetchProfile");
}

// 3. Patch fetchHistory
const fetchHistoryRegex = /  const fetchHistory = async \(\) => \{[\s\S]*?(?=  const handleLogout = \(\) => \{)/;
const newFetchHistory = `  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const [upRes, thRes] = await Promise.all([
        fetch(\`\${API_URL}/upcoming-student-interview/history\`, { headers: { 'Authorization': \`Bearer \${token}\` } }),
        fetch(\`\${API_URL}/thesis-interview/history\`, { headers: { 'Authorization': \`Bearer \${token}\` } })
      ]);
      if (upRes.ok && thRes.ok) {
        const upData = await upRes.json();
        const thData = await thRes.json();
        setUpcomingHistory(upData);
        setThesisHistory(thData);
        
        db.history.put({ id: 1, type: 'upcoming', data: upData, timestamp: Date.now() }).catch(console.error);
        db.history.put({ id: 2, type: 'thesis', data: thData, timestamp: Date.now() }).catch(console.error);
      }
    } catch (e) {
      console.warn("Offline: loading history from cache");
      const upCached = await db.history.get(1);
      const thCached = await db.history.get(2);
      
      const upData = upCached ? upCached.data : [];
      const thData = thCached ? thCached.data : [];
      
      // Also inject any pending offline sessions so they show up!
      const offlineSessions = await db.offlineSessions.toArray();
      const offlineUpcoming = offlineSessions.filter(s => s.type === 'upcoming').map(s => ({
         id: s.localId,
         status: s.status,
         start_time: new Date(s.timestamp).toISOString(),
         total_score: s.evaluation.total_score || s.evaluation.technical_score || 0,
         passed: true,
         isOffline: true
      }));
      const offlineThesis = offlineSessions.filter(s => s.type === 'thesis').map(s => ({
         id: s.localId,
         status: s.status,
         start_time: new Date(s.timestamp).toISOString(),
         total_score: s.evaluation.total_score || s.evaluation.score_ccit_technical_innovation || 0,
         passed: true,
         isOffline: true
      }));

      setUpcomingHistory([...offlineUpcoming, ...upData]);
      setThesisHistory([...offlineThesis, ...thData]);
    }
  };

`;

if (fetchHistoryRegex.test(content)) {
    content = content.replace(fetchHistoryRegex, newFetchHistory);
    console.log("Success fetchHistory patched.");
} else {
    console.log("Failed to find fetchHistory");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
