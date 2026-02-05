
import 'dotenv/config';
import OpenAI from 'openai/index.mjs';
import axios from 'axios';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { AssemblyAI } from 'assemblyai';
import Replicate from 'replicate';
import jwt from 'jsonwebtoken';

const client = new AssemblyAI({
	apiKey: process.env["ASSEMBLYAI_API_KEY"] || "",
});

const openai = new OpenAI({
	apiKey: process.env['OPENAI_API_KEY'],
});

export async function getWordTimestamps(audioFilePath: string) {
	console.log("AssemblyAI Key Length:", (process.env["ASSEMBLYAI_API_KEY"] || "").length);
	const audioBuffer = await fs.promises.readFile(audioFilePath);
	const uploadUrl = await client.files.upload(audioBuffer);

	const transcript = await client.transcripts.transcribe({
		audio_url: uploadUrl,
		language_code: "pt"
	});

	if (transcript.words) {
		return transcript.words.map((word) => ({
			punctuated_word: word.text,
			start: word.start / 1000,
			end: word.end / 1000
		}));
	} else {
		throw Error("transcription result is null");
	}
}

export async function generateAudio(text: string, voiceName: string, savePath: string) {
	const data = {
		model_id: "eleven_multilingual_v2",
		text: text,
	};

	const voiceId = await getVoiceByName(voiceName);

	const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, data, {
		headers: {
			"Content-Type": "application/json",
			"xi-api-key": process.env.ELEVEN_API_KEY || "",
		},
		responseType: "arraybuffer",
	});

	fs.writeFileSync(savePath, response.data);
}

async function getVoiceByName(name: string) {
	const response = await fetch("https://api.elevenlabs.io/v1/voices", {
		method: "GET",
		headers: {
			"xi-api-key": process.env.ELEVEN_API_KEY || "",
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data: any = await response.json();
	const voice = data.voices.find((voice: { name: string; voice_id: string }) => voice.name.includes(name));
	return voice ? voice.voice_id : null;
}

export async function getVideoScript(videoTopic: string) {
	const prompt = `Create a script for a youtube short. The script should be around 60 to 80 words long and be an interesting text about the provided topic, and it should start with a catchy headline, something like "Did you know that?" or "This will blow your mind". Remember that this is for a voiceover that should be read, so things like hashtags should not be included. Now write the script for the following topic: "${videoTopic}". IMPORTANT: WRITE THE SCRIPT IN PORTUGUESE (BRAZIL). Now return the script and nothing else, also no meta-information - ONLY THE VOICEOVER.`;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
	});

	const result = chatCompletion.choices[0].message.content;

	if (result) {
		return result;
	} else {
		throw Error("returned text is null");
	}

}

export async function getImagePromptFromScript(script: string) {
	const prompt = `My goal is to create a Youtube Short based on the following script. To create a background image for the video, I am using a text-to-video AI model. Please write a short (not longer than a single sentence), suitable prompt for such a model based on this script: ${script}.\n\nNow return the prompt and nothing else.`;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
		temperature: 1.0 // high temperature for "creativeness"
	});

	const result = chatCompletion.choices[0].message.content;

	if (result) {
		return result;
	} else {
		throw Error("returned text is null");
	}

}

export async function dalleGenerate(prompt: string, savePath: string) {
	const response = await openai.images.generate({
		model: "dall-e-3",
		prompt: prompt,
		size: "1024x1792",
		quality: "standard",
		n: 1,
	});

	if (!response.data || !response.data[0]) {
		throw new Error("No image generated");
	}

	const url = response.data[0].url;
	const responseImage = await axios.get(url || "", {
		responseType: "arraybuffer",
	});
	const buffer = Buffer.from(responseImage.data, "binary");

	try {
		await fs.promises.writeFile(savePath, buffer);
	} catch (error) {
		console.error("Error saving the file:", error);
		throw error; // Rethrow the error so it can be handled by the caller
	}
}



