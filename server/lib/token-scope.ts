/**
 * Personal-access-token scopes. A token holds a set of scopes: the narrowest is
 * "read", which every token has implicitly. A tool or a REST route asks for one
 * scope, and a token that does not hold it is refused.
 */

/** Every scope a token may hold. */
export const TOKEN_SCOPES = ['read', 'content:write', 'publish', 'moderate', 'admin'] as const;

export type Scope = (typeof TOKEN_SCOPES)[number];

/** The scopes a token holds. */
export type TokenScopes = readonly Scope[];

/** The legacy single scope, kept for display and for records written before scopes. */
export type TokenScope = 'read' | 'write';

export const READ_ONLY_SCOPES: TokenScopes = ['read'];

/** Legacy "write" meant every capability. It still does, so old tokens keep working. */
export const LEGACY_WRITE_SCOPES: TokenScopes = [
    'read',
    'content:write',
    'publish',
    'moderate',
    'admin'
];

/** The names a scope request may use, in the order the refusal message lists them. */
export const ALLOWED_SCOPE_NAMES = 'read, content:write, publish, moderate, admin, write';

/** The refusal message names the scope the caller is missing. */
export function scopeDeniedMessage(scope: Scope): string {
    return `Token lacks scope ${scope}`;
}

/**
 * The scope each MCP tool needs. A tool that is not listed here needs "admin",
 * so a tool added later without a mapping is admin-only.
 */
const TOOL_SCOPES: Record<string, Scope> = {
    get_playbook: 'read',
    health: 'read',
    list_posts: 'read',
    get_post: 'read',
    list_images: 'read',
    list_themes: 'read',
    create_post: 'content:write',
    update_post: 'content:write',
    publish_post: 'publish',
    upload_image: 'content:write',
    ai_summarize: 'content:write',
    ai_enhance: 'content:write',
    ai_list_models: 'content:write',
    unpublish_post: 'moderate',
    delete_post: 'content:write',
    delete_image: 'moderate',
    get_config: 'admin',
    update_config: 'admin',
    set_theme: 'admin',
    save_theme: 'admin',
    list_users: 'admin',
    create_user: 'admin',
    delete_user: 'admin',
    list_tokens: 'admin',
    create_token: 'admin',
    revoke_token: 'admin'
};

/**
 * Every MCP tool the server knows. A tool that is not in this set is unknown:
 * the server never registered it, so a call for it is an error, not a denial.
 */
export const KNOWN_MCP_TOOLS: ReadonlySet<string> = new Set(Object.keys(TOOL_SCOPES));

/** MCP tools that change server state (their handlers write). */
const MUTATING_MCP_TOOLS = new Set([
    'create_post',
    'update_post',
    'publish_post',
    'unpublish_post',
    'delete_post',
    'upload_image',
    'delete_image',
    'update_config',
    'set_theme',
    'save_theme',
    'create_user',
    'delete_user',
    'create_token',
    'revoke_token',
    'ai_summarize',
    'ai_enhance'
]);

/** MCP tools only an admin may run (their handlers call requireAdmin). */
export const ADMIN_ONLY_MCP_TOOLS: ReadonlySet<string> = new Set([
    'get_config', 'update_config', 'list_themes', 'set_theme', 'save_theme',
    'list_users', 'create_user', 'delete_user', 'unpublish_post'
]);

/** MCP tools that need contributor or admin (their handlers call requireWriter). */
export const WRITER_MCP_TOOLS: ReadonlySet<string> = new Set([
    'create_post', 'update_post', 'publish_post', 'delete_post', 'list_images',
    'upload_image', 'delete_image', 'ai_summarize', 'ai_enhance', 'ai_list_models'
]);

function isScopeName(value: string): value is Scope {
    return (TOKEN_SCOPES as readonly string[]).includes(value);
}

