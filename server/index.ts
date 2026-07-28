import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import sanitizeHtml from 'sanitize-html';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { loadConfig, saveConfig, configPath, loadUsers, saveUsers, loadAIConfig, isConfigWritable } from './lib/config.ts';
import { getPosts, getPost, savePost } from './lib/posts.ts';
import { AIServiceFactory } from './lib/ai-service.ts';
import { calculateMD5, loadManifest, saveManifest, findDuplicate, findByName } from './lib/images.ts';
import { runPreflight } from './lib/preflight.ts';
import { PublicConfigBuilder } from './lib/public-config.ts';
import { JwtSecretFactory, JwtSecretError, INSECURE_DEFAULT_JWT_SECRET } from './lib/jwt-secret.ts';
import { isSafePath } from './lib/safe-path.ts';
import { createDefaultImageUpload } from './lib/upload-options.ts';
import { RoleGuardFactory, AuthenticatedRequest, isAllowedRole } from './middleware/auth.ts';

const app = express();
app.set('trust proxy', 1);
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

// Run pre-flight check
const preflightIssues = await runPreflight(process.stdout.isTTY);
if (preflightIssues.some(i => i.critical && !i.fixed) && !process.env.VITEST) {
    console.error('[FATAL] Pre-flight check failed with critical issues. Application cannot start.');
    process.exit(1);
}

let activeConfig = loadConfig();
const PORT = cliPort || activeConfig.service?.port || process.env.PORT || 5173;

// JwtSecretFactory: INV-SEC-2 — production never uses insecure default
let SECRET: string;
try {
    const jwt = JwtSecretFactory.forMode()
        .fromEnv(process.env.JWT_SECRET)
        .fromConfig(activeConfig)
        .create();
    SECRET = jwt.secret;
    if (!jwt.secure && !process.env.VITEST) {
        console.warn(`[WARN] JWT secret is insecure (source=${jwt.source}). Set JWT_SECRET for production.`);
    }
} catch (e) {
    if (e instanceof JwtSecretError) {
        console.error(`[FATAL] ${e.message}`);
        if (!process.env.VITEST) process.exit(1);
        SECRET = INSECURE_DEFAULT_JWT_SECRET; // unreachable in production; tests may mock
    } else {
        throw e;
    }
}

// UploadOptionsBuilder → multer with size/MIME policy
const upload = createDefaultImageUpload();
const guards = new RoleGuardFactory(SECRET);
const authenticate = guards.authenticate();
const requireAdmin = guards.requireAdmin();
const requireWriter = guards.requireContributorOrAdmin();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "https:"],
            "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for some dev builds/vite
            "connect-src": ["'self'", "https://api.openai.com", "http://localhost:*"], // Allow AI APIs and local Ollama
        },
    },
}));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: activeConfig.security?.apiRateLimitWindow || 15 * 60 * 1000,
    limit: () => activeConfig.security?.apiRateLimitMax || 100,
    message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { ip: false },
});

