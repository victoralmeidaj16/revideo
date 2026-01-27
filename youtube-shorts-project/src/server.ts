import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createAssets } from './get-assets';
import { getVideoScript, generateProImagePrompts } from './utils';
import 'dotenv/config';

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend files

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
        const { script, voice, imagePrompts } = req.body;
        console.log(`Received video generation request with script length: ${script?.length}, voice: ${voice}`);

        await createAssets(script, voice, imagePrompts);

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
        const { script, topic } = req.body;
        console.log(`Received pro prompt generation request for topic: ${topic}`);
        const prompts = await generateProImagePrompts(script, topic);
        res.json({ success: true, prompts });
    } catch (error: any) {
        console.error('Prompt generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
