/**
 * Personal-access-token scopes. A read token may fetch; it may not create, edit, or delete.
 */

export type TokenScope = 'read' | 'write';

export const READ_ONLY_TOKEN_MESSAGE = 'Read-only token cannot create, edit, or delete';

/**
 * Tools a read token may call. Anything not listed — including tools added later —
 * is refused. list_users, list_tokens, get_config, and ai_list_models are not included.
 */
const READ_ALLOWED_MCP_TOOLS = new Set([
    'get_playbook',
    'health',
    'list_posts',
    'get_post',
    'list_images',
    'list_themes'
]);

const MUTATING_MCP_TOOLS = new Set([
    'create_post',
    'update_post',
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

export function parseTokenScope(value: unknown, fallback: TokenScope = 'read'): TokenScope {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === 'read' || value === 'write') return value;
    throw new Error('Invalid token scope; allowed: read, write');
}

/** Missing or unknown stored scope is read. Write is only the explicit value "write". */
export function storedTokenScope(value: unknown): TokenScope {
    return value === 'write' ? 'write' : 'read';
}

export function isReadAllowedMcpTool(name: string): boolean {
    return READ_ALLOWED_MCP_TOOLS.has(name);
}

export function isMutatingMcpTool(name: string): boolean {
    return MUTATING_MCP_TOOLS.has(name);
}

/** HTTP methods that change server state. /mcp is excluded — tool scope is checked inside MCP. */
export function isMutatingHttpRequest(method: string, rawPath: string): boolean {
    const m = (method || '').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    const pathOnly = (rawPath || '').split('?')[0];
    if (m === 'POST' && pathOnly === '/api/login') return false;
    if (pathOnly === '/mcp' || pathOnly.startsWith('/mcp/')) return false;
    return pathOnly === '/api' || pathOnly.startsWith('/api/');
}

export function readTokenDenied(scope: TokenScope | undefined, method: string, rawPath: string): boolean {
    return scope === 'read' && isMutatingHttpRequest(method, rawPath);
}

/** MCP tools only an admin may run (their handlers call requireAdmin). */
export const ADMIN_ONLY_MCP_TOOLS: ReadonlySet<string> = new Set([
    'get_config', 'update_config', 'list_themes', 'set_theme', 'save_theme',
    'list_users', 'create_user', 'delete_user'
]);

/** MCP tools that need contributor or admin (their handlers call requireWriter). */
export const WRITER_MCP_TOOLS: ReadonlySet<string> = new Set([
    'create_post', 'update_post', 'delete_post', 'list_images', 'upload_image',
    'delete_image', 'ai_summarize', 'ai_enhance', 'ai_list_models'
]);

/**
 * Whether tools/list should show a tool (Track #1701 F9). Hidden tools are not
 * registered at all, so calling one fails as an unknown tool. Handlers keep
 * their own role and scope checks.
 */
export function mcpToolVisible(name: string, role: string, scope?: TokenScope): boolean {
    if (scope === 'read' && !isReadAllowedMcpTool(name)) return false;
    if (ADMIN_ONLY_MCP_TOOLS.has(name)) return role === 'admin';
    if (WRITER_MCP_TOOLS.has(name)) return role === 'admin' || role === 'contributor';
    return true;
}
