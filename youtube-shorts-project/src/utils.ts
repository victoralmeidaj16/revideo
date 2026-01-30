import 'dotenv/config';
import OpenAI from 'openai/index.mjs';
import axios from "axios";
import * as fs from "fs";
import { AssemblyAI } from "assemblyai";

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

import Replicate from "replicate";

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