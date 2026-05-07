const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

// 1. Add pdfjs import
if (!content.includes('pdfjs-dist')) {
    content = content.replace("import { useWebLLM } from '../hooks/useWebLLM';", "import { useWebLLM } from '../hooks/useWebLLM';\nimport * as pdfjsLib from 'pdfjs-dist';\npdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;");
}

// 2. Modify startThesisSession
const regex = /      if \(thesisAbstractFile\) \{[\s\S]*?setThesisAbstractUploading\(false\);\n        \}\n      \}/;

const replacement = `      let abstractText = "";
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
          return;
        } finally {
          setThesisAbstractUploading(false);
        }
      }`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    // 3. Inject abstract into the prompt
    content = content.replace(
      "const systemPrompt = `You are Professor Maxiel, an expert panelist for a thesis defense at ${dep}. Probe the student's research abstract. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude gracefully when finished.`;",
      "const systemPrompt = `You are Professor Maxiel, an expert panelist for a thesis defense at ${dep}. Probe the student's research abstract. Speak DIRECTLY to the student. Keep the interview to exactly 5 questions total. Ask exactly ONE question at a time. Conclude gracefully when finished.\\n\\nStudent's Abstract/Proposal context:\\n${abstractText ? abstractText.substring(0, 5000) : 'None provided.'}`; // Truncate to 5000 chars to avoid token limits"
    );

    fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
    console.log("Success offline abstract patched.");
} else {
    console.log("Failed to find abstract target");
}
