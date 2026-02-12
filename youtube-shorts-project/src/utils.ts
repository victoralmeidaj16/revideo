
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

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

export async function generateAudio(text: string, voiceNameOrId: string, savePath: string) {
	const data = {
		model_id: "eleven_multilingual_v2",
		text: text,
	};

	let voiceId = voiceNameOrId;
	// Check if input looks like a valid ID (long alphanumeric string)
	// If not, try to look it up by name
	if (!/^[a-zA-Z0-9]{20}$/.test(voiceNameOrId)) {
		const foundId = await getVoiceByName(voiceNameOrId);
		if (foundId) {
			voiceId = foundId;
		} else {
			console.warn(`Voice name '${voiceNameOrId}' not found, assuming it's a valid ID or let it fail.`);
		}
	}

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

export async function getVideoScript(videoTopic: string, templateStructure?: string, brandContext?: string) {
	// Parse brand context if present to get name/niche for the system role
	const brandNameInfo = brandContext?.match(/Marca: (.*?)\./)?.[1] || 'uma marca moderna';
	const brandNicheInfo = brandContext?.match(/Nicho: (.*?)\./)?.[1] || 'conteúdo viral';

	const systemRole = `Você é um copywriter especialista e estrategista de conteúdo para ${brandNameInfo}, atuando no nicho de ${brandNicheInfo}.
Seu objetivo é criar roteiros de vídeos curtos (Shorts/Reels/TikTok) que sejam altamente engajadores, retenham a atenção e estejam PERFEITAMENTE alinhados com a identidade e voz da marca.`;

	const brandInstruction = brandContext
		? `\n\n📋 **IDENTIDADE DA MARCA (Siga estritamente):**\n${brandContext}\n\nUSE O TOM DE VOZ, VOCABULÁRIO E VALORES descritos acima. O roteiro deve soar como se fosse escrito pelo fundador/especialista da marca.`
		: '';

	let layoutInstruction = '';
	if (templateStructure) {
		layoutInstruction = `\n\n📐 **ESTRUTURA OBRIGATÓRIA DO ROTEIRO:**\n${templateStructure}`;
	} else {
		layoutInstruction = `\n\n📐 **ESTRUTURA SUGERIDA:**\n- **Gancho (0-3s):** Uma frase impactante, curiosa ou polêmica para prender a atenção.\n- **Corpo (3-40s):** Desenvolvimento do conteúdo com valor prático ou emocional.\n- **CTA (40-60s):** Chamada para ação clara e conectada ao objetivo da marca.`;
	}

	const prompt = `
Crie um roteiro para um vídeo curto vertical (aprox. 60-90 segundos falados).

Crie um roteiro para um vídeo curto vertical (aprox. 60-90 segundos falados).

🎯 **TÓPICO DO VÍDEO:** ${videoTopic ? `"${videoTopic}"` : "ESCOLHA UM TÓPICO VIRAL E RELEVANTE PARA O NICHO DA MARCA (Sugerir algo que engaje o público-alvo)"}
${brandInstruction}
${layoutInstruction}

⚠️ **REGRAS CRITICAS:**
1. **IDIOMA:** Escreva em PORTUGUÊS (BRASIL) natural e falado.
2. **FORMATO:** Apenas o texto falado (voiceover). NÃO inclua rubricas como [Música], [Cena], [Efeitos], emojis ou hashtags.
3. **TOM:** Deve refletir a personalidade da marca (ex: se for 'Inner Boost', deve ser inspirador, científico e motivador; se for 'TechNova', deve ser futurista e técnico).
4. **RETENÇÃO:** Use frases curtas, ritmo ágil e evite introduções longas. Vá direto ao ponto.

SAÍDA ESPERADA:
Apenas o texto corrido do roteiro, pronto para ser lido pelo narrador. Nada mais.
`;

	console.log(`[Script Gen] Generating script for topic: "${videoTopic}" with brand context length: ${brandContext?.length || 0}`);

	const chatCompletion = await openai.chat.completions.create({
		messages: [
			{ role: 'system', content: systemRole },
			{ role: 'user', content: prompt }
		],
		model: 'gpt-4-turbo-preview',
		temperature: 0.7, // Slightly creative but focused
	});

	const result = chatCompletion.choices[0].message.content;

	if (result) {
		return result.trim();
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
	// Replicate implementation preserved if needed, but we essentially want to replace usages.
	// ...
	// Actually, I will replace this WHOLE function with one that calls geminiGenerate if needed, 
	// OR I can just add geminiGenerate and change the call sites.
	// The plan said "Replace calls to replicateGenerate with geminiGenerate".
	// So I will add geminiGenerate here.
	return geminiGenerate(prompt, savePath, referenceImageUrl);
}

export async function geminiGenerate(prompt: string, savePath: string, referenceImageUrl?: string) {
	console.log(`Generating image with Gemini for prompt: ${prompt}`);

	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

	// The model name requested was 'gemini-3-pro-image-preview'.
	// We try to use the exact ID provided by the user.
	const modelId = 'gemini-3-pro-image-preview';
	// Use generateContent instead of predict
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

	// Payload for Gemini generateContent
	const payload = {
		contents: [{
			parts: [{ text: prompt }]
		}],
		safetySettings: [
			{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
		]
	};

	try {
		if (!prompt || prompt.trim().length === 0) {
			throw new Error("Prompt cannot be empty for Gemini generation");
		}

		const response = await axios.post(url, payload, {
			headers: { 'Content-Type': 'application/json' }
		});

		// Debug logging to see structure if we don't know it
		// console.log("Gemini 3 Response:", JSON.stringify(response.data, null, 2));

		if (response.data && response.data.candidates && response.data.candidates.length > 0) {
			const candidate = response.data.candidates[0];
			const parts = candidate.content.parts;

			// Look for inlineData (image bytes)
			const inlineDataPart = parts.find((p: any) => p.inlineData);

			if (inlineDataPart) {
				const base64Image = inlineDataPart.inlineData.data;
				const buffer = Buffer.from(base64Image, 'base64');
				await fs.promises.writeFile(savePath, buffer);
				console.log(`Saved Gemini 3 image to ${savePath}`);
			} else {
				// Fallback: check if it returned a file URI or text link
				console.log("No inlineData found in response parts:", JSON.stringify(parts));
				throw new Error("No image data found in Gemini 3 response");
			}

		} else {
			throw new Error(`Unexpected response from Gemini 3: ${JSON.stringify(response.data)}`);
		}
	} catch (e: any) {
		const errorMsg = e.response?.data?.error?.message || e.message;
		const errorCode = e.response?.status || 'Unknown';
		console.error(`Gemini generation failed (${errorCode}):`, errorMsg);

		// Log full details if available
		if (e.response?.data) {
			console.error("Full error details:", JSON.stringify(e.response.data, null, 2));
		}

		throw new Error(`Gemini Error (${errorCode}): ${errorMsg}`);
	}
}

// I'll rewrite `replicateGenerate` to use `geminiGenerate`
// But wait, `replicateGenerate` is exported and used elsewhere. 
// I should just change the implementation of `replicateGenerate` to call `geminiGenerate` 
// OR rename it and update callers. 
// Renaming is better for clarity, but keeping the name `replicateGenerate` 
// (or `generateImage`) and changing the internals is easier for refactoring.
// I'll Rename it to `generateImage` and alias `geminiGenerate` to it, 
// then update callers to usage `generateImage`.
// Better yet, I'll leave `replicateGenerate` as is (deprecated) and add `generateImage` (using Gemini).
// Then I update the callers.

export async function generateImage(prompt: string, savePath: string, referenceImageUrl?: string) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		console.warn("GEMINI_API_KEY missing, falling back to Replicate...");
		return replicateGenerate(prompt, savePath, referenceImageUrl);
	}

	// Implementation for Gemini/Imagen
	// Using 'imagen-3.0-generate-001' as the likely real target for image generation API
	// or 'gemini-2.0-flash' if it supports it.

	// I will use a direct fetch to the Imagen endpoint which is most standard for this.
	const modelId = 'imagen-3.0-generate-001';
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${apiKey}`;

	const payload = {
		instances: [{ prompt: prompt }],
		parameters: {
			sampleCount: 1,
			aspectRatio: "9:16"
		}
	};

	// ...
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

export async function generateProVideoPrompts(script: string, topic: string, brandContext?: string, templateContext?: string) {
	const brandInstruction = brandContext
		? `\n\nBRAND GUIDELINES (STRICTLY FOLLOW):\n${brandContext}\nUse the brand's color palette, lighting style, and mood in every scene.`
		: '';

	const templateInstruction = templateContext
		? `\n\nTEMPLATE STRUCTURE:\n${templateContext}\nEnsure the visual flow matches this structure.`
		: '';

	const prompt = `
    You are an expert AI Director and Cinematographer.
    
    Your task is to create a visual storyboard for a video script.
    The script will be provided below.
    
    STRICT RULES:
    1. Break the script into exactly 6 chronological segments.
    2. For EACH segment, write a highly detailed, LITERAL image generation prompt.
    3. The image MUST depict EXACTLY what is being said in that part of the script.
    4. NO METAPHORS. NO ABSTRACT CONCEPTS. If the script says "person running", show a person running. Do NOT show a clock to represent time.
    5. STYLE: Cinematic, photorealistic, 4k, vertical (9:16).
    6. NEGATIVE PROMPT (CRITICAL): NO TEXT, NO WORDS, NO LETTERS, NO TYPOGRAPHY, NO HUD, NO OVERLAYS, NO ICONS. The image must be a photograph/render only.
    7. CONTINUITY: Maintain consistent lighting and character style across all scenes.

    ${brandInstruction}

    SCRIPT:
    "${script}"

    Return ONLY a JSON array of 6 strings. Example:
    [
        "Vertical cinematic shot of [subject doing specific action described in script segment 1]...",
        "Vertical cinematic shot of [subject doing specific action described in script segment 2]...",
        ...
    ]
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

export async function generateProImagePrompts(script: string, topic: string, brandContext?: string, templateContext?: string) {
	const brandInstruction = brandContext
		? `\n\nBRAND GUIDELINES (STRICTLY FOLLOW):\n${brandContext}\nUse the brand's color palette, lighting style, and mood in every scene.`
		: '';

	const templateInstruction = templateContext
		? `\n\nTEMPLATE STRUCTURE:\n${templateContext}\nEnsure the visual flow matches this structure.`
		: '';

	const prompt = `
    You are an expert AI Art Director specializing in hyper-realistic, high-end commercial photography for a specific brand.
    
    Your task is to create 5 distinct, sequential image prompts to accompany a video script about "${topic}".
    
    The script is: "${script}".
    ${brandInstruction}
    ${templateInstruction}
    
    Break the script into 5 chronological scenes. For EACH scene, write a prompt following this EXACT style structure, but adapting the subject to the scene:

    "A hyper-realistic vertical lifestyle photo (Ratio 9:16, 1080×1920) shot with directional soft light in a [describe environment matching brand style]. Captured on a high-end mirrorless camera with a 50 mm lens at f/2.0. The camera is positioned in [describe angle], creating a subtle sense of protagonists and confidence. The subject is [describe subject and action detailed]. Colors: [mention brand colors]."

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
	model: 'kling-v1' | 'kling-v1-5' | 'kling-v1-6' | 'kling-v2-6';  // v1, v1.5, v1.6, v2.6 (latest)
	mode: 'std' | 'pro';               // std = standard speed, pro = higher quality but slower
}

/**
 * Default Kling configuration
 */
export const DEFAULT_KLING_CONFIG: KlingConfig = {
	model: 'kling-v2-6',
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
	const tip =
		status === 429 && data?.code === 1303
			? ' Tip: reduce parallelism via KLING_MAX_PARALLEL_TASKS (e.g. 1 or 2).'
			: '';
	return new Error(`[${context}] HTTP ${status ?? 'unknown'}: ${details}.${requestId}${tip}`.trim());
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
	endImagePath?: string,
	config: KlingConfig = DEFAULT_KLING_CONFIG
): Promise<string> {
	const accessKey = process.env.KLING_ACCESS_KEY;
	const secretKey = process.env.KLING_SECRET_KEY;

	if (!accessKey || !secretKey) {
		throw new Error('Kling API credentials not found in environment variables');
	}

	// Convert images to base64
	const startImageBase64 = sanitizeBase64(await fs.promises.readFile(startImagePath, { encoding: 'base64' }));
	let endImageBase64: string | undefined;

	if (endImagePath) {
		endImageBase64 = sanitizeBase64(await fs.promises.readFile(endImagePath, { encoding: 'base64' }));
	}

	// Force mode to 'pro' for kling-v2-6 ONLY if using image_tail (end frame)
	// If standard mode is requested and we have an end frame, we must upgrade to pro (as standard doesn't support it)
	// If standard mode is requested and we DON'T have an end frame, we can keep standard.
	let effectiveMode = config.mode;
	if (config.model === 'kling-v2-6' && endImagePath) {
		effectiveMode = 'pro';
		console.log('[Kling] Upgrading to PRO mode to support end frame (image_tail) on v2.6');
	}

	// Prepare request payload
	const payload: any = {
		model_name: config.model,
		// Kling expects raw base64, not a data URL.
		image: startImageBase64,
		prompt: videoPrompt,
		duration: 5,
		aspect_ratio: "9:16",
		cfg_scale: 0.5,
		mode: effectiveMode
	};

	if (endImageBase64) {
		payload.image_tail = endImageBase64;
	}

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
	} catch (error: any) {
		const formattedError = formatAxiosError(error, 'Kling submit');
		if (error.response?.status === 429) {
			console.warn("[Kling] Hit rate limit (429). Waiting 60s for previous tasks to finish...");
			await new Promise(resolve => setTimeout(resolve, 60000));
		}
		throw formattedError;
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
	const maxAttempts = 90; // 15 minutes max (90 * 10s)
	let attempts = 0;

	console.log(`[Kling] Starting polling for task ${taskId}...`);

	while (!completed && attempts < maxAttempts) {
		await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
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
			console.log(`[Kling] Success response: ${JSON.stringify(statusResponse.data, null, 2)}`);
			const taskResult = statusResponse.data.data?.task_result;

			// Check for 'videos' array (Kling v2.6 / new format)
			if (taskResult?.videos && Array.isArray(taskResult.videos) && taskResult.videos.length > 0) {
				videoUrl = taskResult.videos[0].url;
			}
			// Check for 'works' array (Old Kling format)
			else if (taskResult?.works && Array.isArray(taskResult.works) && taskResult.works.length > 0) {
				videoUrl = taskResult.works[0].resource.resource;
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
	endImagePath?: string,
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
		endPath?: string;
		savePath: string;
	}>,
	config: KlingConfig = DEFAULT_KLING_CONFIG
): Promise<void> {
	console.log(`[Kling Batch] Starting batch generation of ${tasks.length} videos (model: ${config.model}, mode: ${config.mode})...`);
	const batchStartTime = Date.now();

	// Kling accounts often have a strict limit on concurrent tasks (error 429 code 1303).
	// Keep a small worker pool that submits+polls sequentially per worker.
	// Keep a small worker pool that submits+polls sequentially per worker.
	const envMaxParallel = Number(process.env.KLING_MAX_PARALLEL_TASKS ?? 1);
	const maxParallel =
		Number.isFinite(envMaxParallel) && envMaxParallel > 0
			? Math.min(Math.floor(envMaxParallel), tasks.length)
			: Math.min(1, tasks.length);

	console.log(`[Kling Batch] Using max parallel tasks: ${maxParallel} (set KLING_MAX_PARALLEL_TASKS to override)`);

	let nextIndex = 0;
	const worker = async (workerId: number) => {
		while (true) {
			const current = nextIndex++;
			if (current >= tasks.length) return;

			const task = tasks[current];
			console.log(`[Kling Batch] Worker ${workerId}: submitting task ${current + 1}/${tasks.length}`);
			const taskId = await klingSubmitTask(task.videoPrompt, task.startPath, task.endPath, config);

			console.log(`[Kling Batch] Worker ${workerId}: polling task ${current + 1}/${tasks.length} (${taskId})`);
			await klingPollTask(taskId, task.savePath);
		}
	};

	await Promise.all(Array.from({ length: maxParallel }, (_, i) => worker(i + 1)));

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
	endImagePath: string | undefined,
	savePath: string
): Promise<void> {
	await klingBatchGenerate([{
		videoPrompt,
		startPath: startImagePath,
		endPath: endImagePath,
		savePath
	}]);
}



/**
 * Generate an optimized video prompt describing camera movement and scene transition
 */
export async function generateVideoPrompt(
	sceneDescription: string,
	startImagePrompt: string,
	endImagePrompt?: string
): Promise<string> {
	const endContext = endImagePrompt ? `\n    End frame: "${endImagePrompt}"` : '';
	const transitionContext = endImagePrompt
		? '- Mention the transition between the two states'
		: '- Describe how the scene evolves from the static start image';

	const prompt = `
    You are an expert AI video director specializing in image-to-video generation.
    
    Given a scene description and ${endImagePrompt ? 'two image prompts (start and end frames)' : 'a start image prompt'}, create a SHORT, CONCISE video prompt that describes the motion, camera movement, and transition.
    
    Scene context: "${sceneDescription}"
    Start frame: "${startImagePrompt}"${endContext}
    
    Create a video prompt following this structure:
    - Describe the camera movement (slow zoom, pan, dolly, orbit, etc.)
    ${transitionContext}
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
		// Fallback
		return startPrompt + ", slightly different angle, cinematic lighting";
	}
}

