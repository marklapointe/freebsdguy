/**
 * Build a per-request McpServer with tools bound to the authenticated user.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import type { Config } from '../lib/config.ts';
import {
    loadUsers,
    saveUsers,
    saveConfig,
    sanitizeConfig,
    findUserByUsername,
    configPath
} from '../lib/config.ts';
import { getPosts, getPost, savePost } from '../lib/posts.ts';
import {
    calculateMD5,
    loadManifest,
    saveManifest,
    findDuplicate,
    withManifestLock
} from '../lib/images.ts';
import { PublicConfigBuilder } from '../lib/public-config.ts';
import { resolvePostsDir, resolveImagesDir, isSafePath } from '../lib/safe-path.ts';
import { listThemeCatalog, isValidThemeId, themeFilePath } from '../lib/themes.ts';
import { AIServiceFactory } from '../lib/ai-service.ts';
import {
    mintToken,
    listTokensForUser,
    listAllTokens,
    revokeToken
} from '../lib/api-tokens.ts';
import { isAllowedRole, type Role } from '../middleware/auth.ts';
import { isReadAllowedMcpTool, parseTokenScope, READ_ONLY_TOKEN_MESSAGE, type TokenScope } from '../lib/token-scope.ts';
import { MDWEB_MCP_INSTRUCTIONS, MDWEB_MCP_PLAYBOOK } from './playbook.ts';
import sanitizeHtml from 'sanitize-html';

export type McpUser = { username: string; role: Role };

export interface McpServerDeps {
    user: McpUser;
    getActive: () => Config;
    setActive: (c: Config) => void;
    /** Omitted for JWT/session callers, who are not scope-limited. */
    tokenScope?: TokenScope;
}

function text(data: unknown) {
    return {
        content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
    };
}

