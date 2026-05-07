const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const regex = /  const finishInterviewSession = async \(\) => \{[\s\S]*?(?=  const formatTimer = \(seconds: number\) => \{)/;

const replacement = `  const finishInterviewSession = async () => {
    if (!sessionId) return;
    setIsFinishingInterview(true);
    try {
      let evaluation = null;
      if (webLLMEngine) {
         const gradingPrompt = \`You are a strict grading algorithm. You will evaluate the following transcript of an incoming college freshman interview. 
Extract 5 scores out of 100 based on the rubric. Respond in STRICT JSON matching this schema exactly:
{
  "technical_score": 0,
  "problem_solving_score": 0,
  "coding_score": 0,
  "communication_score": 0,
  "soft_skills_score": 0,
  "feedback_summary": "string"
}
Transcript:
\${conversationLog.map(m => m.sender.toUpperCase() + ": " + m.text).join('\\n')}\`;
         
         const resp = await webLLMEngine.chat.completions.create({
           messages: [{ role: 'user', content: gradingPrompt }],
           response_format: { type: "json_object" }
         });
         
         try {
           evaluation = JSON.parse(resp.choices[0].message.content || "{}");
         } catch(e) {
           console.error("Failed to parse local evaluation", e);
         }
      }

      const token = localStorage.getItem('token');
      const response = await fetch(\`\${API_URL}/upcoming-student-interview/\${sessionId}/complete\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${token}\`
        },
        body: JSON.stringify({ conversation: conversationLog, evaluation })
      });
      if (response.ok) {
        const data = await response.json();
        setInterviewResult(data);
        stopListening();
        setIsLeaveModalOpen(false);
        setIsAiSpeaking(false);
        setIsListening(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
      } else {
        alert("Failed to grade interview. Please try again.");
      }
    } catch (e) {
      console.error(e);
      alert("Network error finishing interview.");
    } finally {
      setIsFinishingInterview(false);
    }
  };

`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
    console.log("Success finishInterviewSession patched.");
} else {
    console.log("Failed to find finishInterviewSession target");
}
