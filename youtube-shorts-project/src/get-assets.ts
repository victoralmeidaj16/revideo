require('dotenv').config();

import { getVideoScript, generateAudio, getWordTimestamps, minimaxGenerate, klingGenerate, klingBatchGenerate, geminiGenerate, getImagePromptFromScript, generateProVideoPrompts, generateProImagePrompts, generateVideoPrompt, generateEndFramePrompt, generateProgressivePrompt, generateStoryboardPrompts, KlingConfig, DEFAULT_KLING_CONFIG } from './utils';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

import brands from './brands.json';
import { Brand } from './types';

export async function createAssets(script: string, voiceName: string, customPrompts?: string[], referenceImageUrl?: string, isVideoMode: boolean = true, klingConfig: KlingConfig = DEFAULT_KLING_CONFIG, brandId?: string, existingImages?: string[]) {
    console.log(`[createAssets] Called with isVideoMode: ${isVideoMode}, brandId: ${brandId}, existingImages: ${existingImages ? existingImages.length : 0}`);
    const jobId = uuidv4();

    // Resolve Brand
    let brand: Brand | undefined;
    if (brandId) {
        brand = brands.find((b: any) => b.id === brandId) as Brand | undefined;
        if (brand) {
            console.log(`[createAssets] Using Brand: ${brand.name} (${brand.id})`);
        } else {
            console.warn(`[createAssets] Brand ID ${brandId} not found.`);
        }
    }

    console.log("Generating assets for provided script...")
    console.log("script", script);
    if (referenceImageUrl) {
        console.log("Using reference image:", referenceImageUrl);
    }

    await generateAudio(script, voiceName, `./public/${jobId}-audio.wav`);
    const words = await getWordTimestamps(`./public/${jobId}-audio.wav`);

    console.log(`Generating ${isVideoMode ? 'videos' : 'images'}...`);

    // ===== AI DIRECTOR STORYBOARDING WORKFLOW =====
    console.log('[AI Director] Generating 6 storyboarded scenes for cinematic narrative...');
    let imagePrompts: string[] = [];

    let imagePaths: string[] = [];
    let imagePromptsGenerated: string[] = [];

    if (existingImages && existingImages.length === 6) {
        console.log('[AI Director] Reuse existing 6 images provided by client. Skipping generation.');
        // Map web paths (e.g. /image.png) back to local paths (./public/image.png) if needed, 
        // or just assume they are local paths if they start with ./public
        // The frontend sends web paths: /01cdfabb...image-0.png

        imagePaths = existingImages.map(img => {
            if (img.startsWith('http')) return img; // Remote URL (not supported for video gen yet usually)
            if (img.startsWith('/')) return `./public${img}`;
            return img;
        });

        // We might not have prompts if reusing images, but we need them for Video Generation (Kling)
        // If prompts are lost, we might need to regenerate them or ask the user to pass them too.
        // For now, if we reuse images, we'll try to use customPrompts if available, 
        // or regenerate prompts based on script just for the video description (but not generate images).

        if (customPrompts && customPrompts.length === 6) {
            imagePromptsGenerated = customPrompts;
        } else {
            // Regenerate prompts just for context (Video Gen needs them)
            // We can't easily reverse engineer prompts from images without VLM.
            // So we re-run the prompt generation from script strictly for metadata/video prompting.
            console.log('[AI Director] Regenerating prompts for Video Context only (images are reused)...');

            // ... (Reuse logic from below)
            const brandContext = brand ? {
                name: brand.name,
                niche: brand.niche,
                description: brand.description || undefined,
                colors: `Primary: ${brand.theme.primaryColor}, Secondary: ${brand.theme.secondaryColor}, Accent: ${brand.theme.accentColor}, Background: ${brand.theme.backgroundColor}`
            } : undefined;
            imagePromptsGenerated = await generateStoryboardPrompts(script, brandContext);
        }

    } else {
        // ... STANDARD GENERATION FLOW ...
        // PHASE 1: Generate 6 scene prompts in a single AI Director call
        console.log('[AI Director] Phase 1: Generating storyboarded scene prompts...');

        if (customPrompts && customPrompts.length === 6) {
            imagePromptsGenerated = customPrompts;
            console.log('[AI Director] Using 6 custom prompts provided by user.');
        } else {
            // Build brand context for the AI Director
            const brandContext = brand ? {
                name: brand.name,
                niche: brand.niche,
                description: brand.description || undefined,
                colors: `Primary: ${brand.theme.primaryColor}, Secondary: ${brand.theme.secondaryColor}, Accent: ${brand.theme.accentColor}, Background: ${brand.theme.backgroundColor}`
            } : undefined;

            imagePromptsGenerated = await generateStoryboardPrompts(script, brandContext);
            console.log(`[AI Director] Generated ${imagePromptsGenerated.length} storyboarded prompts.`);
        }

        console.log('[AI Director] Phase 2: Generating 6 images in parallel from storyboard...');
        const imageGenStart = Date.now();

        // Build a color enforcement suffix so Gemini respects brand colors
        const colorSuffix = brand
            ? `. MANDATORY COLOR PALETTE: Use these exact colors throughout the image — Primary: ${brand.theme.primaryColor}, Secondary: ${brand.theme.secondaryColor}, Accent: ${brand.theme.accentColor}, Background: ${brand.theme.backgroundColor}, Text elements: ${brand.theme.textColor}. The dominant tones MUST be ${brand.theme.primaryColor} and ${brand.theme.secondaryColor}. Dark background: ${brand.theme.backgroundColor}. Do NOT use colors outside this palette.`
            : '';

        imagePaths = await Promise.all(
            imagePromptsGenerated.map(async (prompt, i) => {
                const path = `./public/${jobId}-image-${i}.png`;
                const enhancedPrompt = prompt + colorSuffix;
                console.log(`[AI Director] Image ${i} prompt (${enhancedPrompt.length} chars): ${enhancedPrompt.substring(0, 120)}...`);
                await geminiGenerate(enhancedPrompt, path, referenceImageUrl);
                return path;
            })
        );

        const imageGenDuration = Date.now() - imageGenStart;
        console.log(`[Performance] All 6 images generated in ${imageGenDuration}ms (${(imageGenDuration / 1000).toFixed(1)}s)`);
    }

    // Assign back to imagePrompts for the rest of the function
    imagePrompts = imagePromptsGenerated;

    let finalMediaAssets: string[] = [];
    const videoPaths: string[] = [];

    // PHASE 3: Conditionally Generate Videos
    if (isVideoMode) {
        console.log('[AI Director] Phase 3: Creating video tasks from storyboarded scenes (Standard Mode)...');
        const videoTasks = [];

        // Generate a video for EACH image (0 to 5) -> 6 videos
        for (let i = 0; i < imagePaths.length; i++) {
            const startPath = imagePaths[i];
            // No endPath needed for Standard Mode / Single Image

            const videoPrompt = await generateVideoPrompt(
                imagePrompts[i], // scene description (using prompt itself)
                imagePrompts[i]  // start frame prompt
                // No end frame prompt
            );

            const videoPath = `./public/${jobId}-video-${i}.mp4`;
            videoTasks.push({
                videoPrompt,
                startPath,
                // endPath: undefined, // Explicitly undefined triggers Standard mode logic in internal handler
                savePath: videoPath
            });
            videoPaths.push(`/${jobId}-video-${i}.mp4`); // Web path

            console.log(`Video ${i} task created for: ${startPath}`);
        }

        // PHASE 4: Batch generate all videos in parallel
        console.log(`[AI Director] Phase 4: Batch generating all ${videoTasks.length} videos in parallel with model=${klingConfig.model}, mode=${klingConfig.mode}...`);
        await klingBatchGenerate(videoTasks, klingConfig);

        finalMediaAssets = videoPaths;
    } else {
        console.log('[AI Director] Video generation skipped (Static Mode). Using 6 storyboarded images.');
        // In static mode, we use the 6 images directly
        finalMediaAssets = imagePaths.map(p => p.replace('./public', ''));
    }

    // PHASE 5: Save Metadata AND Mixed Media Data
    const metadata = {
        audioUrl: `${jobId}-audio.wav`,
        mediaAssets: finalMediaAssets,
        isVideoMode: isVideoMode,
        videos: videoPaths,
        images: imagePaths.map(p => p.replace('./public', '')),
        words: words
    };

    // Construct MixedMediaData for Revideo Scene
    // Estimate duration from words or default to 30s
    const lastWord = words[words.length - 1];
    const totalDuration = lastWord ? lastWord.end : 30;

    // Create segments distributed over duration
    const numSegments = finalMediaAssets.length;
    const segmentDuration = totalDuration / (numSegments || 1);

    const segments = finalMediaAssets.map((asset, index) => ({
        type: isVideoMode ? 'AI_VIDEO' : 'AI_IMAGE', // Use AI_VIDEO for videos
        src: asset.startsWith('/') ? asset : `/${asset}`,
        duration: segmentDuration,
        prompt: `Segment ${index}`
    }));

    // Comments below are kept for reference — scene rendering now supports AI_VIDEO via mixed-media-scene.tsx update.

    const mixedMediaData = {
        startTime: "00:00:00",
        totalDuration: totalDuration,
        sourceVideo: "", // No base video, we are building fully from generated assets?
        extractedAudio: `/${jobId}-audio.wav`,
        words: words,
        segments: segments,
        theme: brand ? brand.theme : undefined // Inject theme into mixedMediaData
    };

    await fs.promises.writeFile(`./public/${jobId}-metadata.json`, JSON.stringify(metadata, null, 2));
    await fs.promises.writeFile(`./src/metadata.json`, JSON.stringify(metadata, null, 2));
    await fs.promises.writeFile(`./public/metadata.json`, JSON.stringify(metadata, null, 2));

    // Write mixed-media-data.json for Revideo
    await fs.promises.writeFile(`./src/mixed-media-data.json`, JSON.stringify(mixedMediaData, null, 2));
    await fs.promises.writeFile(`./public/mixed-media-data.json`, JSON.stringify(mixedMediaData, null, 2));
}