export async function replicateGenerate(prompt: string, savePath: string, referenceImageUrl?: string) {
	const replicate = new Replicate({
		auth: process.env.REPLICATE_API_TOKEN,
	});

	// Build input object - conditionally add reference image for image-to-image
	const inputParams: any = {
		prompt: prompt,
		negative_prompt: "nude, naked, nsfw, text, watermark, bad anatomy, bad hands, blurry, low quality",
		width: 1024,
		height: 1792,
		num_outputs: 1
	};

	// If reference image is provided, add it for image-to-image generation
	if (referenceImageUrl) {
		inputParams.image = referenceImageUrl;
		inputParams.image_prompt_strength = 0.35; // Moderate influence from reference
		console.log(`Using reference image for generation: ${referenceImageUrl}`);
	}

	const output = await replicate.run(
		"bytedance/seedream-4:cf7d431991436f19d1c8dad83fe463c729c816d7a21056c5105e75c84a0aa7e9",
		{
			input: inputParams
		}
	);

	if (!output) {
		throw new Error("No output from Replicate");
	}

	// Replicate returns an array of URLs (or a single URL depending on model, usually array)
	// Cast to any to handle type simply
	const url = Array.isArray(output) ? output[0] : output;

	// Fetch and save
	const responseImage = await axios.get(url, { responseType: "arraybuffer" });
	const buffer = Buffer.from(responseImage.data, "binary");
	await fs.promises.writeFile(savePath, buffer);
}

export async function minimaxGenerate(prompt: string, savePath: string, imagePath?: string) {
	const replicate = new Replicate({
		auth: process.env.REPLICATE_API_TOKEN,
	});

	console.log(`Generating video with Minimax for prompt: ${prompt}`);
	if (imagePath) {
		console.log(`Using input image for animation: ${imagePath}`);
	}

	const inputParams: any = {
		prompt: prompt,
		prompt_optimizer: true
	};

	if (imagePath) {
		inputParams.first_frame_image = fs.createReadStream(imagePath);
	}

	const output = await replicate.run(
		"minimax/video-01",
		{
			input: inputParams
		}
	);

	if (!output) {
		throw new Error("No output from Replicate (Minimax)");
	}

	// Minimax on Replicate usually returns a direct string URL (or a stream, usually string URL) or an array of [url]
	console.log("Minimax raw output:", output);

	// Cast to any to handle type simply
	const url = Array.isArray(output) ? output[0] : String(output);
	console.log("Minimax Video URL:", url);

	const responseVideo = await axios.get(url, { responseType: "arraybuffer" });
	const buffer = Buffer.from(responseVideo.data, "binary");
	await fs.promises.writeFile(savePath, buffer);
}

export async function generateProVideoPrompts(script: string, topic: string) {
	const prompt = `
    You are an expert AI Cinematographer specializing in high-end commercial video production.
    
    Your task is to create 5 distinct, sequential VIDEO prompts to accompany a video script about "${topic}".
    
    The script is: "${script}".
    
    Break the script into 5 chronological scenes. For EACH scene, write a prompt following this EXACT style structure, focusing on MOTION and VISUALS:

    "A cinematic vertical video shot (Ratio 9:16) in 4k resolution. [describe environment and lighting]. Camera movement is [describe motion, e.g., slow pan, drone shot, dolly in]. The action shows [describe subject and specific movement]. High production value, hyper-realistic, detailed textures."

    Return ONLY a valid JSON array of strings, for example: ["Prompt 1...", "Prompt 2...", ...]. Do not include markdown code block notation.
    `;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
	});

	const content = chatCompletion.choices[0].message.content || "[]";
	try {
		// Remove markdown if present (e.g. ```json ... ```)
		const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
		return JSON.parse(cleanContent);
	} catch (e) {
		console.error("Failed to parse pro prompts:", content);
		return [];
	}
}

