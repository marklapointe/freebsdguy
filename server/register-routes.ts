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
    isConfigWritable,
    getConfigLoadStatus,
    sanitizeConfig,
    resolveAuthMode,
    findUserByUsername
} from './lib/config.ts';
import {
    parseCookies,
    sessionCookieHeader,
    clearSessionCookieHeader,
    FileSessionStore,
    safeDecode
} from './lib/session-store.ts';
import { getPosts, getPost, savePost } from './lib/posts.ts';
import { AIServiceFactory } from './lib/ai-service.ts';
import { calculateMD5, loadManifest, saveManifest, findDuplicate, findByName, withManifestLock } from './lib/images.ts';
import { PublicConfigBuilder } from './lib/public-config.ts';
import { isSafePath, resolveConfiguredPath, resolvePostsDir, resolveImagesDir } from './lib/safe-path.ts';
import { isAllowedRole, AuthenticatedRequest } from './middleware/auth.ts';
import type { AppContext } from './lib/app-context.ts';
import {
    mintToken,
    listTokensForUser,
    listAllTokens,
    revokeToken,
    revokeTokensForUser
} from './lib/api-tokens.ts';
import { parseTokenScope } from './lib/token-scope.ts';
import { writeAudit } from './lib/audit-log.ts';
import { DEFAULT_ADMIN_PASSWORD } from './lib/default-credentials.ts';
import { isDefaultAdminCredential } from './lib/setup-admin.ts';
import { registerMcpRoutes } from './mcp/register-mcp.ts';
import {
    isValidThemeId,
    listThemeCatalog,
    listThemeIds,
    loadThemeColors,
    loadThemeColorsForMode,
    themeFilePath
} from './lib/themes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Config root directory (CONFIG_DIR / platform default). */
const configDirOf = () => path.dirname(configPath());

/** Absolute posts directory for a config (callers pass the active in-memory config). */
const postsDirOf = (config: { postsDir?: string }) =>
    resolvePostsDir(configDirOf(), config.postsDir);

/** Absolute images directory under posts. */
const imagesDirOf = (config: { postsDir?: string }) =>
    resolveImagesDir(configDirOf(), config.postsDir);

/**
 * Configured theme directory (absolute). Do not fall back to shipped themes here:
 * resolveThemeDir() would rewrite missing paths to the repo pack, and admin saves
 * would pollute server/themes. Catalog loaders already search shipped via themeSearchDirs.
 */
const themeDirForConfig = (config: { themeDir?: string }) =>
    resolveConfiguredPath(configDirOf(), config.themeDir || './themes');

