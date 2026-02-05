import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(exec);

const TRANSCRIPTION_PATH = '/Users/victoralmeidaj16/.gemini/antigravity/brain/7d5c77d0-5fb3-4163-986e-5acab9fd8fe1/transcription.md'; // Path provided by user
const VIDEO_PATH = '/Users/victoralmeidaj16/Downloads/mitos_e_verdades_sobre_a_tcc (360p).mp4'; // Path provided by user
const OUTPUT_PATH = path.join(process.cwd(), 'clipped_video.mp4');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
    console.log('Reading transcription...');
    if (!fs.existsSync(TRANSCRIPTION_PATH)) {
        console.error(`Transcription file not found at: ${TRANSCRIPTION_PATH}`);
        process.exit(1);
    }
    const transcription = fs.readFileSync(TRANSCRIPTION_PATH, 'utf-8');

    console.log('Analyzing transcription with OpenAI...');

    const prompt = `
    You are an expert video editor. I have a transcription of a video about "Mitos e Verdades sobre a TCC" (Cognitive Behavioral Therapy).
    
    Please identify the MOST engaging, interesting, and standalone 30 to 60 second segment from this text. 
    Ideally, it should debunk a common myth or explain a powerful concept clearly.
    
    The transcription format has timestamps like [00:00:07 - 00:00:23].
    
    Return ONLY a JSON object with the following structure:
    {
        "start_time": "HH:MM:SS",
        "duration": "SS",
        "reason": "Short explanation of why this part was chosen"
    }
    
    Ensure the start_time matches one of the timestamps in the text or is close to it, and the duration keeps the clip between 30 and 60 seconds.
    
    TRANSCRIPTION:
    ${transcription.substring(0, 15000)} // Truncating to avoid token limits if necessary, though this file seems small enough.
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: prompt }],
            model: 'gpt-4o',
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (!content) {
            throw new Error('No content returned from OpenAI');
        }

        const result = JSON.parse(content);
        console.log('OpenAI Recommendation:', result);

        const { start_time, duration } = result;

        console.log(`Clipping video from ${start_time} for ${duration} seconds...`);

        // FFmpeg command
        // -ss seeks to start time
        // -t specifies duration
        // -c copy streams exactly (fast, no re-encoding)
        const command = `ffmpeg -y -i "${VIDEO_PATH}" -ss ${start_time} -t ${duration} -c copy "${OUTPUT_PATH}"`;

        console.log(`Running command: ${command}`);
        const { stdout, stderr } = await execAsync(command);

        console.log('Video clipped successfully!');
        console.log(`Output saved to: ${OUTPUT_PATH}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

main();
