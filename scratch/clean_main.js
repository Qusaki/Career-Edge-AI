const fs = require('fs');
let content = fs.readFileSync('backend/main.py', 'utf-8');

// Remove gemini import
content = content.replace("    gemini,\n", "");

// Remove gemini router
content = content.replace("app.include_router(gemini.router, prefix=\"/gemini\", tags=[\"Gemini\"])\n", "");

fs.writeFileSync('backend/main.py', content);
console.log("main.py updated");