/** Order the names by the canonical scope order and make sure "read" is included. */
function normalizeScopes(names: readonly string[]): TokenScopes {
    const wanted = new Set<string>(names);
    wanted.add('read');
    return TOKEN_SCOPES.filter((scope) => wanted.has(scope));
}

function invalidScope(): Error {
    return new Error(`Invalid token scope; allowed: ${ALLOWED_SCOPE_NAMES}`);
}

function scopesFromNames(names: readonly string[]): TokenScopes {
    for (const name of names) {
        if (name === 'write') return LEGACY_WRITE_SCOPES;
        if (!isScopeName(name)) throw invalidScope();
    }
    return normalizeScopes(names);
}

/**
 * Parse a requested scope: one name, a comma separated list, or an array of
 * names. The legacy "write" still means every scope, and every token keeps
 * "read" whether or not it was asked for.
 */
export function parseTokenScopes(value: unknown, fallback: TokenScopes = READ_ONLY_SCOPES): TokenScopes {
    if (value === undefined || value === null || value === '') return normalizeScopes(fallback);
    if (typeof value === 'string') {
        const names = value.split(',').map((n) => n.trim()).filter((n) => n !== '');
        if (!names.length) return normalizeScopes(fallback);
        return scopesFromNames(names);
    }
    if (Array.isArray(value)) {
        const names: string[] = [];
        for (const entry of value) {
            if (typeof entry !== 'string') throw invalidScope();
            const trimmed = entry.trim();
            if (trimmed !== '') names.push(trimmed);
        }
        if (!names.length) return normalizeScopes(fallback);
        return scopesFromNames(names);
    }
    throw invalidScope();
}

/**
 * The scopes of a stored record. A record written before scopes existed holds
 * a single "scope" name, where "write" still means every scope. Anything we
 * cannot read is read-only, as before.
 */
export function storedTokenScopes(value: unknown): TokenScopes {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as { scopes?: unknown; scope?: unknown };
        if (record.scopes !== undefined) return storedTokenScopes(record.scopes);
        return storedTokenScopes(record.scope);
    }
    if (value === undefined || value === null || value === '') return READ_ONLY_SCOPES;
    if (Array.isArray(value)) {
        const names: string[] = [];
        for (const entry of value) {
            if (typeof entry !== 'string') return READ_ONLY_SCOPES;
            const trimmed = entry.trim();
            if (trimmed !== '') names.push(trimmed);
        }
        if (!names.length) return READ_ONLY_SCOPES;
        for (const name of names) {
            if (name !== 'write' && !isScopeName(name)) return READ_ONLY_SCOPES;
        }
        if (names.includes('write')) return LEGACY_WRITE_SCOPES;
        return normalizeScopes(names);
    }
    if (typeof value === 'string') {
        return value.trim() === 'write' ? LEGACY_WRITE_SCOPES : READ_ONLY_SCOPES;
    }
    return READ_ONLY_SCOPES;
}

/**
 * The legacy single-scope label of a scope set, for display only.
 *
 * Legacy "write" meant every capability (LEGACY_WRITE_SCOPES), so it is only
 * honest for a token that really holds every scope. Any narrower set is
 * labelled "read" — the label must never overstate what the token can do. The
 * "scopes" field stays the truth.
 */
export function legacyScopeLabel(scopes: TokenScopes): TokenScope {
    const held = new Set<string>(scopes);
    if (held.size !== LEGACY_WRITE_SCOPES.length) return 'read';
    return LEGACY_WRITE_SCOPES.every((scope) => held.has(scope)) ? 'write' : 'read';
}

/** The scope a tool needs. An unmapped tool needs "admin". */
export function requiredScopeForTool(name: string): Scope {
    return TOOL_SCOPES[name] ?? 'admin';
}

/** Whether these scopes let the holder run the tool. */
export function tokenAllowsTool(scopes: TokenScopes, name: string): boolean {
    return scopes.includes(requiredScopeForTool(name));
}

