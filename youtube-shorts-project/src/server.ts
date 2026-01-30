import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import multer from 'multer';
import path from 'path';
import { createAssets } from './get-assets';
import { getVideoScript, generateProImagePrompts, generateProVideoPrompts } from './utils';
import 'dotenv/config';

const app = express();
const port = 3001;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        const uniqueName = `ref-${Date.now()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato inválido. Use JPEG, PNG ou WebP.'));
        }
    }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend files

// Ensure uploads directory exists
import fs from 'fs';
if (!fs.existsSync('./public/uploads')) {
    fs.mkdirSync('./public/uploads', { recursive: true });
}

// Upload reference image endpoint
app.post('/api/upload-reference', upload.single('referenceImage'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Nenhuma imagem enviada' });
        }
        const imageUrl = `http://localhost:${port}/uploads/${req.file.filename}`;
        console.log(`Reference image uploaded: ${imageUrl}`);
        res.json({ success: true, imageUrl });
    } catch (error: any) {
        console.error('Upload failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generate-script', async (req, res) => {
    try {
        const { topic } = req.body;
        console.log(`Received script generation request for topic: ${topic}`);
        const script = await getVideoScript(topic);
        res.json({ success: true, script });
    } catch (error: any) {
        console.error('Script generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generate', async (req, res) => {
    try {
        const { script, voice, imagePrompts, referenceImageUrl } = req.body;
        console.log(`Received video generation request with script length: ${script?.length}, voice: ${voice}`);
        if (referenceImageUrl) {
            console.log(`Using reference image: ${referenceImageUrl}`);
        }

        const isVideoMode = req.body.useVideo !== undefined ? req.body.useVideo : true;
        console.log(`Generating assets. useVideo request param: ${req.body.useVideo}, computed isVideoMode: ${isVideoMode}`);

        await createAssets(script, voice, imagePrompts, referenceImageUrl, isVideoMode);

        res.json({ success: true, message: 'Assets generated successfully' });
    } catch (error: any) {
        console.error('Generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/voices', async (req, res) => {
    res.json({
        voices: [
            { name: "Sarah", id: "EXAVITQu4vr4xnSDxMaL" },
            { name: "Roger", id: "CwhRBWXzGAHq8TQ4Fs17" },
            { name: "Charlie", id: "IKne3meq5aSn9XLyUdCD" }
        ]
    });
});

app.post('/api/generate-prompts', async (req, res) => {
    try {
        const { script, topic, useVideo } = req.body;
        console.log(`Received pro prompt generation request for topic: ${topic}, useVideo: ${useVideo}`);

        let prompts;
        if (useVideo) {
            prompts = await generateProVideoPrompts(script, topic);
        } else {
            prompts = await generateProImagePrompts(script, topic);
        }
        res.json({ success: true, prompts });
    } catch (error: any) {
        console.error('Prompt generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