const loginLimiter = rateLimit({
    windowMs: activeConfig.security?.loginRateLimitWindow || 15 * 60 * 1000,
    limit: () => activeConfig.security?.loginRateLimitMax || 10,
    message: { message: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { ip: false },
});

app.use(cors());
app.use(express.json());

// Apply general limiter to all API routes
app.use('/api/', apiLimiter);

// Routes

// Login
app.post('/api/login', loginLimiter, async (req: Request, res: Response) => {
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
app.get('/api/admin/users', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const usersConfig = loadUsers();
    const users = [
        { username: usersConfig.admin.username, role: usersConfig.admin.role },
        ...usersConfig.users.map(u => ({ username: u.username, role: u.role }))
    ];
    res.json(users);
});

// Admin: Create user
app.post('/api/admin/users', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { username, password, role } = req.body;
    
    const cleanUsername = sanitizeHtml(username, { allowedTags: [], allowedAttributes: {} });
    if (!isAllowedRole(role)) {
        return res.status(400).json({ message: 'Invalid role; allowed: admin, contributor' });
    }
    const cleanRole = role;

    if (!password || String(password).length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

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
app.delete('/api/admin/users/:username', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
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
app.get('/api/posts', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').toLowerCase();
    if (query && activeConfig.security?.disablePublicSearch) {
        return res.status(403).json({ message: 'Search is disabled by security policy' });
    }
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const posts = getPosts(postsDir, {
        sortBy: config.sortBy as 'title' | 'date' | 'author' || 'date',
        sortOrder: config.sortOrder as 'asc' | 'desc' || 'desc'
    });

    const limit = parseInt(req.query.limit as string);
    const offset = parseInt(req.query.offset as string);

    if (!isNaN(limit) || !isNaN(offset)) {
        const l = isNaN(limit) ? (config.pagination || 10) : limit;
        const o = isNaN(offset) ? 0 : offset;
        
        return res.json({
            posts: posts.slice(o, o + l),
            total: posts.length,
            limit: l,
            offset: o
        });
    }

    res.json(posts);
});

// AI: Summarize post content
app.post('/api/ai/summarize', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const aiConfig = loadAIConfig();
    if (!aiConfig?.enabled || activeConfig.security?.disableAI) {
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

// AI: Enhance post content
app.post('/api/ai/enhance', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const aiConfig = loadAIConfig();
    if (!aiConfig?.enabled || activeConfig.security?.disableAI) {
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
        const enhanced = await service.enhance(content);
        res.json({ enhanced });
    } catch (error: any) {
        console.error('AI Enhancement failed:', error.message);
        res.status(500).json({ message: error.message || 'Failed to enhance content via proxy' });
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
            apiKey: aiConfig?.apiKey // never accept API keys via query string
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
    
    // Security check: prevent directory traversal
    const postPath = path.join(postsDir, `${slug}.md`);
    if (!isSafePath(postsDir, postPath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for slug: ${slug}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    const post = getPost(postsDir, slug);
    
    if (!post) {
        return res.status(404).json({ message: 'Post not found' });
    }

    res.json(post);
});

// Create/Update post (Contributor or Admin)
app.post('/api/posts', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const { slug, title, content, summary, date, pinned } = req.body;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    
    // Security check: prevent directory traversal
    const postPath = path.join(postsDir, `${slug}.md`);
    if (!isSafePath(postsDir, postPath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for slug: ${slug}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    savePost(postsDir, {
        slug,
        title,
        content,
        summary,
        date,
        pinned,
        author: req.user.username
    });

    res.json({ message: 'Post saved' });
});

// Proxy images through a common endpoint
app.get(['/api/getimage', '/api/images/:filename'], (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    
    // Support both query param (preferred) and route param (legacy)
    const filenameRaw = (req.query.fileName as string) || (req.params.filename as string) || '';
    const filename = filenameRaw ? decodeURIComponent(filenameRaw) : '';
    
    if (!filename) {
        return res.status(400).json({ message: 'No filename provided' });
    }

    const filePath = path.join(imagesDir, filename);

    // Security check: ensure the resolved path is still within imagesDir
    if (!isSafePath(imagesDir, filePath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for filename: ${filename}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(filePath)) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
                res.sendFile(filename, { root: imagesDir }, (err) => {
                    if (err) {
                        console.error(`[ERROR] Failed to send image ${filename}:`, err);
                        if (!res.headersSent) {
                            res.status(404).json({ message: 'Image not found' });
                        }
                    }
                });
            } else {
                console.warn(`[WARN] Not a file: ${filePath}`);
                res.status(404).json({ message: 'Image not found' });
            }
        } catch (error: any) {
            console.error(`[ERROR] File access error for ${filename}:`, error.message);
            res.status(500).json({ message: 'Error accessing image' });
        }
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
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile('index.html', { root: distPath }, (err) => {
                if (err) {
                    console.error('[ERROR] Failed to send index.html:', err);
                    if (!res.headersSent) {
                        res.status(404).send('Not Found');
                    }
                }
            });
        } else {
            res.status(404).send('Not Found');
        }
    });
}

// Health probe for FreeBSD service / regression (no secrets)
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
        ok: true,
        version: process.env.npm_package_version || '1.0.0',
        env: process.env.NODE_ENV || 'development'
    });
});

// Get site config — PublicConfigBuilder enforces INV-SEC-1 (no secrets)
app.get('/api/config', (_req: Request, res: Response) => {
    const config = loadConfig();
    res.json(PublicConfigBuilder.from(config).build());
});

// Admin: Update AI config
app.post('/api/admin/ai-config', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const config = loadConfig();
    const { enabled, provider, baseUrl, apiKey, modelId } = req.body;
    // Empty apiKey means "keep existing" so public config redaction cannot wipe secrets
    const previousKey = config.aiConfig?.apiKey || '';
    const nextKey = typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : previousKey;

    config.aiConfig = {
        enabled: !!enabled,
        provider: provider === 'openai' ? 'openai' : 'ollama',
        baseUrl: sanitizeHtml(baseUrl || '', { allowedTags: [], allowedAttributes: {} }),
        apiKey: nextKey,
        modelId: sanitizeHtml(modelId || '', { allowedTags: [], allowedAttributes: {} })
    };

    saveConfig(config);
    activeConfig = config;
    res.json({ message: 'AI Configuration updated' });
});

// Admin: Delete image
app.delete('/api/admin/images/:filename', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const filename = decodeURIComponent(req.params.filename as string);
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const filePath = path.join(imagesDir, filename);

    if (!isSafePath(imagesDir, filePath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for filename: ${filename}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            
            // Also remove from manifest if it exists
            const manifest = loadManifest(imagesDir);
            if (manifest[filename]) {
                delete manifest[filename];
                saveManifest(imagesDir, manifest);
            }

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

// Admin: Bulk delete images
app.post('/api/admin/images/delete-bulk', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ message: 'filenames must be an array' });

    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const manifest = loadManifest(imagesDir);
    
    let deletedCount = 0;
    const errors: string[] = [];

    for (const filename of filenames) {
        const filePath = path.join(imagesDir, filename);
        if (!isSafePath(imagesDir, filePath)) {
            errors.push(`${filename}: Invalid path`);
            continue;
        }

        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                if (manifest[filename]) {
                    delete manifest[filename];
                }
                deletedCount++;
            } catch (error: any) {
                errors.push(`${filename}: ${error.message}`);
            }
        } else {
            errors.push(`${filename}: Not found`);
        }
    }

    saveManifest(imagesDir, manifest);
    res.json({ message: `Deleted ${deletedCount} images`, deletedCount, errors });
});