export async function generateProImagePrompts(script: string, topic: string) {
	const prompt = `
    You are an expert AI Art Director specializing in hyper-realistic, high-end commercial photography.
    
    Your task is to create 5 distinct, sequential image prompts to accompany a video script about "${topic}".
    
    The script is: "${script}".
    
    Break the script into 5 chronological scenes. For EACH scene, write a prompt following this EXACT style structure, but adapting the subject to the scene:

    "A hyper-realistic vertical lifestyle photo (Ratio 4:5, 1080×1350) shot with directional soft light in a [describe environment]. Captured on a high-end mirrorless camera with a 50 mm lens at f/2.0. The camera is positioned in [describe angle], creating a subtle sense of protagonists and confidence. The subject is [describe subject and action detailed]."

    Return ONLY a valid JSON array of strings, for example: ["Prompt 1...", "Prompt 2...", ...]. Do not include markdown code block notation.
    `;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
	});

	const content = chatCompletion.choices[0].message.content || "[]";
	try {
		// Remove markdown if present (e.g. ```json ... ```)
		const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
		return JSON.parse(cleanContent);
	} catch (e) {
		console.error("Failed to parse pro prompts:", content);
		return [];
	}
}

// ============================================
// Retry Logic with Exponential Backoff
// ============================================

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	maxRetries: number = 3,
	baseDelay: number = 1000,
	operationName: string = 'operation'
): Promise<T> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			console.log(`[${operationName}] Attempt ${attempt + 1}/${maxRetries}`);
			return await fn();
		} catch (error: any) {
			const isLastAttempt = attempt === maxRetries - 1;

			if (isLastAttempt) {
				console.error(`[${operationName}] Failed after ${maxRetries} attempts`);
				throw error;
			}

			const delay = baseDelay * Math.pow(2, attempt);
			console.warn(
				`[${operationName}] Attempt ${attempt + 1} failed: ${error.message}. ` +
				`Retrying in ${delay}ms...`
			);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	throw new Error('Unreachable');
}

// ============================================
// Kling AI Video Generation Functions
// ============================================

/**
 * Configuration options for Kling AI video generation
 */
export interface KlingConfig {
	model: 'kling-v1' | 'kling-v1-5';  // v1 = standard, v1-5 = improved quality
	mode: 'std' | 'pro';               // std = standard speed, pro = higher quality but slower
}

/**
 * Default Kling configuration
 */
export const DEFAULT_KLING_CONFIG: KlingConfig = {
	model: 'kling-v1',
	mode: 'std'
};

function stripDataUrlPrefix(value: string): string {
	// Accept either raw base64 or a full data URL (data:image/...;base64,XXXX)
	const base64Index = value.indexOf('base64,');
	if (base64Index !== -1) {
		return value.slice(base64Index + 'base64,'.length);
	}
	return value;
}

function sanitizeBase64(value: string): string {
	// Kling expects raw base64 (no data: prefix) and no whitespace/newlines.
	return stripDataUrlPrefix(value).replace(/\s+/g, '');
}

function formatAxiosError(error: any, context: string): Error {
	if (!axios.isAxiosError(error)) return error instanceof Error ? error : new Error(String(error));
	const status = error.response?.status;
	const data = error.response?.data as any;
	const details =
		data?.message ? `${data.message}${data?.code ? ` (code ${data.code})` : ''}` : error.message;
	const requestId = data?.request_id ? ` request_id=${data.request_id}` : '';
	return new Error(`[${context}] HTTP ${status ?? 'unknown'}: ${details}.${requestId}`.trim());
}


/**
 * Generate a JWT token for Kling API authentication
 */
function generateKlingToken(accessKey: string, secretKey: string): string {
	const payload = {
		iss: accessKey,
		exp: Math.floor(Date.now() / 1000) + 1800, // Token valid for 30 minutes
		nbf: Math.floor(Date.now() / 1000) - 5     // Valid from 5 seconds ago
	};

	return jwt.sign(payload, secretKey, {
		algorithm: 'HS256',
		header: {
			alg: 'HS256',
			typ: 'JWT'
		}
	});
}


/**
 * Submit a Kling video generation task (without polling)
 */
