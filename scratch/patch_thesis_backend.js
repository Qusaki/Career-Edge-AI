const fs = require('fs');
let content = fs.readFileSync('backend/routers/thesis_interview.py', 'utf-8');

const regex = /    # Send to Ollama with JSON Schema[\s\S]*?try:\s*evaluation = json\.loads\(response\.choices\[0\]\.message\.content\)/;

const replacement = `    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")
        
    try:
        evaluation = request.evaluation`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('backend/routers/thesis_interview.py', content);
    console.log("Thesis patched");
} else {
    console.log("Thesis target not found");
}
