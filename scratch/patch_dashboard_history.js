const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const regex = /  const fetchHistory = React\.useCallback\(async \(\) => \{[\s\S]*?(?=  useEffect\(\(\) => \{)/;

const replacement = `  const fetchHistory = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(\`\${API_URL}/upcoming-student-interview/\`, {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      if (res.ok) {
        const data = await res.json();
        setInterviewHistory(data);
        db.history.put({ id: 1, type: 'upcoming', data: data, timestamp: Date.now() }).catch(console.error);
      }
    } catch (e) {
      console.warn("Offline: loading interview history from cache");
      const cached = await db.history.get(1);
      const data = cached ? cached.data : [];
      
      const offlineSessions = await db.offlineSessions.toArray();
      const offlineUpcoming = offlineSessions.filter(s => s.type === 'upcoming').map(s => ({
         id: s.localId,
         status: s.status === 'pending_sync' ? 'pending_sync' : 'completed',
         start_time: new Date(s.timestamp).toISOString(),
         total_score: s.evaluation?.total_score || s.evaluation?.technical_score || 0,
         passed: true,
         isOffline: true
      }));

      setInterviewHistory([...offlineUpcoming, ...data]);
    }
  }, [API_URL]);

  const fetchThesisHistory = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(\`\${API_URL}/thesis-interview/\`, {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      if (res.ok) {
        const data = await res.json();
        setThesisHistory(data);
        db.history.put({ id: 2, type: 'thesis', data: data, timestamp: Date.now() }).catch(console.error);
      }
    } catch (e) {
      console.warn("Offline: loading thesis history from cache");
      const cached = await db.history.get(2);
      const data = cached ? cached.data : [];
      
      const offlineSessions = await db.offlineSessions.toArray();
      const offlineThesis = offlineSessions.filter(s => s.type === 'thesis').map(s => ({
         id: s.localId,
         status: s.status === 'pending_sync' ? 'pending_sync' : 'completed',
         start_time: new Date(s.timestamp).toISOString(),
         total_score: s.evaluation?.total_score || s.evaluation?.score_ccit_technical_innovation || 0,
         passed: true,
         isOffline: true
      }));

      setThesisHistory([...offlineThesis, ...data]);
    }
  }, [API_URL]);

`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    console.log("Success fetchHistory and fetchThesisHistory patched.");
} else {
    console.log("Failed to find fetchHistory regex");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