async function klingSubmitTaskInternal(
	videoPrompt: string,
	startImagePath: string,
	endImagePath: string,
	config: KlingConfig = DEFAULT_KLING_CONFIG
): Promise<string> {
	const accessKey = process.env.KLING_ACCESS_KEY;
	const secretKey = process.env.KLING_SECRET_KEY;

	if (!accessKey || !secretKey) {
		throw new Error('Kling API credentials not found in environment variables');
	}

	// Convert images to base64
	const startImageBase64 = sanitizeBase64(await fs.promises.readFile(startImagePath, { encoding: 'base64' }));
	const endImageBase64 = sanitizeBase64(await fs.promises.readFile(endImagePath, { encoding: 'base64' }));

	// Prepare request payload
	const payload = {
		model_name: config.model,
		// Kling expects raw base64, not a data URL.
		image: startImageBase64,
		image_tail: endImageBase64,
		prompt: videoPrompt,
		duration: 5,
		aspect_ratio: "9:16",
		cfg_scale: 0.5,
		mode: config.mode
	};

	console.log(`[Kling] Submitting video generation task...`);
	let createResponse;
	try {
		createResponse = await axios.post(
			'https://api.klingai.com/v1/videos/image2video',
			payload,
			{
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${generateKlingToken(accessKey, secretKey)}`
				}
			}
		);
	} catch (error) {
		throw formatAxiosError(error, 'Kling submit');
	}

	const taskId = createResponse.data.data?.task_id;
	if (!taskId) {
		throw new Error('No task_id returned from Kling API');
	}

	console.log(`[Kling] Task submitted: ${taskId}`);
	return taskId;
}

/**
 * Poll a Kling task until completion and download the video
 */
async function klingPollTaskInternal(taskId: string, savePath: string): Promise<void> {
	const accessKey = process.env.KLING_ACCESS_KEY;
	const secretKey = process.env.KLING_SECRET_KEY;

	let completed = false;
	let videoUrl = '';
	const maxAttempts = 60; // 5 minutes max
	let attempts = 0;

	console.log(`[Kling] Starting polling for task ${taskId}...`);

	while (!completed && attempts < maxAttempts) {
		await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
		attempts++;

		let statusResponse;
		try {
			statusResponse = await axios.get(
				`https://api.klingai.com/v1/videos/image2video/${taskId}`,
				{
					headers: {
						'Authorization': `Bearer ${generateKlingToken(accessKey, secretKey)}`
					}
				}
			);
		} catch (error) {
			throw formatAxiosError(error, `Kling poll ${taskId}`);
		}

		const status = statusResponse.data.data?.task_status;
		console.log(`[Kling] Task ${taskId} status: ${status} (${attempts}/${maxAttempts})`);

		if (status === 'succeed') {
			completed = true;
			const works = statusResponse.data.data?.task_result?.works;
			if (works && works.length > 0) {
				videoUrl = works[0].resource.resource;
			}
		} else if (status === 'failed') {
			throw new Error(`Kling video generation failed: ${statusResponse.data.data?.task_status_msg || 'Unknown error'}`);
		}
	}

	if (!videoUrl) {
		throw new Error('Video generation timed out or no video URL returned');
	}

	console.log(`[Kling] Video ready, downloading: ${videoUrl}`);
	const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
	const buffer = Buffer.from(videoResponse.data, 'binary');
	await fs.promises.writeFile(savePath, buffer);
	console.log(`[Kling] Video saved to: ${savePath}`);
}

/**
 * Submit a Kling task with retry logic
 */
export async function klingSubmitTask(
	videoPrompt: string,
	startImagePath: string,
	endImagePath: string,
	config: KlingConfig = DEFAULT_KLING_CONFIG
): Promise<string> {
	return retryWithBackoff(
		() => klingSubmitTaskInternal(videoPrompt, startImagePath, endImagePath, config),
		3,
		2000,
		'Kling Task Submission'
	);
}

/**
 * Poll a Kling task with retry logic
 */
export async function klingPollTask(taskId: string, savePath: string): Promise<void> {
	return retryWithBackoff(
		() => klingPollTaskInternal(taskId, savePath),
		2,
		3000,
		`Kling Task Polling (${taskId})`
	);
}

/**
 * Batch generate multiple Kling videos in parallel
 */