export function registerRoutes(app: Express, ctx: AppContext): void {
    const { secret: SECRET, authenticate, requireAdmin, requireWriter, upload } = ctx;
    const getActive = ctx.getActiveConfig;
    const setActive = ctx.setActiveConfig;
    const sessionStore = ctx.sessionStore || new FileSessionStore();
    /** Theme dir from the active config (admin saves call setActive, so this stays fresh). */
    const themeDirOf = () => themeDirForConfig(getActive());

    // MCP Streamable HTTP (auth required) — before SPA catch-all
    registerMcpRoutes(app, ctx);

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

    const passwordMatches = async (plain: unknown, hash: string | undefined): Promise<boolean> => {
        if (!hash || typeof plain !== 'string' || !plain) return false;
        try {
            return await bcrypt.compare(plain, hash);
        } catch {
            return false;
        }
    };

    const auditName = typeof username === 'string' ? username.slice(0, 120) : undefined;

    const rejectDefault = async (hash: string | undefined) => {
        if (password === DEFAULT_ADMIN_PASSWORD) return true;
        return isDefaultAdminCredential(hash);
    };

    // Check admin
    if (username === usersConfig.admin.username) {
        if (await passwordMatches(password, usersConfig.admin.passwordHash)) {
            if (await rejectDefault(usersConfig.admin.passwordHash)) {
                writeAudit({ event: 'login', outcome: 'rejected', username: auditName });
                return res.status(403).json({ message: 'Default credentials are disabled' });
            }
            console.log(`[AUTH] Admin login successful: ${username}`);
            writeAudit({ event: 'login', outcome: 'success', username: auditName });
            return issueAuthResponse(res, {
                username: usersConfig.admin.username,
                role: usersConfig.admin.role
            });
        }
    }

    // Check other users
    const user = usersConfig.users.find(u => u.username === username);
    if (user && (await passwordMatches(password, user.passwordHash))) {
        if (await rejectDefault(user.passwordHash)) {
            writeAudit({ event: 'login', outcome: 'rejected', username: auditName });
            return res.status(403).json({ message: 'Default credentials are disabled' });
        }
        console.log(`[AUTH] User login successful: ${username}`);
        writeAudit({ event: 'login', outcome: 'success', username: auditName });
        return issueAuthResponse(res, { username: user.username, role: user.role });
    }

    console.warn(`[AUTH] Login failed for user: ${username}`);
    writeAudit({ event: 'login', outcome: 'failure', username: auditName });
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
    writeAudit({ event: 'content', action: 'create', resource: 'user', id: cleanUsername, username: req.user?.username });
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
    sessionStore.destroyForUser(String(username));
    revokeTokensForUser(String(username));
    console.log(`[INFO] User deleted: ${username}`);
    writeAudit({ event: 'content', action: 'delete', resource: 'user', id: String(username), username: req.user?.username });
    res.json({ message: 'User deleted' });
});

// ---- Personal access tokens (PAT) ------------------------------------------
app.get('/api/tokens', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const username = req.user?.username as string;
    res.json({ tokens: listTokensForUser(username) });
});

app.post('/api/tokens', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const username = req.user?.username as string;
    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    let scope: ReturnType<typeof parseTokenScope>;
    try {
        scope = parseTokenScope(req.body?.scope);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid token scope';
        return res.status(400).json({ message: msg });
    }
    try {
        const { plaintext, record } = mintToken(username, label, scope);
        writeAudit({ event: 'token', action: 'mint', username, tokenId: record.id, scope: record.scope });
        res.status(201).json({
            token: plaintext,
            id: record.id,
            prefix: record.prefix,
            label: record.label,
            username: record.username,
            scope: record.scope,
            createdAt: record.createdAt
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to mint token';
        const status = /limit/i.test(msg) ? 400 : 400;
        res.status(status).json({ message: msg });
    }
});

app.delete('/api/tokens/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id || '');
    const isAdmin = req.user?.role === 'admin';
    const ok = revokeToken(id, isAdmin ? undefined : { onlyUsername: req.user?.username });
    if (!ok) return res.status(404).json({ message: 'Token not found' });
    writeAudit({ event: 'token', action: 'revoke', username: req.user?.username, tokenId: id });
    res.json({ message: 'Token revoked' });
});

app.get('/api/admin/tokens', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const filter =
        typeof req.query.username === 'string' && req.query.username.trim()
            ? req.query.username.trim()
            : undefined;
    res.json({ tokens: listAllTokens(filter) });
});

