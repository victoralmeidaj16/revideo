import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { geminiGenerate, extractAudioSegment, getWordTimestamps } from './utils';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Hardcoded configuration for Testing/Demo purposes
// In a real production environment, these would likely be dynamic inputs or point to a full video with audio.
const START_TIME = "00:00:00";
const DURATION_SEC = 10;
const TRANSCRIPTION_PATH = '/Users/victoralmeidaj16/.gemini/antigravity/brain/7d5c77d0-5fb3-4163-986e-5acab9fd8fe1/transcription.md';

// TEST FILES (Current setup using separate video and audio files because the test video is silent)
const SOURCE_VIDEO_FILENAME = '5fd66ba2-d015-4194-a68f-6e427d580ac6-video-0.mp4';
const SOURCE_AUDIO_FILENAME = '5fd66ba2-d015-4194-a68f-6e427d580ac6-audio.wav';
const SOURCE_VIDEO_PATH = path.join(process.cwd(), 'public', SOURCE_VIDEO_FILENAME);
const SOURCE_AUDIO_PATH = path.join(process.cwd(), 'public', SOURCE_AUDIO_FILENAME);

const OUTPUT_JSON_PATH = path.join(process.cwd(), 'public', 'mixed-media-data.json');
const SRC_JSON_PATH = path.join(process.cwd(), 'src', 'mixed-media-data.json');
const EXTRACTED_AUDIO_PATH = path.join(process.cwd(), 'public', 'mixed-media-audio.wav');

async function main() {
    console.log('Reading transcription...');
    if (!fs.existsSync(TRANSCRIPTION_PATH)) {
        console.error(`Transcription file not found at: ${TRANSCRIPTION_PATH}`);
        process.exit(1);
    }
    const transcription = fs.readFileSync(TRANSCRIPTION_PATH, 'utf-8');

    // 1. Audio Handling
    // PRODUCTION MODE:
    // If your SOURCE_VIDEO_PATH points to a video that CONTAINS audio, you should use extractAudioSegment:
    // 
    // console.log(`Extracting audio from ${START_TIME} for ${DURATION_SEC}s...`);
    // await extractAudioSegment(SOURCE_VIDEO_PATH, START_TIME, DURATION_SEC, EXTRACTED_AUDIO_PATH);

    // DEMO/TEST MODE (Simulated extraction):
    // Since the test video ('video-0.mp4') is silent, we manually copy a separate audio file ('audio.wav') 
    // to act as the "extracted" audio.
    console.log(`Using existing audio for test: ${SOURCE_AUDIO_FILENAME}`);
    try {
        if (!fs.existsSync(SOURCE_AUDIO_PATH)) {
            throw new Error(`Source audio not found at ${SOURCE_AUDIO_PATH}`);
        }
        // Copy to the expected output path
        fs.copyFileSync(SOURCE_AUDIO_PATH, EXTRACTED_AUDIO_PATH);
        console.log(`Audio ready at: ${EXTRACTED_AUDIO_PATH}`);
    } catch (err) {
        console.error("Failed to prepare audio.", err);
        return;
    }

    // 2. Transcribe the extracted audio to get accurate word timestamps
    console.log("Transcribing extracted audio for subtitles...");
    let words: any[] = [];
    try {
        words = await getWordTimestamps(EXTRACTED_AUDIO_PATH);
        console.log(`Transcription complete. Got ${words.length} words.`);
    } catch (err) {
        console.error("Failed to transcribe audio:", err);
        // Continue without subtitles if transcription fails, or return?
        // Let's continue but warn
    }

    console.log('Generating Mixed Media Storyboard with OpenAI...');

    // We strictly want to target the segment around 2:44.
    // Ideally we'd pass just that chunk, but passing a larger chunk is safer for context.

    const prompt = `
    You are an expert video editor. 
    I have a video clip that runs from ${START_TIME} for ${DURATION_SEC} seconds.
    
    The transcription context around this time is:
    ${transcription.substring(0, 5000)} 
    
    Your task is to create a "Mixed Media" sequence for this ${DURATION_SEC}-second clip.
    The sequence should alternate between showing the ORIGINAL_VIDEO (facecam) and AI_IMAGE (illustration/b-roll) to make it visually engaging.
    
    - The total duration MUST sum up to exactly ${DURATION_SEC} seconds.
    - Start with ORIGINAL_VIDEO.
    - Use "AI_IMAGE" for moments where a visual metaphor would be powerful.
    - AI Images should appear for 3 to 5 seconds.
    - Keep "ORIGINAL_VIDEO" segments for when the speaker is making a strong personal point.
    
    Return a JSON object with a "segments" array. Each segment must have:
    - "type": "ORIGINAL_VIDEO" or "AI_IMAGE"
    - "duration": number (in seconds)
    - "prompt": (Only for AI_IMAGE) A detailed prompt for an AI image generator (Flux/Midjourney style) that visualizes the concept spoken.
    - "description": Short description of why this choice was made.
    
    Example:
    {
      "segments": [
        { "type": "ORIGINAL_VIDEO", "duration": 5, "description": "Intro" },
        { "type": "AI_IMAGE", "duration": 4, "prompt": "Hyper-realistic brain glowing...", "description": "Visualizing cognitive process" },
        ...
      ]
    }
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
        console.log('Storyboard:', JSON.stringify(result, null, 2));

        const segments = result.segments;

        // Asset Generation Loop
        console.log('Generating AI Assets...');
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (segment.type === 'AI_IMAGE') {
                const imageFilename = `mixed-media-image-${i}.png`;
                const imagePath = path.join(process.cwd(), 'public', imageFilename);
                const publicPath = `/${imageFilename}`; // Path for Revideo (served from public)

                console.log(`Generating image for segment ${i}: "${segment.prompt}"...`);

                // Using gemini-3-pro-image-preview (via Imagen 3 API) as requested
                await geminiGenerate(segment.prompt, imagePath);

                segment.src = publicPath;
            }
        }

        // Save data for Revideo
        const outputData = {
            startTime: START_TIME,
            totalDuration: DURATION_SEC,
            sourceVideo: SOURCE_VIDEO_FILENAME,
            extractedAudio: "/mixed-media-audio.wav", // Path for Revideo
            words: words, // Add the specific word timestamps here
            segments: segments
        };

        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(outputData, null, 2));
        fs.writeFileSync(SRC_JSON_PATH, JSON.stringify(outputData, null, 2)); // improved: write to src for dev server
        console.log(`Mixed media data saved to: ${OUTPUT_JSON_PATH} and ${SRC_JSON_PATH}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

main();
