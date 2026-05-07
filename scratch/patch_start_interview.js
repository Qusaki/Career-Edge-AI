const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const startInterviewRegex = /  const startInterviewSession = async \(\) => \{[\s\S]*?(?=  const stopListening = \(\) => \{)/;

const newStartInterview = `  const startInterviewSession = async () => {
    setIsStartingInterview(true);
    let sid: string | number = '';
    let isOffline = false;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(\`\${API_URL}/upcoming-student-interview/start\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${token}\`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        sid = data.id;
      } else {
        const errorText = await response.text();
        alert(\`Failed to start session: \${errorText}\`);
        return;
      }
    } catch (err: any) {
      console.warn("Offline: generating local session ID");
      sid = 'local_' + Date.now();
      isOffline = true;
    } finally {
      setIsStartingInterview(false);
    }
    
    if (sid) {
      sessionIdRef.current = sid as number;
      setSessionId(sid as number);
      activeInterviewModeRef.current = 'enrollment';
      setActiveTab('interview-session');

      const systemPrompt = "You are Professor Maxiel, an expert interviewer. Your sole purpose is to interview an incoming college freshman. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude when finished.";
      const initialMsgs = [{ role: 'system', content: systemPrompt }];
      setChatMessages(initialMsgs);
      
      handleLocalWebLLM("Hello! I am here and ready to begin the interview.", initialMsgs);
    }
  };

`;

if (startInterviewRegex.test(content)) {
    content = content.replace(startInterviewRegex, newStartInterview);
    console.log("Success startInterviewSession patched.");
} else {
    console.log("Failed to find startInterviewSession regex");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
