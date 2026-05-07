const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const regex = /  const startThesisSession = async \(\) => \{[\s\S]*?(?=  const exitThesisSession = \(\) => \{)/;

const replacement = `  const startThesisSession = async () => {
    setThesisStartError(null);

    // Pre-flight: department must be CCIT, CTE, or CBAPA
    const dep = (profile.department || '').trim().toUpperCase();
    if (!dep || !['CCIT', 'CTE', 'CBAPA'].includes(dep)) {
      setThesisStartError(
        \`Your department ("\${profile.department || 'not set'}") is not eligible for Thesis Defense. \` +
        \`Please update your department to CCIT, CTE, or CBAPA in your Profile settings.\`
      );
      return;
    }

    setThesisIsStarting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(\`\${API_URL}/thesis-interview/start\`, {
        method: 'POST',
        headers: { 'Authorization': \`Bearer \${token}\`, 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        let errMsg = 'Failed to start thesis defense.';
        try {
          const errJson = await response.json();
          errMsg = errJson?.detail || errMsg;
        } catch {
          errMsg = await response.text() || errMsg;
        }
        setThesisStartError(errMsg);
        return;
      }
      const data = await response.json();
      const sid = data.id;
      thesisSessionIdRef.current = sid;
      setThesisSessionId(sid);

      if (thesisAbstractFile) {
        setThesisAbstractUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', thesisAbstractFile);
          await fetch(\`\${API_URL}/thesis-interview/\${sid}/upload-abstract\`, {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${token}\` },
            body: formData
          });
        } catch (e) {
          console.error('Abstract upload failed:', e);
        } finally {
          setThesisAbstractUploading(false);
        }
      }

      setThesisConversationLog([]);
      setThesisResult(null);
      setThesisElapsedSeconds(0);
      activeInterviewModeRef.current = 'thesis';
      setActiveTab('thesis-session');
      if (thesisTimerRef.current) clearInterval(thesisTimerRef.current);
      thesisTimerRef.current = setInterval(() => setThesisElapsedSeconds(prev => prev + 1), 1000);

      // WebLLM Setup
      const systemPrompt = \`You are Professor Maxiel, an expert panelist for a thesis defense at \${dep}. Probe the student's research abstract. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude gracefully when finished.\`;
      const initialMsgs = [{ role: 'system', content: systemPrompt }];
      setChatMessages(initialMsgs);
      
      handleLocalWebLLM("Hello! I am here and ready to begin the thesis defense.", initialMsgs);

    } catch (err) {
      console.error(err);
      setThesisStartError(\`Network error: \${err.message}\`);
    } finally {
      setThesisIsStarting(false);
      setThesisAbstractUploading(false);
    }
  };

`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
    console.log("Success Thesis patched.");
} else {
    console.log("Failed to find thesis target");
}
