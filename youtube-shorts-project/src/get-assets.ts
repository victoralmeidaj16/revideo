require('dotenv').config();

import { getVideoScript, generateAudio, getWordTimestamps, minimaxGenerate, replicateGenerate, getImagePromptFromScript, generateProVideoPrompts, generateProImagePrompts } from './utils';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

export async function createAssets(script: string, voiceName: string, customPrompts?: string[], referenceImageUrl?: string, isVideoMode: boolean = true) {
    console.log(`[createAssets] Called with isVideoMode: ${isVideoMode}`);
    const jobId = uuidv4();

    console.log("Generating assets for provided script...")
    console.log("script", script);
    if (referenceImageUrl) {
        console.log("Using reference image:", referenceImageUrl);
    }

    await generateAudio(script, voiceName, `./public/${jobId}-audio.wav`);
    const words = await getWordTimestamps(`./public/${jobId}-audio.wav`);

    console.log(`Generating ${isVideoMode ? 'videos' : 'images'}...`);
    const mediaPromises = Array.from({ length: 5 }).map(async (_, index) => {
        let mediaPrompt: string;
        if (customPrompts && customPrompts[index]) {
            mediaPrompt = customPrompts[index];
            console.log(`Using custom prompt for media ${index}: ${mediaPrompt}`);
        } else {
            mediaPrompt = await getImagePromptFromScript(script);
            console.log(`Generated basic prompt for media ${index}: ${mediaPrompt}`);
        }

        const baseImageName = `/${jobId}-base-image-${index}.png`;
        const baseImagePath = `./public${baseImageName}`;

        console.log(`Generating base image ${index} with Replicate...`);
        await replicateGenerate(mediaPrompt, baseImagePath, referenceImageUrl);

        let finalFileName = baseImageName;

        if (isVideoMode) {
            const videoName = `/${jobId}-video-${index}.mp4`;
            const videoPath = `./public${videoName}`;
            console.log(`Animating image ${index} with Minimax...`);
            const animationPrompt = `${mediaPrompt}. Cinematic motion, slow camera pan, energetic movement, 4k resolution, high quality.`;
            await minimaxGenerate(animationPrompt, videoPath, baseImagePath);
            finalFileName = videoName;
        }

        return finalFileName;
    });

    const mediaFileNames = await Promise.all(mediaPromises);
    const metadata = {
        audioUrl: `${jobId}-audio.wav`,
        mediaAssets: mediaFileNames,
        isVideoMode: isVideoMode,
        videos: isVideoMode ? mediaFileNames : [],
        images: !isVideoMode ? mediaFileNames : [],
        words: words
    };

    await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
    await fs.promises.writeFile(`./src/metadata.json`, JSON.stringify(metadata, null, 2));
}