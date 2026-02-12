import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import multer from 'multer';
import path from 'path';
import { createAssets } from './get-assets';
import { getVideoScript, generateProImagePrompts, generateProVideoPrompts } from './utils';
import { v4 as uuidv4 } from 'uuid';
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
        const { topic, templateId, headlineFormula } = req.body;
        console.log(`Received script generation request for topic: ${topic}, templateId: ${templateId}`);

        // Resolve template structure if provided
        let templateStructure: string | undefined;
        if (templateId) {
            const template = templates.find((t: any) => t.id === templateId);
            if (template) {
                // Special handling for headline templates
                if (template.structure === 'SPECIAL:HEADLINES' && headlineFormula) {
                    // Build a headline-adapted prompt
                    templateStructure = `Use esta fórmula de título/headline como base para o roteiro: "${headlineFormula}". Adapte os placeholders entre {chaves} para o tema fornecido. O roteiro deve começar com esse título adaptado como gancho principal. Desenvolva o conteúdo do roteiro baseado nesse título de forma envolvente e persuasiva.`;
                    console.log(`Using headline formula: ${headlineFormula}`);
                } else if (template.structure !== 'SPECIAL:HEADLINES') {
                    templateStructure = template.structure;
                }
                console.log(`Using template: ${template.name}`);
            }
        }

        // Resolve brand context for prompt enrichment
        let brandContext: string | undefined;
        if (req.body.brandId) {
            const brands = loadBrandsFromFile();
            const brand = brands.find((b: any) => b.id === req.body.brandId);
            if (brand) {
                const parts = [`Marca: ${brand.name}`];
                if (brand.niche) parts.push(`Nicho: ${brand.niche}`);
                if (brand.description) parts.push(`Descrição da marca: ${brand.description}`);
                brandContext = parts.join('. ') + '.';
                console.log(`Using brand context: ${brandContext}`);
            }
        }

        const script = await getVideoScript(topic, templateStructure, brandContext);
        res.json({ success: true, script });
    } catch (error: any) {
        console.error('Script generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generate', async (req, res) => {
    try {
        const { script, voice, imagePrompts, referenceImageUrl, brandId } = req.body;
        console.log(`Received video generation request with script length: ${script?.length}, voice: ${voice}, brandId: ${brandId}`);
        if (referenceImageUrl) {
            console.log(`Using reference image: ${referenceImageUrl}`);
        }

        const isVideoMode = req.body.useVideo !== undefined ? req.body.useVideo : true;
        console.log(`Generating assets. useVideo request param: ${req.body.useVideo}, computed isVideoMode: ${isVideoMode}`);

        await createAssets(script, voice, imagePrompts, referenceImageUrl, isVideoMode, undefined, brandId);

        res.json({ success: true, message: 'Assets generated successfully' });
    } catch (error: any) {
        console.error('Generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Preview images before generating videos
app.post('/api/preview-images', async (req, res) => {
    try {
        const { script, imagePrompts, referenceImageUrl, brandId } = req.body;
        console.log('[Preview] Generating image previews...');

        // Generate only images (isVideoMode = false) to show preview
        await createAssets(script, 'Sarah', imagePrompts, referenceImageUrl, false, undefined, brandId);

        res.json({ success: true, message: 'Preview images generated successfully' });
    } catch (error: any) {
        console.error('Preview generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate videos from already-generated images
app.post('/api/generate-videos', async (req, res) => {
    try {
        const { script, voice, imagePrompts, referenceImageUrl, useVideo, klingConfig, brandId, existingImages } = req.body;
        const isVideoMode = useVideo !== undefined ? useVideo : true;
        console.log(`[Video Generation] Generating final video. useVideo: ${useVideo}, isVideoMode: ${isVideoMode}, brandId: ${brandId}, existingImages: ${existingImages ? existingImages.length : 0}`);
        if (isVideoMode && klingConfig) {
            console.log(`[Video Generation] Kling config: model=${klingConfig.model}, mode=${klingConfig.mode}`);
        }

        // Generate with the appropriate mode
        await createAssets(script, voice || 'Sarah', imagePrompts, referenceImageUrl, isVideoMode, klingConfig, brandId, existingImages);

        res.json({ success: true, message: isVideoMode ? 'Videos generated successfully' : 'Static images ready for rendering' });
    } catch (error: any) {
        console.error('Video generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Brand data - dynamic file-based storage
import templates from './templates.json';
import headlines from './headlines.json';

const brandsFilePath = path.join(__dirname, 'brands.json');

function loadBrandsFromFile(): any[] {
    try {
        const raw = fs.readFileSync(brandsFilePath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function saveBrandsToFile(brands: any[]) {
    fs.writeFileSync(brandsFilePath, JSON.stringify(brands, null, 4), 'utf-8');
}

app.get('/api/brands', async (req, res) => {
    res.json(loadBrandsFromFile());
});

// Create a new brand
app.post('/api/brands', async (req, res) => {
    try {
        const brands = loadBrandsFromFile();
        const { name, niche, description, theme, voice, watermarkOpacity, logoUrl } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Nome da marca é obrigatório' });
        }

        const newBrand = {
            id: 'brand_' + Date.now(),
            name,
            niche: niche || '',
            description: description || '',
            theme: theme || {
                primaryColor: '#6C5CE7',
                secondaryColor: '#1A1A2E',
                accentColor: '#FF6B6B',
                textColor: '#FFFFFF',
                backgroundColor: '#0F0F19',
                fontFamily: 'Inter'
            },
            voice: voice || { name: 'Sarah', details: '', provider: 'elevenlabs', providerId: 'EXAVITQu4vr4xnSDxMaL' },
            watermarkOpacity: watermarkOpacity ?? 0.8,
            logoUrl: logoUrl || ''
        };

        brands.push(newBrand);
        saveBrandsToFile(brands);
        console.log(`[Brands] Created brand: ${newBrand.name} (${newBrand.id})`);
        res.json({ success: true, brand: newBrand });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update a brand
app.put('/api/brands/:id', async (req, res) => {
    try {
        const brands = loadBrandsFromFile();
        const idx = brands.findIndex((b: any) => b.id === req.params.id);
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Marca não encontrada' });
        }

        const updated = { ...brands[idx], ...req.body, id: brands[idx].id };
        brands[idx] = updated;
        saveBrandsToFile(brands);
        console.log(`[Brands] Updated brand: ${updated.name}`);
        res.json({ success: true, brand: updated });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a brand
app.delete('/api/brands/:id', async (req, res) => {
    try {
        let brands = loadBrandsFromFile();
        const before = brands.length;
        brands = brands.filter((b: any) => b.id !== req.params.id);
        if (brands.length === before) {
            return res.status(404).json({ success: false, error: 'Marca não encontrada' });
        }
        saveBrandsToFile(brands);
        console.log(`[Brands] Deleted brand: ${req.params.id}`);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/templates', async (req, res) => {
    res.json(templates);
});

// Headlines endpoint
app.get('/api/headlines', async (req, res) => {
    res.json({ success: true, headlines });
});

// --- Draft / Approval Flow ---
interface Draft {
    id: string;
    script: string;
    voice: string;
    brandId?: string;
    templateId?: string;
    imagePrompts: string[];
    referenceImageUrl?: string;
    useVideo: boolean;
    klingConfig?: { model: string; mode: string };
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
}

const drafts = new Map<string, Draft>();

// Create a draft for review
app.post('/api/draft', async (req, res) => {
    try {
        const { script, voice, imagePrompts, referenceImageUrl, brandId, templateId, useVideo, klingConfig } = req.body;

        if (!script) {
            return res.status(400).json({ success: false, error: 'Script is required' });
        }

        const draft: Draft = {
            id: uuidv4(),
            script,
            voice: voice || 'Sarah',
            brandId,
            templateId,
            imagePrompts: imagePrompts || [],
            referenceImageUrl,
            useVideo: useVideo !== undefined ? useVideo : true,
            klingConfig,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        drafts.set(draft.id, draft);
        console.log(`[Draft] Created draft ${draft.id} for review`);

        // Generate preview images for this draft
        await createAssets(draft.script, draft.voice, draft.imagePrompts, draft.referenceImageUrl, false, undefined, draft.brandId);

        res.json({ success: true, draft });
    } catch (error: any) {
        console.error('Draft creation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a draft by ID
app.get('/api/draft/:id', async (req, res) => {
    const draft = drafts.get(req.params.id);
    if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    res.json({ success: true, draft });
});

// List all drafts
app.get('/api/drafts', async (req, res) => {
    const allDrafts = Array.from(drafts.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json(allDrafts);
});

// Approve a draft and render
app.post('/api/draft/:id/approve', async (req, res) => {
    const draft = drafts.get(req.params.id);
    if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft not found' });
    }

    // Allow script edits before approval
    if (req.body.script) {
        draft.script = req.body.script;
    }

    draft.status = 'approved';
    console.log(`[Draft] Approved draft ${draft.id}. Starting final render...`);

    try {
        await createAssets(
            draft.script,
            draft.voice,
            draft.imagePrompts,
            draft.referenceImageUrl,
            draft.useVideo,
            draft.klingConfig as any,
            draft.brandId
        );

        res.json({ success: true, message: 'Draft approved and rendered successfully' });
    } catch (error: any) {
        console.error('Render after approval failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reject/delete a draft
app.delete('/api/draft/:id', async (req, res) => {
    if (drafts.delete(req.params.id)) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Draft not found' });
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
        const { script, topic, useVideo, brandId, templateId } = req.body;
        console.log(`Received pro prompt generation request for topic: ${topic}, useVideo: ${useVideo}, brandId: ${brandId}, templateId: ${templateId}`);

        // Resolve brand context
        let brandContext: string | undefined;
        if (brandId) {
            const brands = loadBrandsFromFile();
            const brand = brands.find((b: any) => b.id === brandId);
            if (brand) {
                const parts = [`Marca: ${brand.name}`];
                if (brand.niche) parts.push(`Nicho: ${brand.niche}`);
                if (brand.description) parts.push(`Descrição da marca: ${brand.description}`);
                if (brand.theme) {
                    parts.push(`Cores da marca: ${brand.theme.primaryColor}, ${brand.theme.secondaryColor}, ${brand.theme.accentColor}, ${brand.theme.backgroundColor}`);
                    parts.push(`Estilo visual: Dark mode com acentos neon (verde/azul)`);
                }
                brandContext = parts.join('. ') + '.';
                console.log(`Using brand context for prompts: ${brand.name}`);
            }
        }

        // Resolve template context
        let templateContext: string | undefined;
        if (templateId) {
            const template = templates.find((t: any) => t.id === templateId);
            if (template) {
                templateContext = template.structure;
                console.log(`Using template context for prompts: ${template.name}`);
            }
        }

        let prompts;
        if (useVideo) {
            prompts = await generateProVideoPrompts(script, topic, brandContext, templateContext);
        } else {
            prompts = await generateProImagePrompts(script, topic, brandContext, templateContext);
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
