import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { loadConfig, saveConfig, configPath, loadUsers, saveUsers, loadAIConfig, isConfigWritable } from './lib/config.ts';
import { getPosts, getPost, savePost } from './lib/posts.ts';
import { AIServiceFactory } from './lib/ai-service.ts';

import dotenv from 'dotenv';
dotenv.config();

import multer from 'multer';
import sharp from 'sharp';

import sanitizeHtml from 'sanitize-html';

const app = express();
export { app };
// Parse command line arguments for --port
let cliPort: number | null = null;
const portArgIndex = process.argv.indexOf('--port') !== -1 ? process.argv.indexOf('--port') : process.argv.indexOf('-p');
if (portArgIndex !== -1 && process.argv.length > portArgIndex + 1) {
    const p = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(p)) {
        cliPort = p;
        console.log(`[INFO] Port specified via CLI: ${cliPort}`);
    }
}

const config = loadConfig();
const PORT = cliPort || config.service?.port || process.env.PORT || 5173;
const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

// Ensure storage directories exist
const configDir = path.dirname(configPath());
const postsDir = path.resolve(configDir, config.postsDir);
const imagesDir = path.join(postsDir, 'images');

if (!fs.existsSync(postsDir)) {
    console.log(`[INFO] Creating posts directory: ${postsDir}`);
    fs.mkdirSync(postsDir, { recursive: true });
} else {
    console.log(`[INFO] Using existing posts directory: ${postsDir}`);
}

if (!fs.existsSync(imagesDir)) {
    console.log(`[INFO] Creating images directory: ${imagesDir}`);
    fs.mkdirSync(imagesDir, { recursive: true });
} else {
    console.log(`[INFO] Using existing images directory: ${imagesDir}`);
}

// Configure Multer for image uploads (to memory first, then processed by sharp)
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// Extend Request to include user and file
interface AuthenticatedRequest extends Request {
    user?: any;
    file?: any;
}

// Routes

// Auth middleware
const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) {
            console.error(`[AUTH] JWT verification failed: ${err.message}`);
            return res.status(403).json({ message: 'Failed to authenticate token' });
        }
        req.user = decoded;
        next();
    });
};

// Login
app.post('/api/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    const usersConfig = loadUsers();

    console.log(`[AUTH] Login attempt for user: ${username}`);

    // Check admin
    if (username === usersConfig.admin.username) {
        const match = await bcrypt.compare(password, usersConfig.admin.passwordHash);
        if (match) {
            console.log(`[AUTH] Admin login successful: ${username}`);
            const token = jwt.sign({ username: usersConfig.admin.username, role: usersConfig.admin.role }, SECRET, { expiresIn: '24h' });
            return res.json({ 
                token, 
                role: usersConfig.admin.role, 
                username: usersConfig.admin.username,
                theme: usersConfig.admin.theme 
            });
        }
    }

    // Check other users
    const user = usersConfig.users.find(u => u.username === username);
    if (user) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (match) {
            console.log(`[AUTH] User login successful: ${username}`);
            const token = jwt.sign({ username: user.username, role: user.role }, SECRET, { expiresIn: '24h' });
            return res.json({ 
                token, 
                role: user.role, 
                username: user.username,
                theme: user.theme 
            });
        }
    }

    console.warn(`[AUTH] Login failed for user: ${username}`);
    res.status(401).json({ message: 'Invalid credentials' });
});

// Admin: Get all users
app.get('/api/admin/users', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const usersConfig = loadUsers();
    const users = [
        { username: usersConfig.admin.username, role: usersConfig.admin.role },
        ...usersConfig.users.map(u => ({ username: u.username, role: u.role }))
    ];
    res.json(users);
});

// Admin: Create user
app.post('/api/admin/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    const { username, password, role } = req.body;
    
    const cleanUsername = sanitizeHtml(username, { allowedTags: [], allowedAttributes: {} });
    const cleanRole = sanitizeHtml(role, { allowedTags: [], allowedAttributes: {} });

    const usersConfig = loadUsers();

    if (usersConfig.users.find(u => u.username === cleanUsername) || usersConfig.admin.username === cleanUsername) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    usersConfig.users.push({ username: cleanUsername, passwordHash, role: cleanRole });
    saveUsers(usersConfig);

    console.log(`[INFO] New user created: ${cleanUsername} with role ${cleanRole}`);
    res.json({ message: 'User created' });
});

// Admin: Delete user
app.delete('/api/admin/users/:username', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const username = req.params.username;
    const usersConfig = loadUsers();

    if (username === usersConfig.admin.username) {
        return res.status(400).json({ message: 'Cannot delete primary admin' });
    }

    const initialLen = usersConfig.users.length;
    usersConfig.users = usersConfig.users.filter(u => u.username !== username);

    if (usersConfig.users.length === initialLen) {
        return res.status(404).json({ message: 'User not found' });
    }

    saveUsers(usersConfig);
    console.log(`[INFO] User deleted: ${username}`);
    res.json({ message: 'User deleted' });
});

