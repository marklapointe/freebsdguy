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
import {
    loadConfig,
    saveConfig,
    configPath,
    loadUsers,
    saveUsers,
    loadAIConfig,
    isConfigWritable,
    getConfigLoadStatus,
    sanitizeConfig,
    resolveAuthMode
} from './lib/config.ts';
import {
    parseCookies,
    sessionCookieHeader,
    clearSessionCookieHeader,
    FileSessionStore
} from './lib/session-store.ts';
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
    loadThemeColorsForMode,
    resolveThemeDir,
    themeFilePath
} from './lib/themes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerRoutes(app: Express, ctx: AppContext): void {
    const { secret: SECRET, authenticate, requireAdmin, requireWriter, upload } = ctx;
    const getActive = ctx.getActiveConfig;
    const setActive = ctx.setActiveConfig;
    const sessionStore = ctx.sessionStore || new FileSessionStore();

    const issueAuthResponse = (
        res: Response,
        identity: { username: string; role: string }
    ) => {
        const cfg = getActive();
        const mode = resolveAuthMode(cfg);
        const ttl = cfg.security?.sessionTtlSeconds || 86400;
        const cookieName = cfg.security?.sessionCookieName || 'mdweb.sid';
        const secure = process.env.MDWEB_TLS === '1';

        if (mode === 'session') {
            sessionStore.purgeExpired();
            const rec = sessionStore.create(identity.username, identity.role, ttl);
            res.setHeader('Set-Cookie', sessionCookieHeader(cookieName, rec.id, ttl, secure));
            return res.json({
                role: identity.role,
                username: identity.username,
                authMode: 'session'
            });
        }

        const token = jwt.sign(
            { username: identity.username, role: identity.role },
            SECRET,
            { expiresIn: '24h' }
        );
        return res.json({
            token,
            role: identity.role,
            username: identity.username,
            authMode: 'jwt'
        });
    };

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
            return issueAuthResponse(res, {
                username: usersConfig.admin.username,
                role: usersConfig.admin.role
            });
        }
    }

    // Check other users
    const user = usersConfig.users.find(u => u.username === username);
    if (user) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (match) {
            console.log(`[AUTH] User login successful: ${username}`);
            return issueAuthResponse(res, { username: user.username, role: user.role });
        }
    }

    console.warn(`[AUTH] Login failed for user: ${username}`);
    res.status(401).json({ message: 'Invalid credentials' });
});

// Logout (both modes)
app.post('/api/logout', (req: Request, res: Response) => {
    const cfg = getActive();
    const cookieName = cfg.security?.sessionCookieName || 'mdweb.sid';
    const secure = process.env.MDWEB_TLS === '1';
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[cookieName];
    if (sid) sessionStore.destroy(sid);
    res.setHeader('Set-Cookie', clearSessionCookieHeader(cookieName, secure));
    res.json({ message: 'Logged out', authMode: resolveAuthMode(cfg) });
});

// Current user (JWT or session)
app.get('/api/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
    res.json({
        username: req.user?.username,
        role: req.user?.role,
        authMode: resolveAuthMode(getActive())
    });
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
    const posts = getPosts(postsDir, {
        sortBy: (config.sortBy as 'title' | 'date' | 'author') || 'date',
        sortOrder: (config.sortOrder as 'asc' | 'desc') || 'desc'
    });

    // Always return paged shape so clients can honor config.pagination
    const defaultLimit = config.pagination || 10;
    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(req.query.offset ?? ''), 10);
    const l = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : defaultLimit;
    const o = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    return res.json({
        posts: posts.slice(o, o + l),
        total: posts.length,
        limit: l,
        offset: o
    });
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
    
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
                /* istanbul ignore next */
                if (err) {
                    console.error('[ERROR] Failed to send index.html:', err);
                    if (!res.headersSent) {
                        res.status(404).send('Not Found');
                    }
                }
            });
        /* istanbul ignore next */
        } else {
            res.status(404).send('Not Found');
        }
    });
}

// Health probe for FreeBSD service / regression (no secrets)
app.get('/api/health', (_req: Request, res: Response) => {
    const config = loadConfig();
    const status = getConfigLoadStatus();
    const configDir = path.dirname(configPath());
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
    res.json({
        ok: true,
        version: process.env.npm_package_version || '1.0.0',
        env: process.env.NODE_ENV || 'development',
        auth: {
            mode: resolveAuthMode(config)
        },
        config: {
            path: status.path || configPath(),
            writable: isConfigWritable(),
            loadWarnings: status.warnings.length,
            usedDefaults: status.usedDefaults
        },
        data: {
            postsDir,
            exists: fs.existsSync(postsDir)
        }
    });
});

