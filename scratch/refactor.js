const fs = require('fs');

let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const webllmHelper = `
  const handleLocalWebLLM = async (userText, currentMessages) => {
    if (!webLLMEngine) {
      alert("AI is still loading. Please wait a moment.");
      return;
    }
    
    // Add user message to state
    const newMessages = [...currentMessages, { role: 'user', content: userText }];
    setChatMessages(newMessages);
    
    setAiResponseText('');
    setIsAiSpeaking(true);
    isAiSpeakingRef.current = true;
    
    // Fake lip sync loop
    const startLipSync = () => {
      const loop = () => {
        if(isAiSpeakingRef.current) {
          setMouthValue(Math.random() * 0.3 + 0.1);
          requestAnimationFrame(loop);
        } else {
          setMouthValue(0);
        }
      };
      requestAnimationFrame(loop);
    };
    startLipSync();

    try {
      const responseStream = await webLLMEngine.chat.completions.create({
        messages: newMessages,
        stream: true
      });

      let fullResponse = "";
      let sentenceBuffer = "";

      const speakText = (text) => {
        return new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      };

      for await (const chunk of responseStream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        fullResponse += delta;
        sentenceBuffer += delta;
        setAiResponseText(prev => prev + delta);

        const delimiters = ['. ', '! ', '? ', '\\n'];
        for (const delimiter of delimiters) {
          if (sentenceBuffer.includes(delimiter)) {
            const parts = sentenceBuffer.split(delimiter);
            const toSpeak = parts[0] + delimiter;
            sentenceBuffer = parts.slice(1).join(delimiter);
            
            // Clean markdown
            const cleanText = toSpeak.replace(/[*_#]/g, '').trim();
            if (cleanText) {
               speakText(cleanText);
            }
          }
        }
      }

      if (sentenceBuffer.trim()) {
        const cleanText = sentenceBuffer.replace(/[*_#]/g, '').trim();
        if (cleanText) {
          await speakText(cleanText);
        }
      }

      // Final cleanup
      const finalInterval = setInterval(() => {
        if(!window.speechSynthesis.speaking) {
          clearInterval(finalInterval);
          setIsAiSpeaking(false);
          isAiSpeakingRef.current = false;
          setMouthValue(0);
          
          setChatMessages(prev => [...prev, { role: 'assistant', content: fullResponse }]);
          const turn = { sender: 'ai', text: fullResponse.trim() };
          if (activeInterviewModeRef.current === 'thesis') {
            setThesisConversationLog(prev => [...prev, turn]);
          } else {
            setConversationLog(prev => [...prev, turn]);
          }
          
          if (!isListeningRef.current) {
            toggleListening();
          }
        }
      }, 500);

    } catch (e) {
      console.error(e);
      setAiResponseText("Local AI Error.");
      setIsAiSpeaking(false);
      isAiSpeakingRef.current = false;
    }
  };

  const startInterviewSession = async () => {
    setIsStartingInterview(true);
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
        sessionIdRef.current = data.id;
        setSessionId(data.id);
        activeInterviewModeRef.current = 'enrollment';
        setActiveTab('interview-session');

        const systemPrompt = "You are Professor Maxiel, an expert interviewer. Your sole purpose is to interview an incoming college freshman. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude when finished.";
        const initialMsgs = [{ role: 'system', content: systemPrompt }];
        setChatMessages(initialMsgs);
        
        handleLocalWebLLM("Hello! I am here and ready to begin the interview.", initialMsgs);
        
      } else {
        const errorText = await response.text();
        alert(\`Failed to start session: \${errorText}\`);
      }
    } catch (err) {
      alert(\`Network error starting interview: \${err.message}\`);
    } finally {
      setIsStartingInterview(false);
    }
  };
`;

content = content.replace(/  const startInterviewSession = async \(\) => \{[\s\S]*?(?=  const stopListening = \(\) => \{)/, webllmHelper);

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
