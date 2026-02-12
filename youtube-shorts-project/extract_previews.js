
const fs = require('fs');
const voices = JSON.parse(fs.readFileSync('voices_output.json', 'utf8'));

voices.forEach(v => {
    if (v.preview_url) {
        console.log(`"${v.name}" (${v.voice_id}): ${v.preview_url}`);
    }
});