// Get site config — PublicConfigBuilder enforces INV-SEC-1 (no secrets)
app.get('/api/config', (_req: Request, res: Response) => {
    const config = loadConfig();
    try {
        res.json(PublicConfigBuilder.from(config).build());
    } catch (e) {
        console.error('[ERROR] PublicConfigBuilder failed; serving minimal public config:', e);
        const { config: safe } = sanitizeConfig(config);
        res.json({
            siteName: safe.siteName || 'MDWeb',
            siteLogo: safe.siteLogo || 'logo.webp',
            currentTheme: safe.currentTheme || 'dark',
            appearance: safe.appearance || { themeMode: 'dark', crtEffects: true, textGlow: true },
            pagination: safe.pagination || 10,
            sortBy: safe.sortBy || 'date',
            sortOrder: safe.sortOrder || 'desc',
            searchPlacement: safe.searchPlacement || 'top',
            service: safe.service || { port: 5173 }
        });
    }
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
        const {
            siteName,
            siteLogo,
            currentTheme,
            pagination,
            sortBy,
            sortOrder,
            searchPlacement,
            aiConfig,
            service,
            security,
            appearance,
            footer,
            postsDir,
            themeDir
        } = req.body;

        if (siteName) config.siteName = sanitizeHtml(siteName, { allowedTags: [], allowedAttributes: {} });
        if (siteLogo !== undefined) config.siteLogo = sanitizeHtml(siteLogo || 'logo.webp', { allowedTags: [], allowedAttributes: {} });
        if (currentTheme) config.currentTheme = sanitizeHtml(currentTheme, { allowedTags: [], allowedAttributes: {} });
        if (pagination !== undefined) {
            const n = Number(pagination);
            if (Number.isFinite(n)) config.pagination = Math.max(1, Math.min(100, Math.floor(n)));
        }
        if (sortBy === 'title' || sortBy === 'date' || sortBy === 'author') config.sortBy = sortBy;
        if (sortOrder === 'asc' || sortOrder === 'desc') config.sortOrder = sortOrder;
        if (
            searchPlacement === 'top' ||
            searchPlacement === 'bottom' ||
            searchPlacement === 'left' ||
            searchPlacement === 'right' ||
            searchPlacement === 'none'
        ) {
            config.searchPlacement = searchPlacement;
        }

        // Advanced paths — reject empty / null-byte / traversal-ish values
        if (typeof postsDir === 'string' && postsDir.trim() && !postsDir.includes('\0')) {
            config.postsDir = postsDir.trim();
        }
        if (typeof themeDir === 'string' && themeDir.trim() && !themeDir.includes('\0')) {
            config.themeDir = themeDir.trim();
        }

        if (footer && typeof footer === 'object') {
            const prev = config.footer || {};
            const clip = (s: string) => s.slice(0, 200);
            config.footer = {
                show: typeof footer.show === 'boolean' ? footer.show : prev.show !== false,
                copyrightText:
                    typeof footer.copyrightText === 'string'
                        ? clip(sanitizeHtml(footer.copyrightText, { allowedTags: [], allowedAttributes: {} }))
                        : prev.copyrightText !== undefined
                          ? prev.copyrightText
                          : '© {year} {siteName}. All rights reserved.',
                creditText:
                    typeof footer.creditText === 'string'
                        ? clip(sanitizeHtml(footer.creditText, { allowedTags: [], allowedAttributes: {} }))
                        : prev.creditText || ''
            };
        }

        if (appearance && typeof appearance === 'object') {
            const prev = config.appearance || {};
            config.appearance = {
                themeMode:
                    appearance.themeMode === 'light' || appearance.themeMode === 'dark'
                        ? appearance.themeMode
                        : prev.themeMode === 'light'
                          ? 'light'
                          : 'dark',
                crtEffects:
                    typeof appearance.crtEffects === 'boolean' ? appearance.crtEffects : prev.crtEffects !== false,
                textGlow: typeof appearance.textGlow === 'boolean' ? appearance.textGlow : prev.textGlow !== false
            };
        }

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

        if (security && typeof security === 'object') {
            const prev = config.security || {};
            config.security = {
                authMode:
                    security.authMode === 'session' || security.authMode === 'jwt'
                        ? security.authMode
                        : prev.authMode === 'session'
                          ? 'session'
                          : 'jwt',
                sessionTtlSeconds:
                    typeof security.sessionTtlSeconds === 'number'
                        ? Math.max(300, Math.min(604800, Math.floor(security.sessionTtlSeconds)))
                        : prev.sessionTtlSeconds || 86400,
                sessionCookieName:
                    typeof security.sessionCookieName === 'string' &&
                    /^[a-zA-Z0-9._-]{1,64}$/.test(security.sessionCookieName)
                        ? security.sessionCookieName
                        : prev.sessionCookieName || 'mdweb.sid',
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
        const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
        /* c8 ignore next 6 — FreeBSD/package without native sharp */
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
    const postsDir = path.isAbsolute(config.postsDir)
        ? config.postsDir
        : path.resolve(configDir, config.postsDir);
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
    // Explicit ?mode= always wins. Site appearance.themeMode only applies when loading
    // the active site theme (no ?name=), so pack inspection returns the authored palette.
    const modeParam = String(req.query.mode || '');
    let mode: 'light' | 'dark' | undefined =
        modeParam === 'light' || modeParam === 'dark' ? modeParam : undefined;
    if (mode === undefined && req.query.name === undefined) {
        const siteMode = config.appearance?.themeMode;
        if (siteMode === 'light' || siteMode === 'dark') mode = siteMode;
    }
    const colors = loadThemeColorsForMode(themeDir, themeName, mode);
    if (colors) {
        return res.json(colors);
    }
    // Fallback dark palette (includes chip on-* colors)
    res.json({
        mdEditorTheme: 'dark',
        '--primary': '#3b82f6',
        '--secondary': '#1f2937',
        '--accent': '#3a297a',
        '--text': '#f3f4f6',
        '--bg': '#111827',
        '--border': '#374151',
        '--hover': '#1f2937',
        '--site-name-color': '#3b82f6',
        '--on-accent': '#ffffff',
        '--on-primary': '#ffffff'
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
