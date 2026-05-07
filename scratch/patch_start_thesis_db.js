const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const startThesisRegex = /  const startThesisSession = async \(\) => \{[\s\S]*?(?=  const exitThesisSession = \(\) => \{)/;

const newStartThesis = `  const startThesisSession = async () => {
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
    let sid: string | number = '';
    let isOffline = false;
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
        setThesisIsStarting(false);
        return;
      }
      const data = await response.json();
      sid = data.id;
    } catch (err: any) {
      console.warn("Offline: generating local thesis session ID");
      sid = 'local_' + Date.now();
      isOffline = true;
    }
    
    if (sid) {
      thesisSessionIdRef.current = sid as number;
      setThesisSessionId(sid as number);

      let abstractText = "";
      if (thesisAbstractFile) {
        setThesisAbstractUploading(true);
        try {
          if (thesisAbstractFile.name.endsWith('.txt')) {
             abstractText = await thesisAbstractFile.text();
          } else if (thesisAbstractFile.name.endsWith('.pdf')) {
             const arrayBuffer = await thesisAbstractFile.arrayBuffer();
             const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
             let fullText = "";
             // Only parse first 10 pages to save time/memory
             const maxPages = Math.min(pdf.numPages, 10);
             for (let i = 1; i <= maxPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + "\\n";
             }
             abstractText = fullText;
          }
        } catch (e) {
          console.error('Abstract parsing failed:', e);
          setThesisStartError("Failed to read abstract file offline.");
          setThesisAbstractUploading(false);
          setThesisIsStarting(false);
          return;
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
      const systemPrompt = \`You are Professor Maxiel, an expert panelist for a thesis defense at \${dep}. Probe the student's research abstract. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude gracefully when finished.\\n\\nStudent's Abstract/Proposal context:\\n\${abstractText ? abstractText.substring(0, 5000) : 'None provided.'}\`; // Truncate to 5000 chars to avoid token limits
      const initialMsgs = [{ role: 'system', content: systemPrompt }];
      setChatMessages(initialMsgs);
      
      handleLocalWebLLM("Hello! I am here and ready to begin the thesis defense.", initialMsgs);
      setThesisIsStarting(false);
    }
  };

`;

if (startThesisRegex.test(content)) {
    content = content.replace(startThesisRegex, newStartThesis);
    console.log("Success startThesisSession patched.");
} else {
    console.log("Failed to find startThesisSession regex");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
