require('dotenv').config();

import { getVideoScript, generateAudio, getWordTimestamps, minimaxGenerate, klingGenerate, klingBatchGenerate, replicateGenerate, getImagePromptFromScript, generateProVideoPrompts, generateProImagePrompts, generateVideoPrompt, generateEndFramePrompt, generateProgressivePrompt, KlingConfig, DEFAULT_KLING_CONFIG } from './utils';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

export async function createAssets(script: string, voiceName: string, customPrompts?: string[], referenceImageUrl?: string, isVideoMode: boolean = true, klingConfig: KlingConfig = DEFAULT_KLING_CONFIG) {
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

    // ===== UNIFIED PROGRESSIVE IMAGE WORKFLOW =====
    console.log('[Progressive Workflow] Generating 6 progressive images for visual continuity...');

    // PHASE 1: Generate 6 progressive prompts (Always run this)
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

    // PHASE 2: Generate all 6 images in parallel (Always run this)
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

    let finalMediaAssets: string[] = [];
    const videoPaths: string[] = [];

    // PHASE 3: Conditionally Generate Videos
    if (isVideoMode) {
        console.log('[Progressive Workflow] Phase 3: Creating 5 video tasks from progressive images...');
        const videoTasks = [];

        for (let i = 0; i < 5; i++) {
            const startPath = imagePaths[i];       // image-0, image-1, ...
            const endPath = imagePaths[i + 1];     // image-1, image-2, ...

            const videoPrompt = await generateVideoPrompt(
                imagePrompts[i],
                imagePrompts[i],
                imagePrompts[i + 1]
            );

            const videoPath = `./public/${jobId}-video-${i}.mp4`;
            videoTasks.push({
                videoPrompt,
                startPath,
                endPath,
                savePath: videoPath
            });
            videoPaths.push(`/${jobId}-video-${i}.mp4`); // Web path

            console.log(`Video ${i}: ${startPath} → ${endPath}`);
        }

        // PHASE 4: Batch generate all 5 videos in parallel
        console.log(`[Progressive Workflow] Phase 4: Batch generating all 5 videos in parallel with model=${klingConfig.model}, mode=${klingConfig.mode}...`);
        await klingBatchGenerate(videoTasks, klingConfig);

        finalMediaAssets = videoPaths;
    } else {
        console.log('[Progressive Workflow] Video generation skipped (Static Mode). Using 6 progressive images.');
        // In static mode, we use the 6 images directly
        finalMediaAssets = imagePaths.map(p => p.replace('./public', ''));
    }

    // PHASE 5: Save Metadata
    const metadata = {
        audioUrl: `${jobId}-audio.wav`,
        mediaAssets: finalMediaAssets,
        isVideoMode: isVideoMode,
        videos: videoPaths,
        images: imagePaths.map(p => p.replace('./public', '')),
        words: words
    };

    await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
    await fs.promises.writeFile(`./src/metadata.json`, JSON.stringify(metadata, null, 2));
    // Also save to public/metadata.json so frontend can access it easily without knowing jobId
    await fs.promises.writeFile(`./public/metadata.json`, JSON.stringify(metadata, null, 2));
}