/**
 * The path a scope check looks at: the query string dropped and the path
 * lowercased. Express matches routes case-insensitively, so /API/admin/config
 * reaches the admin handler — the scope check has to see the same route, or a
 * mixed-case URL would slip past the scope it owes.
 */
function scopePath(rawPath: string): string {
    return (rawPath || '').split('?')[0].toLowerCase();
}

/** HTTP methods that change server state. /mcp is excluded — tool scope is checked inside MCP. */
export function isMutatingHttpRequest(method: string, rawPath: string): boolean {
    const m = (method || '').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    const pathOnly = scopePath(rawPath);
    if (m === 'POST' && pathOnly === '/api/login') return false;
    if (pathOnly === '/mcp' || pathOnly.startsWith('/mcp/')) return false;
    return pathOnly === '/api' || pathOnly.startsWith('/api/');
}

/** The scope a mutating REST call needs. */
function requiredScopeForHttp(method: string, rawPath: string): Scope {
    const pathOnly = scopePath(rawPath);
    // Deleting a post is authoring: post-policy then allows only the author's
    // own draft (or a moderator/admin). Deleting anyone's content other than a
    // post (images) is moderation.
    if (method === 'DELETE' && pathOnly.startsWith('/api/posts/')) return 'content:write';
    if (pathOnly === '/api/admin/images/delete-bulk') return 'moderate';
    if (method === 'DELETE' && pathOnly.startsWith('/api/admin/images')) return 'moderate';
    // The rest of /api/admin and the token routes administer the site.
    if (pathOnly.startsWith('/api/admin/')) return 'admin';
    if (pathOnly === '/api/tokens' || pathOnly.startsWith('/api/tokens/')) return 'admin';
    return 'content:write';
}

/**
 * The scope this request needs that the token does not hold, or null when the
 * request may proceed.
 */
export function httpScopeDenied(scopes: TokenScopes, method: string, rawPath: string): Scope | null {
    if (!isMutatingHttpRequest(method, rawPath)) return null;
    const required = requiredScopeForHttp((method || '').toUpperCase(), rawPath);
    return scopes.includes(required) ? null : required;
}

/** Whether the role may run the tool at all (their handlers check the role too). */
export function roleAllowsMcpTool(name: string, role: string): boolean {
    if (ADMIN_ONLY_MCP_TOOLS.has(name)) return role === 'admin';
    if (WRITER_MCP_TOOLS.has(name)) return role === 'admin' || role === 'contributor';
    return true;
}

/**
 * Whether tools/list should show a tool (Track #1701 F9). Hidden tools are not
 * registered at all, so calling one fails as an unknown tool. Handlers keep
 * their own role and scope checks.
 */
export function mcpToolVisible(name: string, role: string, scopes?: TokenScopes): boolean {
    if (!roleAllowsMcpTool(name, role)) return false;
    if (scopes && !tokenAllowsTool(scopes, name)) return false;
    return true;
}

/** The legacy single scope of a request. */
export function parseTokenScope(value: unknown, fallback: TokenScope = 'read'): TokenScope {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === 'read' || value === 'write') return value;
    throw new Error('Invalid token scope; allowed: read, write');
}

/** Missing or unknown stored scope is read. Write is only the explicit value "write". */
export function storedTokenScope(value: unknown): TokenScope {
    return value === 'write' ? 'write' : 'read';
}

/** Whether a read-only token may call the tool. */
export function isReadAllowedMcpTool(name: string): boolean {
    return requiredScopeForTool(name) === 'read';
}

export function isMutatingMcpTool(name: string): boolean {
    return MUTATING_MCP_TOOLS.has(name);
}

/** Whether a read-only token is refused this request. */
export function readTokenDenied(scope: TokenScope | undefined, method: string, rawPath: string): boolean {
    return scope === 'read' && isMutatingHttpRequest(method, rawPath);
}