// Get posts
app.get('/api/posts', (_req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const posts = getPosts(postsDir);
    res.json(posts);
});

// AI: Summarize post content
app.post('/api/ai/summarize', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const aiConfig = loadAIConfig();
    if (!aiConfig?.enabled) {
        return res.status(403).json({ message: 'AI features are disabled' });
    }
    const { content, provider: overrideProvider, baseUrl: overrideBaseUrl, modelId: overrideModelId } = req.body;
    if (!content) return res.status(400).json({ message: 'No content provided' });

    const provider = (overrideProvider || aiConfig?.provider) as 'ollama' | 'openai';
    const baseUrl = overrideBaseUrl || aiConfig?.baseUrl;
    const modelId = overrideModelId || aiConfig?.modelId;

    if (!provider || !baseUrl || !modelId) {
        return res.status(503).json({ message: 'AI configuration not found' });
    }

    try {
        const service = AIServiceFactory.create(provider, { 
            baseUrl, 
            modelId, 
            apiKey: aiConfig?.apiKey 
        });
        const summary = await service.summarize(content);
        res.json({ summary });
    } catch (error: any) {
        console.error('AI Summarization failed:', error.message);
        res.status(500).json({ message: error.message || 'Failed to summarize content via proxy' });
    }
});

// AI: Fetch available models
app.get('/api/ai/models', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const aiConfig = loadAIConfig();
    if (!aiConfig?.enabled) {
        return res.status(403).json({ message: 'AI features are disabled' });
    }
    const provider = (req.query.provider as string || aiConfig?.provider) as 'ollama' | 'openai';
    const baseUrl = req.query.baseUrl as string || aiConfig?.baseUrl;

    console.log(`[AI] Fetching models via proxy. Provider: ${provider}, BaseURL: ${baseUrl}`);

    if (!provider || !baseUrl) {
        console.warn('[AI] Missing provider or baseUrl');
        return res.status(400).json({ message: 'AI provider and Base URL are required' });
    }

    try {
        const service = AIServiceFactory.create(provider, { 
            baseUrl, 
            modelId: '', // modelId not needed for getting models
            apiKey: req.query.apiKey as string || aiConfig?.apiKey 
        });
        const models = await service.getModels();
        console.log(`[AI] Successfully fetched ${models.length} models`);
        res.json(models);
    } catch (error: any) {
        console.error('Failed to fetch models via proxy:', error.message);
        res.status(500).json({ message: 'Failed to fetch models via proxy: ' + error.message });
    }
});

// Get single post
app.get('/api/posts/:slug', (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const slug = req.params.slug as string;
    const post = getPost(postsDir, slug);
    
    if (!post) {
        return res.status(404).json({ message: 'Post not found' });
    }

    res.json(post);
});

// Create/Update post (Contributor or Admin)
app.post('/api/posts', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const { slug, title, content, summary, date } = req.body;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    
    savePost(postsDir, {
        slug,
        title,
        content,
        summary,
        date,
        author: req.user.username
    });

    res.json({ message: 'Post saved' });
});

// Serve images
app.get('/api/images/:filename', (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const filename = decodeURIComponent(req.params.filename as string);
    const filePath = path.resolve(imagesDir, filename);

    // Security check: ensure the resolved path is still within imagesDir
    if (!filePath.startsWith(path.resolve(imagesDir))) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for filename: ${filename}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.warn(`[WARN] Image not found: ${filePath}`);
        res.status(404).json({ message: 'Image not found' });
    }
});

// Serve static frontend files in production
const distPath = path.resolve(__dirname, '../dist');
console.log(`[INFO] Dist path: ${distPath} (exists: ${fs.existsSync(distPath)})`);
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// Get site config
app.get('/api/config', (_req: Request, res: Response) => {
    const config = loadConfig();
    res.json({
        siteName: config.siteName || 'Generic Blog',
        currentTheme: config.currentTheme,
        pagination: config.pagination || 10,
        sortBy: config.sortBy || 'date',
        sortOrder: config.sortOrder || 'desc',
        searchPlacement: config.searchPlacement || 'top',
        aiConfig: config.aiConfig,
        service: config.service || { port: 3001 }
    });
});