app.post('/api/admin/tokens', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    if (!username) return res.status(400).json({ message: 'username is required' });
    if (!findUserByUsername(username)) {
        return res.status(404).json({ message: 'User not found' });
    }
    let scope: ReturnType<typeof parseTokenScope>;
    try {
        scope = parseTokenScope(req.body?.scope);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid token scope';
        return res.status(400).json({ message: msg });
    }
    try {
        const { plaintext, record } = mintToken(username, label, scope);
        writeAudit({ event: 'token', action: 'mint', username, tokenId: record.id, scope: record.scope });
        res.status(201).json({
            token: plaintext,
            id: record.id,
            prefix: record.prefix,
            label: record.label,
            username: record.username,
            scope: record.scope,
            createdAt: record.createdAt
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to mint token';
        res.status(400).json({ message: msg });
    }
});

// Get posts
app.get('/api/posts', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').toLowerCase();
    if (query && getActive().security?.disablePublicSearch) {
        return res.status(403).json({ message: 'Search is disabled by security policy' });
    }
    const config = getActive();
    const postsDir = postsDirOf(config);
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

// ---- AI proxy routes -------------------------------------------------------
// Security model (review finding #1):
//   * Only admins may override provider/baseUrl/modelId per request; contributors
//     always use the stored aiConfig, so they cannot point the proxy at another host.
//   * Override baseUrl must be http(s) (no file:, gopher:, etc.).
//   * The stored apiKey is attached only when the effective baseUrl has the same
//     origin as the stored baseUrl — the key can never be sent to a third-party host.
//   * Every AI route honors aiConfig.enabled and security.disableAI.
type AIProvider = 'ollama' | 'openai';

interface ResolvedAI {
    provider: AIProvider;
    baseUrl: string;
    modelId: string;
    apiKey?: string;
}

const sameOrigin = (a: string, b: string): boolean => {
    try {
        return new URL(a).origin === new URL(b).origin;
    } catch {
        return false;
    }
};

const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(u);

/**
 * Resolve the AI target for this request, applying the rules above.
 * Returns an HTTP error tuple instead of throwing so handlers stay linear.
 */
const resolveAIRequest = (
    req: AuthenticatedRequest,
    overrides: { provider?: unknown; baseUrl?: unknown; modelId?: unknown },
    opts: { needModel: boolean }
): { ok: true; ai: ResolvedAI } | { ok: false; status: number; message: string } => {
    const aiConfig = getActive().aiConfig;
    if (!aiConfig?.enabled || getActive().security?.disableAI) {
        return { ok: false, status: 403, message: 'AI features are disabled' };
    }
    const isAdmin = req.user?.role === 'admin';
    const pick = (v: unknown): string | undefined =>
        isAdmin && typeof v === 'string' && v.trim() ? v.trim() : undefined;

    const provider = (pick(overrides.provider) || aiConfig.provider) as AIProvider;
    const baseUrl = pick(overrides.baseUrl) || aiConfig.baseUrl;
    const modelId = pick(overrides.modelId) || aiConfig.modelId;

    if (!provider || !baseUrl || (opts.needModel && !modelId)) {
        return opts.needModel
            ? { ok: false, status: 503, message: 'AI configuration not found' }
            : { ok: false, status: 400, message: 'AI provider and Base URL are required' };
    }
    if (!isHttpUrl(baseUrl)) {
        return { ok: false, status: 400, message: 'AI Base URL must be an http(s) URL' };
    }
    const apiKey =
        aiConfig.apiKey && aiConfig.baseUrl && sameOrigin(baseUrl, aiConfig.baseUrl)
            ? aiConfig.apiKey
            : undefined;
    return { ok: true, ai: { provider, baseUrl, modelId: modelId || '', apiKey } };
};

/** Shared handler for summarize/enhance — differ only in method + response key. */
const aiTransformRoute =
    (method: 'summarize' | 'enhance', key: 'summary' | 'enhanced', label: string) =>
    async (req: AuthenticatedRequest, res: Response) => {
        const { content, provider, baseUrl, modelId } = req.body || {};
        const r = resolveAIRequest(req, { provider, baseUrl, modelId }, { needModel: true });
        if (!r.ok) return res.status(r.status).json({ message: r.message });
        if (!content) return res.status(400).json({ message: 'No content provided' });
        try {
            const service = AIServiceFactory.create(r.ai.provider, {
                baseUrl: r.ai.baseUrl,
                modelId: r.ai.modelId,
                apiKey: r.ai.apiKey
            });
            const out = await service[method](content);
            res.json({ [key]: out });
        } catch (error: any) {
            console.error(`AI ${label} failed:`, error.message);
            res.status(500).json({ message: error.message || `Failed to ${method} content via proxy` });
        }
    };

// AI: Summarize post content
app.post('/api/ai/summarize', authenticate, aiTransformRoute('summarize', 'summary', 'Summarization'));

// AI: Enhance post content
app.post('/api/ai/enhance', authenticate, aiTransformRoute('enhance', 'enhanced', 'Enhancement'));

// AI: Fetch available models
app.get('/api/ai/models', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const r = resolveAIRequest(
        req,
        { provider: req.query.provider, baseUrl: req.query.baseUrl },
        { needModel: false }
    );
    if (!r.ok) {
        if (r.status === 400) console.warn('[AI] ' + r.message);
        return res.status(r.status).json({ message: r.message });
    }
    console.log(`[AI] Fetching models via proxy. Provider: ${r.ai.provider}, BaseURL: ${r.ai.baseUrl}`);

    try {
        const service = AIServiceFactory.create(r.ai.provider, {
            baseUrl: r.ai.baseUrl,
            modelId: '', // modelId not needed for getting models
            apiKey: r.ai.apiKey // never accept API keys via query string
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
    const config = getActive();
    const postsDir = postsDirOf(config);
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
    const { slug: rawSlug, title, content, summary, date, pinned } = req.body;
    const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
    if (!slug) {
        return res.status(400).json({ message: 'slug is required' });
    }
    const config = getActive();
    const postsDir = postsDirOf(config);
    
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

    writeAudit({ event: 'content', action: 'update', resource: 'post', id: slug, username: req.user?.username });
    res.json({ message: 'Post saved' });
});

// Proxy images through a common endpoint
app.get(['/api/getimage', '/api/images/:filename'], (req: Request, res: Response) => {
    const config = getActive();
    const imagesDir = imagesDirOf(config);
    
    // Support both query param (preferred) and route param (legacy)
    const filenameRaw = (req.query.fileName as string) || (req.params.filename as string) || '';
    const filename = filenameRaw ? safeDecode(filenameRaw) : '';
    
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
    app.get(/^\/(?!api|mcp).*/, (_req: Request, res: Response) => {
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
    const postsDir = postsDirOf(config);
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
    const current = loadConfig();
    const { enabled, provider, baseUrl, apiKey, modelId } = req.body || {};
    const strip = (v: unknown) => sanitizeHtml(String(v || ''), { allowedTags: [], allowedAttributes: {} });
    // Empty apiKey means "keep existing" so public config redaction cannot wipe secrets
    const previousKey = current.aiConfig?.apiKey || '';
    const { config } = sanitizeConfig({
        ...current,
        aiConfig: {
            enabled: !!enabled,
            provider,
            baseUrl: strip(baseUrl),
            apiKey: typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : previousKey,
            modelId: strip(modelId)
        }
    });

    saveConfig(config);
    setActive(config);
    writeAudit({ event: 'content', action: 'update', resource: 'ai-config', username: req.user?.username });
    res.json({ message: 'AI Configuration updated' });
});

// Admin: Delete image
app.delete('/api/admin/images/:filename', authenticate, requireWriter, async (req: AuthenticatedRequest, res: Response) => {
    const filename = safeDecode(req.params.filename as string);
    const config = getActive();
    const imagesDir = imagesDirOf(config);
    const filePath = path.join(imagesDir, filename);

    if (!isSafePath(imagesDir, filePath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for filename: ${filename}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            
            // Also remove from manifest if it exists
            await withManifestLock(imagesDir, async () => {
                const manifest = loadManifest(imagesDir);
                if (manifest[filename]) {
                    delete manifest[filename];
                    saveManifest(imagesDir, manifest);
                }
            });

            console.log(`[INFO] Image deleted: ${filename}`);
            writeAudit({ event: 'content', action: 'delete', resource: 'image', id: String(req.params.filename || ''), username: req.user?.username });
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
app.post('/api/admin/images/delete-bulk', authenticate, requireWriter, async (req: AuthenticatedRequest, res: Response) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ message: 'filenames must be an array' });

    const imagesDir = imagesDirOf(getActive());
    await withManifestLock(imagesDir, async () => {
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
    writeAudit({ event: 'content', action: 'delete', resource: 'image', username: req.user?.username });
    res.json({ message: `Deleted ${deletedCount} images`, deletedCount, errors });
    });
});

// Admin: Update site config
// Partial update: merge the request body over the current config section by section,
// then run the single shared validator (sanitizeConfig) so route and loader never drift.
app.post('/api/admin/config', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
        const current = loadConfig();
        const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const isObj = (v: unknown): v is Record<string, unknown> =>
            !!v && typeof v === 'object' && !Array.isArray(v);
        const strip = (v: unknown): string | undefined =>
            typeof v === 'string' ? sanitizeHtml(v, { allowedTags: [], allowedAttributes: {} }) : undefined;
        const cleanPath = (v: unknown): string | undefined =>
            typeof v === 'string' && v.trim() && !v.includes('\0') ? v.trim() : undefined;

        const patch: Record<string, unknown> = {};
        if (b.siteName) patch.siteName = strip(b.siteName);
        if (b.siteLogo !== undefined) patch.siteLogo = strip(b.siteLogo || 'logo.webp');
        if (b.currentTheme) patch.currentTheme = strip(b.currentTheme);
        for (const k of ['pagination', 'sortBy', 'sortOrder', 'searchPlacement'] as const) {
            if (b[k] !== undefined) patch[k] = b[k];
        }
        const postsDir = cleanPath(b.postsDir);
        if (postsDir) patch.postsDir = postsDir;
        const themeDir = cleanPath(b.themeDir);
        if (themeDir) patch.themeDir = themeDir;

        if (isObj(b.footer)) {
            patch.footer = {
                ...(current.footer || {}),
                ...b.footer,
                ...(typeof b.footer.copyrightText === 'string' ? { copyrightText: strip(b.footer.copyrightText) } : {}),
                ...(typeof b.footer.creditText === 'string' ? { creditText: strip(b.footer.creditText) } : {})
            };
        }
        if (isObj(b.appearance)) patch.appearance = { ...(current.appearance || {}), ...b.appearance };
        if (isObj(b.security)) {
            // Toggles are a full replacement (omitted → false); connection settings keep prev
            const prev = current.security || {};
            patch.security = {
                authMode: b.security.authMode ?? prev.authMode,
                sessionTtlSeconds: b.security.sessionTtlSeconds ?? prev.sessionTtlSeconds,
                sessionCookieName: b.security.sessionCookieName ?? prev.sessionCookieName,
                disableAI: !!b.security.disableAI,
                disableImages: !!b.security.disableImages,
                disablePublicSearch: !!b.security.disablePublicSearch,
                apiRateLimitWindow: b.security.apiRateLimitWindow ?? prev.apiRateLimitWindow,
                apiRateLimitMax: b.security.apiRateLimitMax ?? prev.apiRateLimitMax,
                loginRateLimitWindow: b.security.loginRateLimitWindow ?? prev.loginRateLimitWindow,
                loginRateLimitMax: b.security.loginRateLimitMax ?? prev.loginRateLimitMax,
                mcpRateLimitWindow: b.security.mcpRateLimitWindow ?? prev.mcpRateLimitWindow,
                mcpRateLimitMax: b.security.mcpRateLimitMax ?? prev.mcpRateLimitMax,
                corsOrigins: b.security.corsOrigins ?? prev.corsOrigins,
                trustProxy: b.security.trustProxy ?? prev.trustProxy
            };
        }
        if (isObj(b.service)) patch.service = { ...(current.service || {}), ...b.service };
        if (isObj(b.aiConfig)) {
            const ai = b.aiConfig;
            const previousKey = current.aiConfig?.apiKey || '';
            patch.aiConfig = {
                ...(current.aiConfig || {}),
                ...ai,
                baseUrl: strip(ai.baseUrl || ''),
                modelId: strip(ai.modelId || ''),
                // Empty apiKey means "keep existing" so public redaction cannot wipe secrets
                apiKey: typeof ai.apiKey === 'string' && ai.apiKey.length > 0 ? ai.apiKey : previousKey
            };
        }

        const { config, warnings } = sanitizeConfig({ ...current, ...patch });
        if (warnings.length) console.warn('[WARN] POST /api/admin/config:', warnings.join('; '));

        saveConfig(config);
        setActive(config);

        writeAudit({ event: 'content', action: 'update', resource: 'config', username: req.user?.username });
        res.json({ message: 'Configuration updated', currentTheme: config.currentTheme });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to save configuration';
        console.error('[ERROR] POST /api/admin/config:', msg);
        res.status(500).json({ message: msg });
    }
});

// Public theme catalog (ids + labels for pickers)
app.get('/api/themes', (_req: Request, res: Response) => {
    res.json(listThemeCatalog(themeDirOf()));
});

// Admin: Get all themes (catalog with metadata)
app.get('/api/admin/themes', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    res.json(listThemeCatalog(themeDirOf()));
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

    const themeDir = themeDirOf();
    const themePath = themeFilePath(themeDir, name);
    if (!themePath) return res.status(400).json({ message: 'Invalid theme path' });

    if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
    }

    fs.writeFileSync(themePath, JSON.stringify(sanitizedColors, null, 2));
    writeAudit({ event: 'content', action: 'update', resource: 'theme', id: name, username: req.user?.username });
    res.json({ message: `Theme ${name} saved` });
});

// Admin: Delete post
app.delete('/api/posts/:slug', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const slug = req.params.slug;
    const config = getActive();
    const postsDir = postsDirOf(config);
    const postPath = path.join(postsDir, `${slug}.md`);

    if (!isSafePath(postsDir, postPath)) {
        console.warn(`[WARN] Blocked potential directory traversal attempt for slug: ${slug}`);
        return res.status(403).json({ message: 'Forbidden' });
    }

    if (fs.existsSync(postPath)) {
        fs.unlinkSync(postPath);
        writeAudit({ event: 'content', action: 'delete', resource: 'post', id: String(slug), username: req.user?.username });
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

    const imagesDir = imagesDirOf(getActive());
    try {
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

      // Manifest read → sharp await → manifest write must not interleave with other writers
      await withManifestLock(imagesDir, async () => {
        const manifest = loadManifest(imagesDir);
        const md5 = calculateMD5(req.file!.buffer);
        const size = req.file!.size;
        const originalName = req.file!.originalname;
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
        await sharp(req.file!.buffer, { animated: true })
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
        writeAudit({ event: 'content', action: 'create', resource: 'image', id: newFilename, username: req.user?.username });
        res.json({ filename: newFilename, url: `/api/getimage?fileName=${newFilename}` });
      });
    } catch (error) {
        console.error('[ERROR] Image processing failed:', error);
        res.status(500).json({ message: 'Image processing failed' });
    }
});

// Get images with pagination
app.get('/api/admin/images', authenticate, requireWriter, (req: AuthenticatedRequest, res: Response) => {
    const config = getActive();
    const imagesDir = imagesDirOf(config);

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
    const config = getActive();
    const themeDir = themeDirOf();
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
        const themeDir = themeDirOf();
        const known = listThemeIds(themeDir);
        if (!known.includes(currentTheme) && !loadThemeColors(themeDir, currentTheme)) {
            return res.status(404).json({ message: `Theme not found: ${currentTheme}` });
        }

        config.currentTheme = currentTheme;
        saveConfig(config);
        setActive(config);
        console.log(`[INFO] Admin set site theme to: ${currentTheme}`);
        writeAudit({ event: 'content', action: 'update', resource: 'site-theme', id: String(currentTheme), username: req.user?.username });
        res.json({ message: 'Site theme updated', currentTheme });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to set theme';
        console.error('[ERROR] POST /api/theme:', msg);
        res.status(500).json({ message: msg });
    }
});


}
