import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { replicateGenerate } from './utils';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Hardcoded for now based on previous clip selection
const START_TIME = "00:02:44";
const DURATION_SEC = 31;
const TRANSCRIPTION_PATH = '/Users/victoralmeidaj16/.gemini/antigravity/brain/7d5c77d0-5fb3-4163-986e-5acab9fd8fe1/transcription.md';

const OUTPUT_JSON_PATH = path.join(process.cwd(), 'public', 'mixed-media-data.json');

async function main() {
    console.log('Reading transcription...');
    if (!fs.existsSync(TRANSCRIPTION_PATH)) {
        console.error(`Transcription file not found at: ${TRANSCRIPTION_PATH}`);
        process.exit(1);
    }
    const transcription = fs.readFileSync(TRANSCRIPTION_PATH, 'utf-8');

    console.log('Generating Mixed Media Storyboard with OpenAI...');

    // We strictly want to target the segment around 2:44.
    // Ideally we'd pass just that chunk, but passing a larger chunk is safer for context.

    const prompt = `
    You are an expert video editor. 
    I have a video clip that runs from ${START_TIME} for ${DURATION_SEC} seconds.
    
    The transcription context around this time is:
    ${transcription.substring(0, 15000)} 
    
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

                // Using seedream-4 as requested via replicateGenerate
                await replicateGenerate(segment.prompt, imagePath);

                segment.src = publicPath;
            }
        }

        // Save data for Revideo
        const outputData = {
            startTime: START_TIME,
            totalDuration: DURATION_SEC,
            segments: segments
        };

        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(outputData, null, 2));
        console.log(`Mixed media data saved to: ${OUTPUT_JSON_PATH}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

main();
