const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const regex = /  useEffect\(\(\) => \{[\s\S]*?const fetchUser = async \(\) => \{/;

const newContent = `  useEffect(() => {
    const syncOfflineData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const pendingSessions = await db.offlineSessions.where('status').equals('pending_sync').toArray();
        if (pendingSessions.length === 0) return;
        
        console.log(\`Syncing \${pendingSessions.length} offline sessions to cloud...\`);
        
        for (const session of pendingSessions) {
           const endpointPrefix = session.type === 'upcoming' ? '/upcoming-student-interview' : '/thesis-interview';
           
           // Step 1: Start
           const startRes = await fetch(\`\${API_URL}\${endpointPrefix}/start\`, {
             method: 'POST',
             headers: { 'Authorization': \`Bearer \${token}\`, 'Content-Type': 'application/json' }
           });
           if (!startRes.ok) continue; // Try again later
           
           const startData = await startRes.json();
           const realId = startData.id;
           
           // Step 2: Complete
           const completeRes = await fetch(\`\${API_URL}\${endpointPrefix}/\${realId}/complete\`, {
             method: 'POST',
             headers: { 'Authorization': \`Bearer \${token}\`, 'Content-Type': 'application/json' },
             body: JSON.stringify({ conversation: session.conversationLog, evaluation: session.evaluation })
           });
           
           if (completeRes.ok) {
              await db.offlineSessions.update(session.localId, { status: 'synced' });
              console.log(\`Synced session \${session.localId} -> \${realId}\`);
           }
        }
        
        // Refresh history
        fetchHistory();
        fetchThesisHistory();
      } catch (e) {
        console.error("Sync failed", e);
      }
    };

    window.addEventListener('online', syncOfflineData);
    // Also try syncing on component mount if online
    if (navigator.onLine) {
      syncOfflineData();
    }

    const fetchUser = async () => {`;

if (content.match(regex)) {
    content = content.replace(regex, newContent);
    fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
    console.log("Success syncOfflineData patched.");
} else {
    console.log("Failed to find syncOfflineData target");
}