// Admin: Update site config
app.post('/api/admin/config', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const config = loadConfig();
    const { siteName, siteLogo, currentTheme, pagination, sortBy, sortOrder, searchPlacement, aiConfig, service, security } = req.body;

    if (siteName) config.siteName = sanitizeHtml(siteName, { allowedTags: [], allowedAttributes: {} });
    if (siteLogo !== undefined) config.siteLogo = sanitizeHtml(siteLogo || 'logo.webp', { allowedTags: [], allowedAttributes: {} });
    if (currentTheme) config.currentTheme = sanitizeHtml(currentTheme, { allowedTags: [], allowedAttributes: {} });
    if (pagination !== undefined) config.pagination = Number(pagination);
    if (sortBy) config.sortBy = sanitizeHtml(sortBy, { allowedTags: [], allowedAttributes: {} }) as 'title' | 'date' | 'author';
    if (sortOrder) config.sortOrder = sanitizeHtml(sortOrder, { allowedTags: [], allowedAttributes: {} }) as 'desc' | 'asc';
    if (searchPlacement) config.searchPlacement = sanitizeHtml(searchPlacement, { allowedTags: [], allowedAttributes: {} }) as 'top' | 'bottom' | 'left' | 'right' | 'none';
    
    if (aiConfig) {
        const previousKey = config.aiConfig?.apiKey || '';
        const nextKey =
            typeof aiConfig.apiKey === 'string' && aiConfig.apiKey.length > 0
                ? aiConfig.apiKey
                : previousKey;
        config.aiConfig = {
            enabled: !!aiConfig.enabled,
            provider: aiConfig.provider === 'openai' ? 'openai' : 'ollama',
            baseUrl: sanitizeHtml(aiConfig.baseUrl || '', { allowedTags: [], allowedAttributes: {} }),
            apiKey: nextKey,
            modelId: sanitizeHtml(aiConfig.modelId || '', { allowedTags: [], allowedAttributes: {} })
        };
    }

    if (service) {
        config.service = {
            port: Number(service.port) || 3001
        };
    }

    if (security) {
        config.security = {
            apiRateLimitWindow: Number(security.apiRateLimitWindow) || 15 * 60 * 1000,
            apiRateLimitMax: Number(security.apiRateLimitMax) || 100,
            loginRateLimitWindow: Number(security.loginRateLimitWindow) || 15 * 60 * 1000,
            loginRateLimitMax: Number(security.loginRateLimitMax) || 10,
            disableAI: !!security.disableAI,
            disableImages: !!security.disableImages,
            disablePublicSearch: !!security.disablePublicSearch
        };
    }

    saveConfig(config);
    activeConfig = config;
    
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
                    "--accent": "#3a297a",
                    "--text": "#f3f4f6",
                    "--bg": "#111827",
                    "--border": "#374151",
                    "--hover": "#1f2937",
                    "--site-name-color": "#3b82f6"
                }, null, 2));
            } else if (currentTheme === 'light') {
                fs.writeFileSync(themePath, JSON.stringify({
                    "--primary": "#2563eb",
                    "--secondary": "#f3f4f6",
                    "--accent": "#ef4444",
                    "--text": "#111827",
                    "--bg": "#ffffff",
                    "--border": "#e5e7eb",
                    "--hover": "#f3f4f6",
                    "--site-name-color": "#2563eb"
                }, null, 2));
            } else {
                fs.writeFileSync(themePath, JSON.stringify({
                    "--primary": "#2563eb",
                    "--secondary": "#f3f4f6",
                    "--accent": "#ef4444",
                    "--text": "#111827",
                    "--bg": "#ffffff",
                    "--border": "#e5e7eb",
                    "--hover": "#f3f4f6",
                    "--site-name-color": "#2563eb"
                }, null, 2));
            }
        }
    }

    res.json({ message: 'Configuration updated' });
});