export async function klingBatchGenerate(
	tasks: Array<{
		videoPrompt: string;
		startPath: string;
		endPath: string;
		savePath: string;
	}>,
	config: KlingConfig = DEFAULT_KLING_CONFIG
): Promise<void> {
	console.log(`[Kling Batch] Starting batch generation of ${tasks.length} videos (model: ${config.model}, mode: ${config.mode})...`);
	const batchStartTime = Date.now();

	// Step 1: Submit all tasks in parallel
	console.log(`[Kling Batch] Submitting ${tasks.length} tasks...`);
	const taskIds = await Promise.all(
		tasks.map(t => klingSubmitTask(t.videoPrompt, t.startPath, t.endPath, config))
	);
	console.log(`[Kling Batch] All ${tasks.length} tasks submitted successfully`);

	// Step 2: Poll all tasks in parallel
	console.log(`[Kling Batch] Polling ${tasks.length} tasks in parallel...`);
	await Promise.all(
		taskIds.map((id, i) => klingPollTask(id, tasks[i].savePath))
	);

	const batchDuration = Date.now() - batchStartTime;
	console.log(`[Kling Batch] All ${tasks.length} videos completed in ${batchDuration}ms (${(batchDuration / 1000 / 60).toFixed(1)}min)`);
}

/**
 * Generate a video using Kling AI's image-to-video with start and end frames
 * (Original single-video function, now uses batch internally for consistency)
 */
export async function klingGenerate(
	videoPrompt: string,
	startImagePath: string,
	endImagePath: string,
	savePath: string
): Promise<void> {
	await klingBatchGenerate([{
		videoPrompt,
		startPath: startImagePath,
		endPath: endImagePath,
		savePath
	}]);
}

// Internal implementation moved above
async function klingGenerateInternal(
	videoPrompt: string,
	startImagePath: string,
	endImagePath: string,
	savePath: string
): Promise<void> {
	console.log(`Generating video with Kling AI...`);
	console.log(`Start frame: ${startImagePath}`);
	console.log(`End frame: ${endImagePath}`);
	console.log(`Video prompt: ${videoPrompt}`);

	const accessKey = process.env.KLING_ACCESS_KEY;
	const secretKey = process.env.KLING_SECRET_KEY;

	if (!accessKey || !secretKey) {
		throw new Error('Kling API credentials not found in environment variables');
	}

	// Convert images to base64
	const startImageBase64 = sanitizeBase64(await fs.promises.readFile(startImagePath, { encoding: 'base64' }));
	const endImageBase64 = sanitizeBase64(await fs.promises.readFile(endImagePath, { encoding: 'base64' }));

	// Prepare request payload for Kling API
	const payload = {
		model_name: "kling-v1",  // or latest available model
		image: startImageBase64,
		image_tail: endImageBase64,
		prompt: videoPrompt,
		duration: 5,  // 5 seconds for faster generation, can be 10
		aspect_ratio: "9:16",  // YouTube Shorts format
		cfg_scale: 0.5,
		mode: "std"  // standard mode
	};

	try {
		// Step 1: Submit video generation task
		const createResponse = await axios.post(
			'https://api.klingai.com/v1/videos/image2video',
			payload,
			{
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${accessKey}:${secretKey}`
				}
			}
		);

		const taskId = createResponse.data.data?.task_id;
		if (!taskId) {
			throw new Error('No task_id returned from Kling API');
		}

		console.log(`Kling video generation task created: ${taskId}`);

		// Step 2: Poll for completion
		let completed = false;
		let videoUrl = '';
		const maxAttempts = 60; // 5 minutes max (5s intervals)
		let attempts = 0;

		while (!completed && attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
			attempts++;

			const statusResponse = await axios.get(
				`https://api.klingai.com/v1/videos/image2video/${taskId}`,
				{
					headers: {
						'Authorization': `Bearer ${accessKey}:${secretKey}`
					}
				}
			);

			const status = statusResponse.data.data?.task_status;
			console.log(`Kling task ${taskId} status: ${status} (attempt ${attempts}/${maxAttempts})`);

			if (status === 'succeed') {
				completed = true;
				const works = statusResponse.data.data?.task_result?.works;
				if (works && works.length > 0) {
					videoUrl = works[0].resource.resource;
				}
			} else if (status === 'failed') {
				throw new Error(`Kling video generation failed: ${statusResponse.data.data?.task_status_msg || 'Unknown error'}`);
			}
		}

		if (!videoUrl) {
			throw new Error('Video generation timed out or no video URL returned');
		}

		console.log(`Kling video ready: ${videoUrl}`);

		// Step 3: Download the video
		const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
		const buffer = Buffer.from(videoResponse.data, 'binary');
		await fs.promises.writeFile(savePath, buffer);

		console.log(`Kling video saved to: ${savePath}`);
	} catch (error: any) {
		console.error('Kling API error:', error.response?.data || error.message);
		throw error;
	}
}

