const fs = require('fs');
let content = fs.readFileSync('backend/routers/thesis_interview.py', 'utf-8');

const regex = /@router\.post\("\/\{session_id\}\/upload-abstract"\)[\s\S]*?(?=@router\.websocket|\n\n)/;

const replacement = ``;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('backend/routers/thesis_interview.py', content);
    console.log("Success backend upload-abstract removed.");
} else {
    console.log("Failed to find backend upload-abstract target");
}
