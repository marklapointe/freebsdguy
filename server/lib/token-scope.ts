/**
 * Personal-access-token scopes. A read token may fetch; it may not create, edit, or delete.
 */

export type TokenScope = 'read' | 'write';

export const READ_ONLY_TOKEN_MESSAGE = 'Read-only token cannot create, edit, or delete';

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

export function parseTokenScope(value: unknown, fallback: TokenScope = 'write'): TokenScope {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === 'read' || value === 'write') return value;
    throw new Error('Invalid token scope; allowed: read, write');
}

export function storedTokenScope(value: unknown): TokenScope {
    return value === 'read' ? 'read' : 'write';
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