/**
 * Generate an optimized video prompt describing camera movement and scene transition
 */
export async function generateVideoPrompt(
	sceneDescription: string,
	startImagePrompt: string,
	endImagePrompt: string
): Promise<string> {
	const prompt = `
    You are an expert AI video director specializing in image-to-video generation.
    
    Given a scene description and two image prompts (start and end frames), create a SHORT, CONCISE video prompt that describes the motion, camera movement, and transition.
    
    Scene context: "${sceneDescription}"
    Start frame: "${startImagePrompt}"
    End frame: "${endImagePrompt}"
    
    Create a video prompt following this structure:
    - Describe the camera movement (slow zoom, pan, dolly, orbit, etc.)
    - Mention the transition between the two states
    - Include cinematic qualities (smooth, fluid, cinematic, 4k, high quality)
    - Keep it under 200 characters for best results
    
    Example output: "Smooth cinematic zoom in, camera slowly pans left revealing the scene, fluid motion, 4k quality, professional cinematography"
    
    Return ONLY the video prompt text, nothing else.
    `;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
		temperature: 0.7
	});

	const result = chatCompletion.choices[0].message.content;
	if (result) {
		return result.trim();
	} else {
		// Fallback
		return "Smooth cinematic motion, camera slowly moves revealing the scene, fluid transition, 4k quality";
	}
}

/**
 * Generate a varied end frame prompt from a start frame prompt
 */
export async function generateEndFramePrompt(startPrompt: string): Promise<string> {
	const prompt = `
    You are an AI art director creating a sequence of images for video generation.
    
    Given this START frame image prompt: "${startPrompt}"
    
    Create an END frame prompt that represents a logical visual progression or slight variation of the scene.
    The end frame should:
    - Show the same subject/scene but from a slightly different perspective or state
    - Have a natural progression (e.g., if zoomed out, now closer; if left, now center; if beginning, now ending)
    - Maintain visual consistency with the start frame
    - Be suitable as the final frame of a 5-second video clip
    
    Return ONLY the end frame image prompt, nothing else. Keep the same style and quality descriptors as the start prompt.
    `;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
		temperature: 0.8
	});

	const result = chatCompletion.choices[0].message.content;
	if (result) {
		return result.trim();
	} else {
		// Fallback: slight variation
		return startPrompt + ", closer perspective, slight zoom in";
	}
}

/**
 * Generate a progressive prompt that evolves from the previous one
 * Used to create visual continuity across multiple scenes
 */
export async function generateProgressivePrompt(
	previousPrompt: string,
	index: number,
	totalFrames: number
): Promise<string> {
	const progress = ((index / totalFrames) * 100).toFixed(0);

	const prompt = `
    You are an AI art director creating a progressive visual story across ${totalFrames} frames.
    
    PREVIOUS frame (${index - 1}/${totalFrames}): "${previousPrompt}"
    
    Create the NEXT frame (${index}/${totalFrames}, ${progress}% through the story) that:
    - Naturally evolves from the previous scene
    - Maintains visual continuity (same style, lighting, color palette)
    - Shows progression in the narrative (closer zoom, different angle, next moment in time, etc.)
    - Feels like a smooth transition when animated between frames
    
    Return ONLY the new image prompt, nothing else. Keep the same technical descriptors (resolution, camera, lens, etc.) as the previous prompt.
    `;

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
		temperature: 0.7 // Slightly lower for consistency
	});

	const result = chatCompletion.choices[0].message.content;
	if (result) {
		return result.trim();
	} else {
		// Fallback: add progression marker
		return previousPrompt + `, progressive step ${index}`;
	}
}