// Admin: Update AI config
app.post('/api/admin/ai-config', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const { enabled, provider, baseUrl, apiKey, modelId } = req.body;

    config.aiConfig = {
        enabled: !!enabled,
        provider: provider === 'openai' ? 'openai' : 'ollama',
        baseUrl: sanitizeHtml(baseUrl || '', { allowedTags: [], allowedAttributes: {} }),
        apiKey: sanitizeHtml(apiKey || '', { allowedTags: [], allowedAttributes: {} }),
        modelId: sanitizeHtml(modelId || '', { allowedTags: [], allowedAttributes: {} })
    };

    saveConfig(config);
    res.json({ message: 'AI Configuration updated' });
});

// Admin: Delete image
app.delete('/api/admin/images/:filename', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'contributor') return res.status(403).json({ message: 'Forbidden' });
    
    // We use req.params.filename which express might have already decoded, 
    // but we also check the raw URL if needed. 
    // However, the issue is likely that express doesn't match "../" in a param if it's not encoded or if it's treated as part of the path.
    // Let's use a more robust check on the param itself.
    const filename = decodeURIComponent(req.params.filename as string);
    
    // Sanity check: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for filename: ${filename}`);
        return res.status(400).json({ message: 'Invalid filename' });
    }

    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const filePath = path.join(imagesDir, filename);

    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`[INFO] Image deleted: ${filename}`);
            res.json({ message: 'Image deleted' });
        } catch (error: any) {
            console.error(`[ERROR] Failed to delete image ${filename}:`, error.message);
            res.status(500).json({ message: 'Failed to delete image' });
        }
    } else {
        console.warn(`[WARN] Image deletion failed, not found: ${filePath}`);
        res.status(404).json({ message: 'Image not found' });
    }
});

// Admin: Update site config
app.post('/api/admin/config', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const { siteName, currentTheme, pagination, sortBy, sortOrder, searchPlacement, aiConfig, service } = req.body;

    if (siteName) config.siteName = sanitizeHtml(siteName, { allowedTags: [], allowedAttributes: {} });
    if (currentTheme) config.currentTheme = sanitizeHtml(currentTheme, { allowedTags: [], allowedAttributes: {} });
    if (pagination !== undefined) config.pagination = Number(pagination);
    if (sortBy) config.sortBy = sanitizeHtml(sortBy, { allowedTags: [], allowedAttributes: {} }) as 'title' | 'date' | 'author';
    if (sortOrder) config.sortOrder = sanitizeHtml(sortOrder, { allowedTags: [], allowedAttributes: {} }) as 'desc' | 'asc';
    if (searchPlacement) config.searchPlacement = sanitizeHtml(searchPlacement, { allowedTags: [], allowedAttributes: {} }) as 'top' | 'bottom' | 'left' | 'right' | 'none';
    
    if (aiConfig) {
        config.aiConfig = {
            enabled: !!aiConfig.enabled,
            provider: aiConfig.provider === 'openai' ? 'openai' : 'ollama',
            baseUrl: sanitizeHtml(aiConfig.baseUrl || '', { allowedTags: [], allowedAttributes: {} }),
            apiKey: sanitizeHtml(aiConfig.apiKey || '', { allowedTags: [], allowedAttributes: {} }),
            modelId: sanitizeHtml(aiConfig.modelId || '', { allowedTags: [], allowedAttributes: {} })
        };
    }

    if (service) {
        config.service = {
            port: Number(service.port) || 3001
        };
    }

    saveConfig(config);
    
    // Also update the theme if it changed
    if (currentTheme) {
        const configDir = path.dirname(configPath());
        const themeDir = path.resolve(configDir, config.themeDir);
        const themePath = path.join(themeDir, `${currentTheme}.json`);
        if (!fs.existsSync(themePath)) {
            // Create default theme if it doesn't exist
            if (!fs.existsSync(themeDir)) fs.mkdirSync(themeDir, { recursive: true });
            if (currentTheme === 'dark') {
                fs.writeFileSync(themePath, JSON.stringify({
                    "--primary": "#3b82f6",
                    "--secondary": "#1f2937",
                    "--accent": "#ef4444",
                    "--text": "#f3f4f6",
                    "--bg": "#111827"
                }, null, 2));
            } else if (currentTheme === 'light') {
                fs.writeFileSync(themePath, JSON.stringify({
                    "--primary": "#2563eb",
                    "--secondary": "#f3f4f6",
                    "--accent": "#ef4444",
                    "--text": "#111827",
                    "--bg": "#ffffff"
                }, null, 2));
            } else {
                fs.writeFileSync(themePath, JSON.stringify({
                    "--primary": "#2563eb",
                    "--secondary": "#f3f4f6",
                    "--accent": "#ef4444",
                    "--text": "#111827",
                    "--bg": "#ffffff"
                }, null, 2));
            }
        }
    }

    res.json({ message: 'Configuration updated' });
});

// Admin: Get all themes
app.get('/api/admin/themes', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    // Strictly only light and dark themes are allowed
    res.json(['light', 'dark']);
});

