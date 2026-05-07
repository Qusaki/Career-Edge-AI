const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

// Fix Promise<void>
content = content.replace(
  "const speakText = (text) => {\n        return new Promise((resolve) => {\n          const utterance = new SpeechSynthesisUtterance(text);\n          utterance.onend = () => resolve();",
  "const speakText = (text: string) => {\n        return new Promise<void>((resolve) => {\n          const utterance = new SpeechSynthesisUtterance(text);\n          utterance.onend = () => resolve();"
);

// Fix sender type
content = content.replace(
  "const turn = { sender: 'ai', text: fullResponse.trim() };",
  "const turn = { sender: 'ai' as const, text: fullResponse.trim() };"
);

// Fix handleLocalWebLLM signature
content = content.replace(
  "const handleLocalWebLLM = async (userText, currentMessages) => {",
  "const handleLocalWebLLM = async (userText: string, currentMessages: any[]) => {"
);

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
console.log('Fixed TS errors');
