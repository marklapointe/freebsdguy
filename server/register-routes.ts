/**
 * Route registration factory — attaches all HTTP handlers to the Express app.
 * Keeps server/index.ts as bootstrap only (TAOCP stepwise refinement).
 */
import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sanitizeHtml from 'sanitize-html';
import express from 'express';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, configPath, loadUsers, saveUsers, loadAIConfig, isConfigWritable } from './lib/config.ts';
import { getPosts, getPost, savePost } from './lib/posts.ts';
import { AIServiceFactory } from './lib/ai-service.ts';
import { calculateMD5, loadManifest, saveManifest, findDuplicate, findByName } from './lib/images.ts';
import { PublicConfigBuilder } from './lib/public-config.ts';
import { isSafePath } from './lib/safe-path.ts';
import { isAllowedRole, AuthenticatedRequest } from './middleware/auth.ts';
import type { AppContext } from './lib/app-context.ts';
import {
    isValidThemeId,
    listThemeCatalog,
    listThemeIds,
    loadThemeColors,
    resolveThemeDir,
    themeFilePath
} from './lib/themes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerRoutes(app: Express, ctx: AppContext): void {
    const { secret: SECRET, authenticate, requireAdmin, requireWriter, upload } = ctx;
    const getActive = ctx.getActiveConfig;
    const setActive = ctx.setActiveConfig;

// Routes

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
            // Theme is site-wide (admin Appearance only) — not returned per-user on login
            return res.json({
                token,
                role: usersConfig.admin.role,
                username: usersConfig.admin.username
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
                username: user.username
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
    if (query && getActive().security?.disablePublicSearch) {
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
    if (!aiConfig?.enabled || getActive().security?.disableAI) {
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
    if (!aiConfig?.enabled || getActive().security?.disableAI) {
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
    setActive(config);
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
    try {
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
            // Rate limits are not enforced in-app; only feature toggles are kept.
            config.security = {
                disableAI: !!security.disableAI,
                disableImages: !!security.disableImages,
                disablePublicSearch: !!security.disablePublicSearch
            };
        }

        saveConfig(config);
        setActive(config);

        res.json({ message: 'Configuration updated', currentTheme: config.currentTheme });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to save configuration';
        console.error('[ERROR] POST /api/admin/config:', msg);
        res.status(500).json({ message: msg });
    }
});

const themeDirForConfig = () => {
    const config = loadConfig();
    const raw = config.themeDir || './themes';
    // Absolute themeDir (e.g. /var/db/mdweb/themes) must not be joined under CONFIG_DIR
    const resolved = path.isAbsolute(raw)
        ? raw
        : path.resolve(path.dirname(configPath()), raw);
    return resolveThemeDir(resolved);
};

// Public theme catalog (ids + labels for pickers)
app.get('/api/themes', (_req: Request, res: Response) => {
    res.json(listThemeCatalog(themeDirForConfig()));
});

// Admin: Get all themes (catalog with metadata)
app.get('/api/admin/themes', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    res.json(listThemeCatalog(themeDirForConfig()));
});

// Admin: Update theme colors for any valid theme id
app.post('/api/admin/themes/:name', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const name = String(req.params.name || '');
    if (!isValidThemeId(name)) {
        return res.status(400).json({ message: 'Invalid theme name' });
    }

    const colors = req.body as Record<string, unknown>;
    const sanitizedColors: Record<string, string> = {};
    for (const [key, value] of Object.entries(colors)) {
        if (key.startsWith('--') && typeof value === 'string') {
            sanitizedColors[key] = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
        }
    }
    if (colors.mdEditorTheme === 'light' || colors.mdEditorTheme === 'dark') {
        sanitizedColors.mdEditorTheme = colors.mdEditorTheme;
    }

    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);
    const themePath = themeFilePath(themeDir, name);
    if (!themePath) return res.status(400).json({ message: 'Invalid theme path' });

    if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
    }

    fs.writeFileSync(themePath, JSON.stringify(sanitizedColors, null, 2));
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
    if (getActive().security?.disableImages) {
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

        // Convert to WebP using sharp (lazy-load so FreeBSD can start without native sharp)
        let sharp: typeof import('sharp');
        try {
            sharp = (await import('sharp')).default;
        } catch (e) {
            console.error('[ERROR] sharp unavailable on this platform:', e);
            return res.status(503).json({
                message: 'Image processing unavailable (sharp not built for this platform). Install libvips and rebuild sharp.'
            });
        }
        await sharp(req.file.buffer, { animated: true })
            .webp({ effort: 4 })
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
    const themeDir = themeDirForConfig();
    const themeName = String((req.query.name as string) || config.currentTheme || 'dark');
    const colors = loadThemeColors(themeDir, themeName);
    if (colors) {
        return res.json(colors);
    }
    // Fallback dark palette
    res.json({
        mdEditorTheme: 'dark',
        '--primary': '#3b82f6',
        '--secondary': '#1f2937',
        '--accent': '#3a297a',
        '--text': '#f3f4f6',
        '--bg': '#111827',
        '--border': '#374151',
        '--hover': '#1f2937',
        '--site-name-color': '#3b82f6'
    });
});

// Theme write: admin-only site preference (config.currentTheme only — never per-user)
app.post('/api/theme', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
        const { currentTheme } = req.body;
        if (!currentTheme || typeof currentTheme !== 'string' || !isValidThemeId(currentTheme)) {
            return res.status(400).json({ message: 'currentTheme must be a valid theme id' });
        }

        const config = loadConfig();
        const themeDir = themeDirForConfig();
        const known = listThemeIds(themeDir);
        if (!known.includes(currentTheme) && !loadThemeColors(themeDir, currentTheme)) {
            return res.status(404).json({ message: `Theme not found: ${currentTheme}` });
        }

        config.currentTheme = currentTheme;
        saveConfig(config);
        setActive(config);
        console.log(`[INFO] Admin set site theme to: ${currentTheme}`);
        res.json({ message: 'Site theme updated', currentTheme });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to set theme';
        console.error('[ERROR] POST /api/theme:', msg);
        res.status(500).json({ message: msg });
    }
});


}
