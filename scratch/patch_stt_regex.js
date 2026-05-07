const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

const regex = /const activeWs = activeInterviewModeRef\.current === 'thesis' \? thesisWsRef\.current : wsRef\.current;[\s\S]*?if \(activeWs && activeWs\.readyState === WebSocket\.OPEN\) \{[\s\S]*?activeWs\.send\(JSON\.stringify\(\{ text: finalTranscript\.trim\(\), end_of_turn: true \}\)\);[\s\S]*?\}/;

const replacement = `const activeWs = activeInterviewModeRef.current === 'thesis' ? thesisWsRef.current : wsRef.current;
              setChatMessages((prev) => {
                const newMessages = [...prev, { role: 'user', content: finalTranscript.trim() }];
                setTimeout(() => handleLocalWebLLM(finalTranscript.trim(), prev), 0);
                return newMessages;
              });`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
    console.log("Success STT patched.");
} else {
    console.log("Failed to find target with regex");
}
