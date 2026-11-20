/**
 * Build a per-request McpServer with tools bound to the authenticated user.
 */
import { packageVersion } from '../lib/package-version.ts';
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
    loadConfig,
    getConfigLoadStatus,
    findUserByUsername,
    configPath,
    preserveWebLoginFlag,
    WEB_LOGIN_FLAG_IGNORED
} from '../lib/config.ts';
import { getPosts, getPost } from '../lib/posts.ts';
import {
    maySeePost,
    publishPostAsCaller,
    savePostAsCaller,
    unpublishPostAsCaller,
    deletePostAsCaller,
    type PostCaller
} from '../lib/post-policy.ts';
import {
    calculateMD5,
    loadManifest,
    saveManifest,
    findDuplicate,
    withManifestLock
} from '../lib/images.ts';
import { validateMcpConfigPatch } from '../lib/config-patch.ts';
import { PublicConfigBuilder } from '../lib/public-config.ts';
import { resolvePostsDir, resolveImagesDir, isSafeExistingPath } from '../lib/safe-path.ts';
import { listThemeCatalog, isValidThemeId, themeFilePath, selectThemeProblem } from '../lib/themes.ts';
import { AIServiceFactory } from '../lib/ai-service.ts';
import {
    mintToken,
    listTokensForUser,
    listAllTokens,
    revokeToken
} from '../lib/api-tokens.ts';
import { isAllowedRole, type Role } from '../middleware/auth.ts';
import {
    mcpToolVisible,
    parseTokenScopes,
    requiredScopeForTool,
    roleAllowsMcpTool,
    scopeDeniedMessage,
    tokenAllowsTool,
    type TokenScopes
} from '../lib/token-scope.ts';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MDWEB_MCP_INSTRUCTIONS, MDWEB_MCP_PLAYBOOK } from './playbook.ts';
import { writeAudit } from '../lib/audit-log.ts';
import { argsSha256, type AuthVia } from '../lib/audit-context.ts';
import sanitizeHtml from 'sanitize-html';

export type McpUser = { username: string; role: Role };

/** Who the caller is, for the audit rows of a tool call (Track #2119 U8). */
export interface McpAuditContext {
    /** The id of the personal access token, when the caller used one. */
    tokenId?: string;
    /** How the caller authenticated. */
    via?: AuthVia;
    /** The address the caller came from. */
    ip?: string;
    /** The site this server serves. */
    site?: string;
    /** The scopes the caller's token holds. */
    scopes?: TokenScopes;
}

export interface McpServerDeps {
    user: McpUser;
    getActive: () => Config;
    setActive: (c: Config) => void;
    /** Omitted for JWT/session callers, who are not scope-limited. */
    tokenScopes?: TokenScopes;
    /** Who the caller is, for the audit rows. Omitted when there is no request. */
    audit?: McpAuditContext;
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
    // Defence in depth: since #1701 F9 such callers never see writer tools.
    /* v8 ignore start */
    if (user.role !== 'admin' && user.role !== 'contributor') {
        throw new Error('Forbidden: contributor or admin required');
    }
    /* v8 ignore stop */
}

function requireAdmin(user: McpUser) {
    if (user.role !== 'admin') throw new Error('Forbidden: admin required');
}

/**
 * The MCP SDK answers tools/list with every tool it has registered, so a tool
 * this caller may not run would still be advertised. We keep the SDK's own tool
 * definitions and drop the ones the caller may not see. The tools stay
 * registered, so calling one answers with the scope it is missing instead of
 * "unknown tool".
 */
function scopeToolList(server: McpServer, isVisible: (name: string) => boolean): void {
    const low = server.server as unknown as {
        _requestHandlers: Map<
            string,
            (request: unknown, extra: unknown) => Promise<{ tools: { name: string }[] }>
        >;
        removeRequestHandler: (method: string) => void;
    };
    const sdkList = low._requestHandlers.get('tools/list');
    if (!sdkList) {
        throw new Error('MCP SDK: tools/list handler missing; the tool list cannot be scoped');
    }
    low.removeRequestHandler('tools/list');
    server.server.setRequestHandler(
        ListToolsRequestSchema,
        (async (request: unknown, extra: unknown) => {
            const result = await sdkList(request, extra);
            return { ...result, tools: result.tools.filter((tool) => isVisible(tool.name)) };
        }) as never
    );
}

function configDir() {
    return path.dirname(configPath());
}

/** True when a config patch mentions the config-file-only web-login kill switch. */
function patchMentionsWebLogin(patch: Record<string, unknown>): boolean {
    const sec = patch.security;
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return false;
    return Object.prototype.hasOwnProperty.call(sec, 'disableWebLogin');
}

function postsDir(cfg: Config) {
    return resolvePostsDir(configDir(), cfg.postsDir);
}

function imagesDir(cfg: Config) {
    return resolveImagesDir(configDir(), cfg.postsDir);
}

