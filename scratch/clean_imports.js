const fs = require('fs');

let t1 = fs.readFileSync('backend/routers/thesis_interview.py', 'utf-8');
t1 = t1.replace("from core.tts import generate_tts_base64_async\n", "");
fs.writeFileSync('backend/routers/thesis_interview.py', t1);

let t2 = fs.readFileSync('backend/routers/upcoming_student_interview.py', 'utf-8');
t2 = t2.replace("from core.tts import generate_tts_base64_async\n", "");
fs.writeFileSync('backend/routers/upcoming_student_interview.py', t2);

console.log("Imports cleaned");