export async function extractAudioSegment(videoPath: string, startTime: string, duration: number, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		ffmpeg(videoPath)
			.setStartTime(startTime)
			.setDuration(duration)
			.output(outputPath)
			.noVideo()
			.audioCodec('pcm_s16le') // Convert to WAV compatible format
			.on('end', () => {
				console.log('Audio extraction finished');
				resolve();
			})
			.on('error', (err) => {
				console.error('Error extracting audio:', err);
				reject(err);
			})
			.run();
	});
}



/**
 * Generate a progressive prompt that evolves from the previous one
 * Used to create visual continuity across multiple scenes
 * @deprecated Use generateStoryboardPrompts instead for better results
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

/**
 * AI Creative Director — Generates 6 cohesive scene prompts in a single call.
 * Creates a structured visual narrative (mini-film) from a script and brand profile.
 * Each prompt includes environment, lighting, camera, colors, and motion intent.
 */
export async function generateStoryboardPrompts(
	script: string,
	brand?: { name: string; niche: string; description?: string; colors: string }
): Promise<string[]> {
	const brandName = brand?.name || 'Generic';
	const brandNiche = brand?.niche || 'General';
	const brandColors = brand?.colors || 'modern neutral tones';
	const brandDescription = brand?.description || '';

	const brandContext = brandDescription
		? `\n- Brand Description: ${brandDescription}`
		: '';

	const prompt = `
Role: You are an AI Creative Director for an automated short-form video platform.
Your MAIN JOB is to create 6 image prompts that DIRECTLY ILLUSTRATE what the script is saying — as if you were shooting a real video to accompany this narration.

INPUT DATA:
- Script (narration): "${script}"
- Brand: ${brandName} (Niche: ${brandNiche})${brandContext}
- Brand Colors: ${brandColors}
- Format: Vertical 9:16

CRITICAL RULES — READ CAREFULLY:
1. **LITERAL ILLUSTRATION**: Each scene MUST visually depict what is being SAID in that part of the script. If the script says "capture your audience's attention", show a person presenting to an engaged audience. If it says "neuroscience techniques", show a brain with neural pathways. DO NOT create abstract or metaphorical images.
2. **FORBIDDEN IMAGERY**: Do NOT generate: mazes, abstract labyrinths, lone silhouettes, generic globes, floating geometric shapes, chess pieces, abstract light beams, or any generic stock-photo concept that doesn't directly relate to the script words.
3. **SHOW REAL SITUATIONS**: Use real people in real environments doing things related to the script content — working on laptops, brainstorming in offices, presenting, studying, etc.
4. **SCRIPT SEGMENTATION**: Mentally divide the script into 6 equal parts. Scene 1 illustrates the first ~17% of the script, Scene 2 the next ~17%, and so on. Each scene should match its corresponding script segment.
5. **BRAND COLORS**: Integrate the brand colors (${brandColors}) into the environments — colored lighting, objects of those colors, clothing accents, tech screens with those color schemes, neon signs, etc.
6. **NO TEXT/WATERMARKS**: Do NOT include any text, titles, watermarks, or written words in the images.
7. **MOTION INTENT**: Each prompt MUST include a camera movement direction (e.g., "slow zoom in", "pan right", "dolly forward", "orbit around") for video animation.

SCENE STRUCTURE:
- Scene 1 (Hook): Powerful opening that matches the first sentence of the script
- Scenes 2-4 (Development): Each illustrating its corresponding script segment
- Scene 5 (Climax): Emotional/informational peak matching the script's climax
- Scene 6 (CTA/Closing): Resolution matching the final call-to-action

TECHNICAL REQUIREMENTS:
- Vertical 9:16 aspect ratio
- Cinematic lighting, hyper-realistic, 8k quality
- Photorealistic style (not cartoon/illustration)
- Each scene must look like it belongs in a professional short-form video

OUTPUT FORMAT:
Return ONLY a valid JSON array of 6 strings. No markdown, no code blocks, no explanation.
Example:
[
  "Vertical cinematic close-up of a young entrepreneur looking frustrated at a laptop screen showing flat marketing metrics, dim office with ${brandColors.split(',')[0] || 'blue'} LED accent lighting behind the monitor, slow zoom into their expression. 8k, photorealistic, vertical 9:16.",
  "Scene 2...",
  "Scene 3...",
  "Scene 4...",
  "Scene 5...",
  "Scene 6..."
]
`;

	console.log('[AI Director] Generating 6 storyboarded scene prompts in a single call...');

	const chatCompletion = await openai.chat.completions.create({
		messages: [{ role: 'user', content: prompt }],
		model: 'gpt-4-turbo-preview',
		temperature: 0.8
	});

	const content = chatCompletion.choices[0].message.content || '[]';

	try {
		// Remove markdown code blocks if present (e.g. ```json ... ```)
		const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
		const parsed = JSON.parse(cleanContent);

		if (Array.isArray(parsed) && parsed.length === 6) {
			console.log('[AI Director] Successfully generated 6 scene prompts.');
			parsed.forEach((p: string, i: number) => console.log(`  Scene ${i + 1}: ${p.substring(0, 80)}...`));
			return parsed;
		} else {
			console.warn(`[AI Director] Expected 6 prompts, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}. Falling back.`);
			// Pad or trim to 6
			const result = Array.isArray(parsed) ? parsed : [];
			while (result.length < 6) {
				result.push(result[result.length - 1] || `Scene ${result.length + 1} for "${script.substring(0, 50)}"`);
			}
			return result.slice(0, 6);
		}
	} catch (e) {
		console.error('[AI Director] Failed to parse storyboard prompts:', content);
		// Fallback: generate 6 basic prompts from the script
		console.log('[AI Director] Using fallback: generating basic prompts from script...');
		const fallbackPrompt = await getImagePromptFromScript(script);
		return Array.from({ length: 6 }, (_, i) =>
			`${fallbackPrompt}, scene ${i + 1} of 6, cinematic vertical 9:16, 8k`
		);
	}
}