export function createMdwebMcpServer(deps: McpServerDeps): McpServer {
    const { user, getActive, setActive, tokenScopes } = deps;
    /** The caller of every tool: who it is and what its token may do. */
    const caller: PostCaller = {
        username: user.username,
        role: user.role,
        scopes: tokenScopes,
        tokenId: deps.audit?.tokenId,
        via: deps.audit?.via,
        ip: deps.audit?.ip,
        site: deps.audit?.site
    };

    const server = new McpServer(
        { name: 'mdweb', version: packageVersion() },
        { instructions: MDWEB_MCP_INSTRUCTIONS }
    );

    /**
     * The row of one tool call. It names the tool and the scopes, and the
     * hash of the arguments — never the arguments themselves — and says how
     * the call ended.
     */
    const writeMcpAudit = (
        tool: string,
        args: unknown,
        outcome: 'accepted' | 'denied' | 'error',
        reason?: string
    ) => {
        const audit = deps.audit;
        if (!audit) return;
        writeAudit({
            event: 'mcp',
            tool,
            scopes: audit.scopes ? [...audit.scopes] : [],
            argsSha256: argsSha256(args),
            outcome,
            ...(reason ? { reason } : {}),
            ...(audit.tokenId ? { tokenId: audit.tokenId } : {}),
            ...(audit.via ? { via: audit.via } : {}),
            ...(audit.ip ? { ip: audit.ip } : {}),
            ...(audit.site ? { site: audit.site } : {})
        });
    };

    const registerGuarded = (
        name: string,
        config: object,
        handler: (args: any, extra?: any) => any
    ) => {
        // A tool the role may not run is not registered at all, so calling it
        // fails as an unknown tool. A tool the scope does not cover stays
        // registered but is hidden from the tool list, so calling it names the
        // scope it is missing.
        if (!roleAllowsMcpTool(name, user.role)) return;
        server.registerTool(name, config as never, (async (args: any, extra: any) => {
            if (tokenScopes && !tokenAllowsTool(tokenScopes, name)) {
                writeMcpAudit(name, args, 'denied', `scope:${requiredScopeForTool(name)}`);
                return err(scopeDeniedMessage(requiredScopeForTool(name)));
            }
            try {
                const result = await handler(args, extra);
                const failed =
                    Boolean(result) &&
                    typeof result === 'object' &&
                    (result as { isError?: unknown }).isError === true;
                writeMcpAudit(name, args, failed ? 'error' : 'accepted');
                return result;
            } catch (e: unknown) {
                writeMcpAudit(name, args, 'error', 'exception');
                throw e;
            }
        }) as never);
    };

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
                offset: z.number().optional(),
                status: z
                    .enum(['draft', 'published', 'all'])
                    .optional()
                    .describe('Only drafts, only published posts, or all (default)')
            }
        },
        async ({ q, limit, offset, status }) => {
            try {
                const cfg = getActive();
                let posts = getPosts(postsDir(cfg), {
                    sortBy: (cfg.sortBy as 'date') || 'date',
                    sortOrder: (cfg.sortOrder as 'desc') || 'desc'
                });
                // A draft is private: only its author and the admins see it.
                posts = posts.filter((p) => maySeePost(p, caller));
                if (status && status !== 'all') {
                    posts = posts.filter((p) => p.status === status);
                }
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
                // A draft the caller may not see does not exist for them.
                if (!maySeePost(post, caller)) return err('Post not found');
                return text(post);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    /**
     * create_post and update_post are the same save: a slug that does not exist
     * yet becomes a draft stamped with the caller's name, an existing post may
     * only be saved by its author (or by an admin with the moderate scope) and
     * keeps its author, its status and its other front-matter keys.
     */
    const savePostAs = async (args: any) => {
        try {
            requireWriter(user);
            const slug = args.slug.trim();
            if (!slug) return err('slug is required');
            const dir = postsDir(getActive());
            const postPath = path.join(dir, `${slug}.md`);
            if (!isSafeExistingPath(dir, postPath)) return err('Forbidden slug');
            const result = savePostAsCaller(
                dir,
                {
                    slug,
                    title: args.title,
                    content: args.content,
                    summary: args.summary,
                    date: args.date,
                    pinned: args.pinned
                },
                caller
            );
            if (!result.ok) return err(result.error);
            return text({ message: 'Post saved', slug });
        } catch (e: unknown) {
            return err(e instanceof Error ? e.message : String(e));
        }
    };

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
        async (args) => savePostAs(args)
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
        async (args) => savePostAs(args)
    );

    registerGuarded(
        'publish_post',
        {
            description: 'Publish a post (draft becomes published)',
            inputSchema: { slug: z.string() }
        },
        async ({ slug }) => {
            try {
                requireWriter(user);
                const clean = slug.trim();
                if (!clean) return err('slug is required');
                const dir = postsDir(getActive());
                const postPath = path.join(dir, `${clean}.md`);
                if (!isSafeExistingPath(dir, postPath)) return err('Forbidden slug');
                const result = publishPostAsCaller(dir, clean, caller);
                if (!result.ok) return err(result.error);
                return text({ message: 'Post published', slug: clean });
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        }
    );

    registerGuarded(
        'unpublish_post',
        {
            description: 'Unpublish a post (published becomes draft). Admin only.',
            inputSchema: { slug: z.string() }
        },
        async ({ slug }) => {
            try {
                requireAdmin(user);
                const clean = slug.trim();
                if (!clean) return err('slug is required');
                const dir = postsDir(getActive());
                const postPath = path.join(dir, `${clean}.md`);
                if (!isSafeExistingPath(dir, postPath)) return err('Forbidden slug');
                const result = unpublishPostAsCaller(dir, clean, caller);
                if (!result.ok) return err(result.error);
                return text({ message: 'Post unpublished', slug: clean });
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
                if (!isSafeExistingPath(dir, postPath)) return err('Forbidden');
                const result = deletePostAsCaller(dir, slug, caller);
                if (!result.ok) return err(result.error);
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
                if (!isSafeExistingPath(dir, filePath)) return err('Forbidden');
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
            description:
                'Merge and save site config (admin). security.disableWebLogin is config-file only and is ignored here.',
            inputSchema: { patch: z.record(z.string(), z.unknown()) }
        },
        async ({ patch }) => {
            try {
                requireAdmin(user);
                // Allow-list first (P0 E1): an unknown, forbidden or prototype key
                // is an error and nothing is written.
                const check = validateMcpConfigPatch(patch);
                if (!check.ok) return err(check.error);
                // Merge over what is on disk, not over the in-memory copy: a save
                // must keep every key the file holds (service.port, keys a newer
                // version wrote). The in-memory copy is the fallback for a file
                // that cannot be read.
                const active = getActive();
                const disk = loadConfig();
                const current = getConfigLoadStatus().usedDefaults ? active : disk;
                if ((patch as Record<string, unknown>).currentTheme !== undefined) {
                    // Checked against the themeDir the save will actually keep (the on-disk one).
                    const themeProblem = selectThemeProblem(
                        configDir(),
                        current,
                        (patch as Record<string, unknown>).currentTheme
                    );
                    if (themeProblem) return err(`${themeProblem}. No changes were saved.`);
                }
                const merged: Record<string, unknown> = { ...current };
                for (const [key, value] of Object.entries(patch)) {
                    // security is never merged here: the only security key a patch may carry
                    // is the ignored disableWebLogin flag (see validateMcpConfigPatch).
                    if (key === 'security') continue;
                    const prev = (current as unknown as Record<string, unknown>)[key];
                    merged[key] =
                        (key === 'appearance' || key === 'footer') && prev && typeof prev === 'object'
                            ? { ...(prev as Record<string, unknown>), ...(value as Record<string, unknown>) }
                            : value;
                }
                const mergedSecurity =
                    merged.security && typeof merged.security === 'object' && !Array.isArray(merged.security)
                        ? { ...(merged.security as Record<string, unknown>) }
                        : {};
                // The web-login flag is config-file only: the file wins, the in-memory
                // copy is the fallback for a file that cannot be read.
                mergedSecurity.disableWebLogin = preserveWebLoginFlag(current);
                merged.security = mergedSecurity;
                const { config, warnings } = sanitizeConfig(merged);
                if (patchMentionsWebLogin(patch)) {
                    warnings.push(WEB_LOGIN_FLAG_IGNORED);
                }
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
                // A theme file that is a symlink is not a theme (P0 C1).
                const themeProblem = selectThemeProblem(configDir(), getActive(), themeId);
                if (themeProblem) return err(themeProblem);
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
                // Was covered by non-admin calls, which no longer see this tool (#1701 F9).
                /* v8 ignore start */
                return err(e instanceof Error ? e.message : String(e));
                /* v8 ignore stop */
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
                // Was covered by non-admin calls, which no longer see this tool (#1701 F9).
                /* v8 ignore start */
                return err(e instanceof Error ? e.message : String(e));
                /* v8 ignore stop */
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
                scope: z.union([z.string(), z.array(z.string())]).optional()
            }
        },
        async ({ label, username, scope }) => {
            try {
                const scopes = parseTokenScopes(scope);
                // A token may never mint a token that is stronger than itself.
                if (tokenScopes) {
                    const missing = scopes.find((s) => !tokenScopes.includes(s));
                    if (missing) return err(scopeDeniedMessage(missing));
                }
                const target = user.role === 'admin' && username ? username : user.username;
                if (!findUserByUsername(target)) return err('User not found');
                const { plaintext, record } = mintToken(target, label || '', scopes);
                return text({
                    token: plaintext,
                    id: record.id,
                    prefix: record.prefix,
                    username: record.username,
                    label: record.label,
                    scope: record.scope,
                    scopes: record.scopes,
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

    // F9: tools/list shows only what this caller may run.
    scopeToolList(server, (name) => mcpToolVisible(name, user.role, tokenScopes));

    return server;
}