// Admin: Update theme
app.post('/api/admin/themes/:name', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const name = req.params.name;
    
    if (name !== 'light' && name !== 'dark') {
        return res.status(400).json({ message: 'Only light and dark themes can be modified' });
    }

    const colors = req.body;
    
    // Basic validation and sanitization of theme colors
    const sanitizedColors: any = {};
    for (const [key, value] of Object.entries(colors)) {
        if (key.startsWith('--') && typeof value === 'string') {
            sanitizedColors[key] = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
        }
    }

    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);

    if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
    }

    fs.writeFileSync(path.join(themeDir, `${name}.json`), JSON.stringify(sanitizedColors, null, 2));
    res.json({ message: `Theme ${name} saved` });
});

// Admin: Delete post
app.delete('/api/posts/:slug', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'contributor') return res.status(403).json({ message: 'Forbidden' });
    const slug = req.params.slug;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const postPath = path.join(postsDir, `${slug}.md`);

    if (fs.existsSync(postPath)) {
        fs.unlinkSync(postPath);
        res.json({ message: 'Post deleted' });
    } else {
        res.status(404).json({ message: 'Post not found' });
    }
});

// Image upload (with WebP conversion and renaming)
app.post('/api/admin/upload', authenticate, upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    try {
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');

        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        // Generate a new filename: timestamp-random.webp
        const newFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;
        const outputPath = path.join(imagesDir, newFilename);

        // Convert to WebP using sharp
        // We use animated: true to preserve animations if it's a GIF/WebP already
        await sharp(req.file.buffer, { animated: true })
            .webp({ effort: 4 }) // Effort 4 is a good balance
            .toFile(outputPath);

        console.log(`[INFO] Image uploaded and converted to WebP: ${newFilename}`);
        res.json({ filename: newFilename, url: `/api/images/${newFilename}` });
    } catch (error) {
        console.error('[ERROR] Image processing failed:', error);
        res.status(500).json({ message: 'Image processing failed' });
    }
});

// Get all images
app.get('/api/admin/images', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'contributor') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');

    if (!fs.existsSync(imagesDir)) return res.json([]);
    const files = fs.readdirSync(imagesDir);
    res.json(files);
});

// Theme support (just returns css variables)
app.get('/api/admin/config-status', authenticate, (_req: AuthenticatedRequest, res: Response) => {
    if (_req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    res.json({ isWritable: isConfigWritable() });
});

app.get('/api/theme', (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);
    const themeName = (req.query.name as string) || config.currentTheme;
    const themePath = path.join(themeDir, `${themeName}.json`);
    
    if (fs.existsSync(themePath)) {
        try {
            res.json(JSON.parse(fs.readFileSync(themePath, 'utf8')));
        } catch (e) {
            console.error(`Error reading theme file ${themePath}:`, e);
            res.status(500).json({ message: 'Error reading theme file' });
        }
    } else if (themeName === 'dark') {
        res.json({
            "--primary": "#3b82f6",
            "--secondary": "#1f2937",
            "--accent": "#ef4444",
            "--text": "#f3f4f6",
            "--bg": "#111827"
        });
    } else {
        // Default to light
        res.json({
            "--primary": "#2563eb",
            "--secondary": "#f3f4f6",
            "--accent": "#ef4444",
            "--text": "#111827",
            "--bg": "#ffffff"
        });
    }
});

app.post('/api/theme', (req: Request, res: Response) => {
    const { currentTheme } = req.body;
    if (!currentTheme) return res.status(400).json({ message: 'currentTheme required' });
    
    // Try to get user from token if available
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.verify(token, SECRET) as any;
            if (decoded && decoded.username) {
                const usersConfig = loadUsers();
                
                // If user is Admin, update global config as well
                if (usersConfig.admin.username === decoded.username) {
                    usersConfig.admin.theme = currentTheme;
                    saveUsers(usersConfig);
                    
                    const config = loadConfig();
                    config.currentTheme = currentTheme;
                    saveConfig(config);
                    
                    console.log(`[INFO] Admin updated global theme to: ${currentTheme}`);
                    return res.json({ message: 'Global and Admin theme updated', currentTheme });
                }
                
                const userIndex = usersConfig.users.findIndex(u => u.username === decoded.username);
                if (userIndex !== -1) {
                    usersConfig.users[userIndex].theme = currentTheme;
                    saveUsers(usersConfig);
                    return res.json({ message: 'User theme updated', currentTheme });
                }
            }
        } catch (err) {
            // Token invalid or expired, fall back to global config
        }
    }

    const config = loadConfig();
    config.currentTheme = currentTheme;
    saveConfig(config);
    res.json({ message: 'Global theme updated', currentTheme });
});

if (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