function err(message: string) {
    return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function requireWriter(user: McpUser) {
    if (user.role !== 'admin' && user.role !== 'contributor') {
        throw new Error('Forbidden: contributor or admin required');
    }
}

function requireAdmin(user: McpUser) {
    if (user.role !== 'admin') throw new Error('Forbidden: admin required');
}

function configDir() {
    return path.dirname(configPath());
}

function postsDir(cfg: Config) {
    return resolvePostsDir(configDir(), cfg.postsDir);
}

function imagesDir(cfg: Config) {
    return resolveImagesDir(configDir(), cfg.postsDir);
}

export function createMdwebMcpServer(deps: McpServerDeps): McpServer {
    const { user, getActive, setActive, tokenScope } = deps;

    const server = new McpServer(
        { name: 'mdweb', version: process.env.npm_package_version || '1.0.0' },
        { instructions: MDWEB_MCP_INSTRUCTIONS }
    );

    const registerGuarded = (
        name: string,
        config: object,
        handler: (args: any, extra?: any) => any
    ) =>
        server.registerTool(name, config as never, (async (args: any, extra: any) => {
            if (tokenScope === 'read' && !isReadAllowedMcpTool(name)) {
                return err(READ_ONLY_TOKEN_MESSAGE);
            }
            return handler(args, extra);
        }) as never);

    server.registerResource(
        'playbook',
        'mdweb://playbook',
        { mimeType: 'text/markdown', description: 'MDWeb MCP workflows' },
        async () => ({
            contents: [{ uri: 'mdweb://playbook', text: MDWEB_MCP_PLAYBOOK, mimeType: 'text/markdown' }]
        })
    );

    registerGuarded(
        'get_playbook',
        { description: 'Return MDWeb MCP workflows and auth notes', inputSchema: {} },
        async () => text(MDWEB_MCP_PLAYBOOK)
    );

    registerGuarded(
        'health',
        { description: 'Service health probe (authenticated)', inputSchema: {} },
        async () => {
            const cfg = getActive();
            return text({
                ok: true,
                user: user.username,
                role: user.role,
                authMode: cfg.security?.authMode || 'jwt'
            });
        }
    );

    registerGuarded(
        'list_posts',
        {
            description: 'List post metadata',
            inputSchema: {
                q: z.string().optional().describe('Optional search query'),
                limit: z.number().optional(),
                offset: z.number().optional()
            }
        },
        async ({ q, limit, offset }) => {
            try {
                const cfg = getActive();
                let posts = getPosts(postsDir(cfg), {
                    sortBy: (cfg.sortBy as 'date') || 'date',
                    sortOrder: (cfg.sortOrder as 'desc') || 'desc'
                });
                if (q) {
                    const qq = q.toLowerCase();
                    posts = posts.filter(
                        (p) =>
                            p.title?.toLowerCase().includes(qq) ||
                            p.summary?.toLowerCase().includes(qq) ||
                            p.slug?.toLowerCase().includes(qq)
                    );
                }
                const o = offset && offset > 0 ? offset : 0;
                const l = limit && limit > 0 ? limit : posts.length;
                return text({ posts: posts.slice(o, o + l), total: posts.length });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'get_post',
        {
            description: 'Get a full post by slug',
            inputSchema: { slug: z.string() }
        },
        async ({ slug }) => {
            try {
                const post = getPost(postsDir(getActive()), slug);
                if (!post) return err('Post not found');
                return text(post);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'create_post',
        {
            description: 'Create or overwrite a post (same as update)',
            inputSchema: {
                slug: z.string(),
                title: z.string(),
                content: z.string(),
                summary: z.string().optional(),
                date: z.string().optional(),
                pinned: z.boolean().optional()
            }
        },
        async (args) => {
            try {
                requireWriter(user);
                const slug = args.slug.trim();
                if (!slug) return err('slug is required');
                const dir = postsDir(getActive());
                const postPath = path.join(dir, `${slug}.md`);
                if (!isSafePath(dir, postPath)) return err('Forbidden slug');
                savePost(dir, {
                    slug,
                    title: args.title,
                    content: args.content,
                    summary: args.summary || '',
                    date: args.date,
                    pinned: args.pinned,
                    author: user.username
                });
                return text({ message: 'Post saved', slug });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'update_post',
        {
            description: 'Update an existing post (create_post alias)',
            inputSchema: {
                slug: z.string(),
                title: z.string(),
                content: z.string(),
                summary: z.string().optional(),
                date: z.string().optional(),
                pinned: z.boolean().optional()
            }
        },
        async (args) => {
            // Same implementation as create_post
            try {
                requireWriter(user);
                const slug = args.slug.trim();
                if (!slug) return err('slug is required');
                const dir = postsDir(getActive());
                const postPath = path.join(dir, `${slug}.md`);
                if (!isSafePath(dir, postPath)) return err('Forbidden slug');
                savePost(dir, {
                    slug,
                    title: args.title,
                    content: args.content,
                    summary: args.summary || '',
                    date: args.date,
                    pinned: args.pinned,
                    author: user.username
                });
                return text({ message: 'Post saved', slug });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'delete_post',
        {
            description: 'Delete a post by slug',
            inputSchema: { slug: z.string() }
        },
        async ({ slug }) => {
            try {
                requireWriter(user);
                const dir = postsDir(getActive());
                const postPath = path.join(dir, `${slug}.md`);
                if (!isSafePath(dir, postPath)) return err('Forbidden');
                if (!fs.existsSync(postPath)) return err('Post not found');
                fs.unlinkSync(postPath);
                return text({ message: 'Post deleted', slug });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'list_images',
        {
            description: 'List uploaded images',
            inputSchema: {
                limit: z.number().optional(),
                offset: z.number().optional()
            }
        },
        async ({ limit, offset }) => {
            try {
                requireWriter(user);
                const dir = imagesDir(getActive());
                if (!fs.existsSync(dir)) return text({ images: [], total: 0 });
                const manifest = loadManifest(dir);
                const files = fs
                    .readdirSync(dir, { withFileTypes: true })
                    .filter((e) => e.isFile() && e.name !== 'metadata.json')
                    .map((e) => manifest[e.name] || { filename: e.name, originalName: e.name })
                    .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
                const o = offset && offset > 0 ? offset : 0;
                const l = limit && limit > 0 ? limit : files.length;
                return text({ images: files.slice(o, o + l), total: files.length });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'upload_image',
        {
            description: 'Upload an image from base64 (converted to WebP)',
            inputSchema: {
                filename: z.string().describe('Original filename hint'),
                dataBase64: z.string().describe('Raw base64 or data URL')
            }
        },
        async ({ filename, dataBase64 }) => {
            try {
                requireWriter(user);
                if (getActive().security?.disableImages) return err('Image uploads are disabled');
                const raw = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
                const buffer = Buffer.from(raw, 'base64');
                if (!buffer.length) return err('Empty image data');
                const dir = imagesDir(getActive());
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                let result: { filename: string; url: string; duplicated?: boolean } | null = null;
                await withManifestLock(dir, async () => {
                    const manifest = loadManifest(dir);
                    const md5 = calculateMD5(buffer);
                    const dup = findDuplicate(manifest, md5, buffer.length);
                    if (dup && fs.existsSync(path.join(dir, dup.filename))) {
                        result = {
                            filename: dup.filename,
                            url: `/api/getimage?fileName=${dup.filename}`,
                            duplicated: true
                        };
                        return;
                    }
                    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
                    const outputPath = path.join(dir, newFilename);
                    const sharp = (await import('sharp')).default;
                    await sharp(buffer, { animated: true }).webp({ effort: 4 }).toFile(outputPath);
                    manifest[newFilename] = {
                        filename: newFilename,
                        originalName: filename || newFilename,
                        md5,
                        size: buffer.length,
                        uploadedAt: Date.now()
                    };
                    saveManifest(dir, manifest);
                    result = { filename: newFilename, url: `/api/getimage?fileName=${newFilename}` };
                });
                return text(result);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'delete_image',
        {
            description: 'Delete an image by filename',
            inputSchema: { filename: z.string() }
        },
        async ({ filename }) => {
            try {
                requireWriter(user);
                const dir = imagesDir(getActive());
                const filePath = path.join(dir, filename);
                if (!isSafePath(dir, filePath)) return err('Forbidden');
                if (!fs.existsSync(filePath)) return err('Image not found');
                fs.unlinkSync(filePath);
                await withManifestLock(dir, async () => {
                    const manifest = loadManifest(dir);
                    if (manifest[filename]) {
                        delete manifest[filename];
                        saveManifest(dir, manifest);
                    }
                });
                return text({ message: 'Image deleted', filename });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'get_config',
        { description: 'Get public site config projection (admin)', inputSchema: {} },
        async () => {
            try {
                requireAdmin(user);
                return text(PublicConfigBuilder.from(getActive()).build());
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'update_config',
        {
            description: 'Merge and save site config (admin)',
            inputSchema: { patch: z.record(z.string(), z.unknown()) }
        },
        async ({ patch }) => {
            try {
                requireAdmin(user);
                const { config, warnings } = sanitizeConfig({ ...getActive(), ...patch });
                saveConfig(config);
                setActive(config);
                return text({ message: 'Config saved', warnings });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'list_themes',
        { description: 'List theme catalog (admin)', inputSchema: {} },
        async () => {
            try {
                requireAdmin(user);
                const themeDir = path.resolve(configDir(), getActive().themeDir || './themes');
                return text(listThemeCatalog(themeDir));
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'set_theme',
        {
            description: 'Set current site theme id (admin)',
            inputSchema: { themeId: z.string() }
        },
        async ({ themeId }) => {
            try {
                requireAdmin(user);
                if (!isValidThemeId(themeId)) return err('Invalid theme id');
                const cfg = { ...getActive(), currentTheme: themeId };
                saveConfig(cfg);
                setActive(cfg);
                return text({ message: 'Theme set', currentTheme: themeId });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'save_theme',
        {
            description: 'Save theme color JSON for a theme id (admin)',
            inputSchema: {
                name: z.string(),
                colors: z.record(z.string(), z.string())
            }
        },
        async ({ name, colors }) => {
            try {
                requireAdmin(user);
                if (!isValidThemeId(name)) return err('Invalid theme name');
                const themeDir = path.resolve(configDir(), getActive().themeDir || './themes');
                if (!fs.existsSync(themeDir)) fs.mkdirSync(themeDir, { recursive: true });
                const themePath = themeFilePath(themeDir, name);
                if (!themePath) return err('Invalid theme path');
                const sanitized: Record<string, string> = {};
                for (const [k, v] of Object.entries(colors)) {
                    sanitized[k] = sanitizeHtml(String(v), { allowedTags: [], allowedAttributes: {} });
                }
                fs.writeFileSync(themePath, JSON.stringify(sanitized, null, 2));
                return text({ message: `Theme ${name} saved` });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'list_users',
        { description: 'List users (admin)', inputSchema: {} },
        async () => {
            try {
                requireAdmin(user);
                const u = loadUsers();
                return text([
                    { username: u.admin.username, role: u.admin.role },
                    ...u.users.map((x) => ({ username: x.username, role: x.role }))
                ]);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'create_user',
        {
            description: 'Create a user (admin)',
            inputSchema: {
                username: z.string(),
                password: z.string().min(8),
                role: z.enum(['admin', 'contributor'])
            }
        },
        async ({ username, password, role }) => {
            try {
                requireAdmin(user);
                const cleanUsername = sanitizeHtml(username, { allowedTags: [], allowedAttributes: {} }).trim();
                if (!cleanUsername || !isAllowedRole(role)) return err('Invalid username or role');
                const usersConfig = loadUsers();
                if (
                    usersConfig.admin.username === cleanUsername ||
                    usersConfig.users.some((u) => u.username === cleanUsername)
                ) {
                    return err('User already exists');
                }
                const passwordHash = await bcrypt.hash(password, 10);
                usersConfig.users.push({ username: cleanUsername, passwordHash, role });
                saveUsers(usersConfig);
                return text({ message: 'User created', username: cleanUsername, role });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'delete_user',
        {
            description: 'Delete a non-primary user (admin)',
            inputSchema: { username: z.string() }
        },
        async ({ username }) => {
            try {
                requireAdmin(user);
                const usersConfig = loadUsers();
                if (username === usersConfig.admin.username) return err('Cannot delete primary admin');
                const before = usersConfig.users.length;
                usersConfig.users = usersConfig.users.filter((u) => u.username !== username);
                if (usersConfig.users.length === before) return err('User not found');
                saveUsers(usersConfig);
                const { revokeTokensForUser } = await import('../lib/api-tokens.ts');
                revokeTokensForUser(username);
                return text({ message: 'User deleted', username });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'list_tokens',
        {
            description: 'List API tokens (own, or all if admin)',
            inputSchema: { username: z.string().optional() }
        },
        async ({ username }) => {
            try {
                if (user.role === 'admin') {
                    return text({ tokens: listAllTokens(username) });
                }
                return text({ tokens: listTokensForUser(user.username) });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'create_token',
        {
            description: 'Mint a PAT (plaintext returned once). Admin may set username.',
            inputSchema: {
                label: z.string().optional(),
                username: z.string().optional(),
                scope: z.enum(['read', 'write']).optional()
            }
        },
        async ({ label, username, scope }) => {
            try {
                const target = user.role === 'admin' && username ? username : user.username;
                if (!findUserByUsername(target)) return err('User not found');
                const { plaintext, record } = mintToken(target, label || '', parseTokenScope(scope));
                return text({
                    token: plaintext,
                    id: record.id,
                    prefix: record.prefix,
                    username: record.username,
                    label: record.label,
                    scope: record.scope,
                    createdAt: record.createdAt,
                    note: 'Store this token securely; it will not be shown again.'
                });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'revoke_token',
        {
            description: 'Revoke a token by id',
            inputSchema: { id: z.string() }
        },
        async ({ id }) => {
            try {
                const ok =
                    user.role === 'admin'
                        ? revokeToken(id)
                        : revokeToken(id, { onlyUsername: user.username });
                if (!ok) return err('Token not found');
                return text({ message: 'Token revoked', id });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    const aiGate = () => {
        const cfg = getActive();
        if (!cfg.aiConfig?.enabled || cfg.security?.disableAI) {
            throw new Error('AI features are disabled');
        }
        return cfg.aiConfig;
    };

    registerGuarded(
        'ai_summarize',
        {
            description: 'Summarize markdown via configured AI',
            inputSchema: { content: z.string() }
        },
        async ({ content }) => {
            try {
                requireWriter(user);
                const ai = aiGate();
                const service = AIServiceFactory.create(ai.provider, {
                    baseUrl: ai.baseUrl,
                    modelId: ai.modelId,
                    apiKey: ai.apiKey
                });
                return text({ summary: await service.summarize(content) });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'ai_enhance',
        {
            description: 'Enhance markdown via configured AI',
            inputSchema: { content: z.string() }
        },
        async ({ content }) => {
            try {
                requireWriter(user);
                const ai = aiGate();
                const service = AIServiceFactory.create(ai.provider, {
                    baseUrl: ai.baseUrl,
                    modelId: ai.modelId,
                    apiKey: ai.apiKey
                });
                return text({ enhanced: await service.enhance(content) });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'ai_list_models',
        { description: 'List models from configured AI provider', inputSchema: {} },
        async () => {
            try {
                requireWriter(user);
                const ai = aiGate();
                const service = AIServiceFactory.create(ai.provider, {
                    baseUrl: ai.baseUrl,
                    modelId: '',
                    apiKey: ai.apiKey
                });
                return text({ models: await service.getModels() });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    return server;
}
