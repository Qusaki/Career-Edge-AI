const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const finishThesisRegex = /  const finishThesisSession = async \(\) => \{[\s\S]*?(?=  const sendToGemini = async \(text: string\) => \{)/;

const newFinishThesis = `  const finishThesisSession = async () => {
    if (!thesisSessionIdRef.current) return;
    setThesisIsFinishing(true);
    let evaluation = null;
    
    try {
      if (webLLMEngine) {
         const gradingPrompt = \`You are a strict grading algorithm. Evaluate the transcript of this thesis defense.
Extract scores out of 100 based on the rubric. Respond in STRICT JSON matching this schema exactly:
{
  "technical_innovation_score": 0,
  "system_implementation_score": 0,
  "experimental_validation_score": 0,
  "literature_review_score": 0,
  "demo_quality_score": 0,
  "feedback_summary": "string"
}
Transcript:
\${thesisConversationLog.map(m => m.sender.toUpperCase() + ": " + m.text).join('\\n')}\`;
         
         const resp = await webLLMEngine.chat.completions.create({
           messages: [{ role: 'user', content: gradingPrompt }],
           response_format: { type: "json_object" }
         });
         
         try {
           evaluation = JSON.parse(resp.choices[0].message.content || "{}");
           if (evaluation.technical_innovation_score) {
              evaluation.score_ccit_technical_innovation = evaluation.technical_innovation_score;
           }
         } catch(e) {
           console.error("Failed to parse local thesis evaluation", e);
         }
      }

      if (String(thesisSessionIdRef.current).startsWith('local_')) {
          // Offline mode
          await db.offlineSessions.put({
            localId: String(thesisSessionIdRef.current),
            type: 'thesis',
            status: 'pending_sync',
            conversationLog: thesisConversationLog,
            evaluation: evaluation,
            timestamp: Date.now()
          });
          
          setThesisResult({ ...evaluation, total_score: evaluation?.total_score || evaluation?.score_ccit_technical_innovation || 0, passed: true });
          stopListening();
          setThesisIsLeaveModalOpen(false);
          setIsAiSpeaking(false);
          isAiSpeakingRef.current = false;
          setIsListening(false);
          if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
          if (audioPlayerRef.current) audioPlayerRef.current.pause();
          return;
      }

      const token = localStorage.getItem('token');
      const response = await fetch(\`\${API_URL}/thesis-interview/\${thesisSessionIdRef.current}/complete\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
        body: JSON.stringify({ conversation: thesisConversationLog, evaluation })
      });
      if (response.ok) {
        const data = await response.json();
        setThesisResult(data);
        stopListening();
        setThesisIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        isAiSpeakingRef.current = false;
        setIsListening(false);
        if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        alert('Failed to grade thesis defense. Please try again.');
      }
    } catch (e) {
      console.warn("Offline: saving completed thesis session to cache");
      await db.offlineSessions.put({
        localId: String(thesisSessionIdRef.current),
        type: 'thesis',
        status: 'pending_sync',
        conversationLog: thesisConversationLog,
        evaluation: evaluation,
        timestamp: Date.now()
      });
      
      setThesisResult({ ...evaluation, total_score: evaluation?.total_score || evaluation?.score_ccit_technical_innovation || 0, passed: true });
      stopListening();
      setThesisIsLeaveModalOpen(false);
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
      setIsListening(false);
      if (thesisTimerRef.current) { clearInterval(thesisTimerRef.current); thesisTimerRef.current = null; }
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
    } finally {
      setThesisIsFinishing(false);
      fetchThesisHistory();
    }
  };

`;

if (finishThesisRegex.test(content)) {
    content = content.replace(finishThesisRegex, newFinishThesis);
    console.log("Success finishThesisSession patched.");
} else {
    console.log("Failed to find finishThesisSession regex");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
