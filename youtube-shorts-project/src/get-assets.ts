require('dotenv').config();

import { getVideoScript, generateAudio, getWordTimestamps, minimaxGenerate, klingGenerate, klingBatchGenerate, replicateGenerate, getImagePromptFromScript, generateProVideoPrompts, generateProImagePrompts, generateVideoPrompt, generateEndFramePrompt, generateProgressivePrompt } from './utils';
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

    if (isVideoMode) {
        // ===== PROGRESSIVE IMAGE WORKFLOW ===== 
        console.log('[Progressive Workflow] Generating 6 progressive images for visual continuity...');

        // PHASE 1: Generate 6 progressive prompts
        console.log('[Progressive Workflow] Phase 1: Generating 6 progressive prompts...');
        const imagePrompts: string[] = [];

        for (let i = 0; i < 6; i++) {
            if (i === 0) {
                // First prompt from custom or generated
                if (customPrompts && customPrompts[0]) {
                    imagePrompts[i] = customPrompts[0];
                    console.log(`Using custom prompt for image 0: ${imagePrompts[i]}`);
                } else {
                    imagePrompts[i] = await getImagePromptFromScript(script);
                    console.log(`Generated prompt for image 0: ${imagePrompts[i]}`);
                }
            } else {
                // Progressive prompts evolve from previous
                imagePrompts[i] = await generateProgressivePrompt(imagePrompts[i - 1], i, 5);
                console.log(`Generated progressive prompt for image ${i}: ${imagePrompts[i]}`);
            }
        }

        // PHASE 2: Generate all 6 images in parallel
        console.log('[Progressive Workflow] Phase 2: Generating 6 progressive images in parallel...');
        const imageGenStart = Date.now();

        const imagePaths = await Promise.all(
            imagePrompts.map(async (prompt, i) => {
                const path = `./public/${jobId}-image-${i}.png`;
                await replicateGenerate(prompt, path, referenceImageUrl);
                return path;
            })
        );

        const imageGenDuration = Date.now() - imageGenStart;
        console.log(`[Performance] All 6 images generated in ${imageGenDuration}ms (${(imageGenDuration / 1000).toFixed(1)}s)`);

        // PHASE 3: Create 5 video tasks using adjacent image pairs
        console.log('[Progressive Workflow] Phase 3: Creating 5 video tasks from progressive images...');
        const videoTasks = [];

        for (let i = 0; i < 5; i++) {
            const startPath = imagePaths[i];       // image-0, image-1, image-2, image-3, image-4
            const endPath = imagePaths[i + 1];     // image-1, image-2, image-3, image-4, image-5

            const videoPrompt = await generateVideoPrompt(
                imagePrompts[i],
                imagePrompts[i],
                imagePrompts[i + 1]
            );

            videoTasks.push({
                videoPrompt,
                startPath,
                endPath,
                savePath: `./public/${jobId}-video-${i}.mp4`
            });

            console.log(`Video ${i}: ${startPath} → ${endPath}`);
        }

        // PHASE 4: Batch generate all 5 videos in parallel
        console.log('[Progressive Workflow] Phase 4: Batch generating all 5 videos in parallel...');
        await klingBatchGenerate(videoTasks);

        const mediaFileNames = videoTasks.map((_, i) => `/${jobId}-video-${i}.mp4`);

        const metadata = {
            audioUrl: `${jobId}-audio.wav`,
            mediaAssets: mediaFileNames,
            isVideoMode: true,
            videos: mediaFileNames,
            images: imagePaths.map(p => p.replace('./public', '')),  // Store progressive images for reference
            words: words
        };

        await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
        await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
        await fs.promises.writeFile(`./src/metadata.json`, JSON.stringify(metadata, null, 2));
        // Also save to public/metadata.json so frontend can access it easily without knowing jobId
        await fs.promises.writeFile(`./public/metadata.json`, JSON.stringify(metadata, null, 2));

    } else {
        // Original image-only workflow (unchanged)
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

            return baseImageName;
        });

        const mediaFileNames = await Promise.all(mediaPromises);
        const metadata = {
            audioUrl: `${jobId}-audio.wav`,
            mediaAssets: mediaFileNames,
            isVideoMode: false,
            videos: [] as string[],
            images: mediaFileNames,
            words: words
        };

        await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
        await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
        await fs.promises.writeFile(`./src/metadata.json`, JSON.stringify(metadata, null, 2));
        // Also save to public/metadata.json so frontend can access it easily without knowing jobId
        await fs.promises.writeFile(`./public/metadata.json`, JSON.stringify(metadata, null, 2));
    }
}