// Admin: Get all themes
app.get('/api/admin/themes', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    // Strictly only light and dark themes are allowed
    res.json(['light', 'dark']);
});

// Admin: Update theme
app.post('/api/admin/themes/:name', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
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
app.delete('/api/posts/:slug', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const slug = req.params.slug;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const postPath = path.join(postsDir, `${slug}.md`);

    if (!isSafePath(postsDir, postPath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for slug: ${slug}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(postPath)) {
        fs.unlinkSync(postPath);
        res.json({ message: 'Post deleted' });
    } else {
        res.status(404).json({ message: 'Post not found' });
    }
});

// Image upload (with WebP conversion and renaming)
app.post('/api/admin/upload', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    upload.single('image')(req, res, (err: unknown) => {
        if (err) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            return res.status(400).json({ message });
        }
        next();
    });
}, async (req: AuthenticatedRequest, res: Response) => {
    if (activeConfig.security?.disableImages) {
        return res.status(403).json({ message: 'Image uploads are disabled by security policy' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    try {
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');

        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const manifest = loadManifest(imagesDir);
        const md5 = calculateMD5(req.file.buffer);
        const size = req.file.size;
        const originalName = req.file.originalname;
        const force = req.query.force === 'true';

        // 1. Check for content duplication
        const duplicate = findDuplicate(manifest, md5, size);
        if (duplicate) {
            // Verify the file actually exists on disk
            const existingPath = path.join(imagesDir, duplicate.filename);
            if (fs.existsSync(existingPath)) {
                console.log(`[INFO] Duplicate image upload detected: ${duplicate.filename} (Original: ${duplicate.originalName})`);
                return res.json({ 
                    filename: duplicate.filename, 
                    url: `/api/getimage?fileName=${duplicate.filename}`,
                    duplicated: true,
                    message: 'Image already exists'
                });
            } else {
                // File missing on disk, remove from manifest and proceed
                delete manifest[duplicate.filename];
            }
        }

        // 2. Check for name conflict (different content but same original name)
        const nameConflict = findByName(manifest, originalName);
        if (nameConflict && !force) {
            // Verify conflict file actually exists
            if (fs.existsSync(path.join(imagesDir, nameConflict.filename))) {
                console.log(`[INFO] Image name conflict detected: ${originalName}`);
                return res.status(409).json({ 
                    message: `An image with the name "${originalName}" already exists but has different content.`,
                    conflict: true,
                    existingFilename: nameConflict.filename
                });
            } else {
                delete manifest[nameConflict.filename];
            }
        }

        // Generate a new filename: timestamp-random.webp
        const newFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;
        const outputPath = path.join(imagesDir, newFilename);

        // Convert to WebP using sharp
        // We use animated: true to preserve animations if it's a GIF/WebP already
        await sharp(req.file.buffer, { animated: true })
            .webp({ effort: 4 }) // Effort 4 is a good balance
            .toFile(outputPath);

        // Update manifest
        manifest[newFilename] = {
            filename: newFilename,
            originalName,
            md5,
            size,
            uploadedAt: Date.now()
        };
        saveManifest(imagesDir, manifest);

        console.log(`[INFO] Image uploaded and converted to WebP: ${newFilename}`);
        res.json({ filename: newFilename, url: `/api/getimage?fileName=${newFilename}` });
    } catch (error) {
        console.error('[ERROR] Image processing failed:', error);
        res.status(500).json({ message: 'Image processing failed' });
    }
});

// Get images with pagination
app.get('/api/admin/images', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');

    if (!fs.existsSync(imagesDir)) return res.json({ images: [], total: 0 });
    
    try {
        const manifest = loadManifest(imagesDir);
        const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
        
        // Get files and map to metadata objects, excluding the manifest itself
        const files = entries
            .filter(entry => entry.isFile() && entry.name !== 'metadata.json')
            .map(entry => {
                const name = entry.name;
                // If it's in the manifest, use that. Otherwise, synthesize basic info.
                return manifest[name] || {
                    filename: name,
                    originalName: name,
                    uploadedAt: fs.statSync(path.join(imagesDir, name)).mtimeMs
                };
            })
            // Sort by upload date (newest first)
            .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
        
        const total = files.length;
        const limit = req.query.limit === 'all' ? total : parseInt(req.query.limit as string || '30');
        const offset = parseInt(req.query.offset as string || '0');
        
        const paginatedFiles = req.query.limit === 'all' ? files : files.slice(offset, offset + limit);
        
        res.json({ images: paginatedFiles, total });
    } catch (error: any) {
        console.error('[ERROR] Failed to list images:', error.message);
        res.status(500).json({ message: 'Failed to list images' });
    }
});

// Theme support (just returns css variables)
app.get('/api/admin/config-status', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
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
            "--accent": "#3a297a",
            "--text": "#f3f4f6",
            "--bg": "#111827",
            "--border": "#374151",
            "--hover": "#1f2937",
            "--site-name-color": "#3b82f6"
        });
    } else {
        // Default to light
        res.json({
            "--primary": "#2563eb",
            "--secondary": "#f3f4f6",
            "--accent": "#ef4444",
            "--text": "#111827",
            "--bg": "#ffffff",
            "--border": "#e5e7eb",
            "--hover": "#f3f4f6",
            "--site-name-color": "#2563eb"
        });
    }
});

// Theme write requires auth (INV-AUTH-2: only admin mutates global)
app.post('/api/theme', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const { currentTheme } = req.body;
    if (!currentTheme || (currentTheme !== 'light' && currentTheme !== 'dark')) {
        return res.status(400).json({ message: 'currentTheme must be light or dark' });
    }

    const usersConfig = loadUsers();
    const username = req.user?.username as string | undefined;
    if (!username) return res.status(401).json({ message: 'No token' });

    // Admin updates personal + global theme
    if (req.user.role === 'admin' || usersConfig.admin.username === username) {
        usersConfig.admin.theme = currentTheme;
        saveUsers(usersConfig);
        const config = loadConfig();
        config.currentTheme = currentTheme;
        saveConfig(config);
        activeConfig = config;
        console.log(`[INFO] Admin updated global theme to: ${currentTheme}`);
        return res.json({ message: 'Global and Admin theme updated', currentTheme });
    }

    const userIndex = usersConfig.users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }
    usersConfig.users[userIndex].theme = currentTheme;
    saveUsers(usersConfig);
    res.json({ message: 'User theme updated', currentTheme });
});

if (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
