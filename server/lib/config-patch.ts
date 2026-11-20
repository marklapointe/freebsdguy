/**
 * Strict validation of a config patch from an API caller (P0 E1).
 *
 * sanitizeConfig stays forward-compatible on load (a newer file with keys this
 * version does not know must still load). A *patch* from a caller is different:
 * it may only name keys this site exposes for editing, and never a security,
 * service or path key, or a prototype-pollution key. An unknown key is an error,
 * not something to drop silently, and a rejected patch writes nothing.
 */

const NO_CHANGES = 'No changes were saved.';
const REST_HINT = 'Use POST /api/admin/config to change it.';
const FILE_ONLY_HINT = 'This setting can only be changed in the config file on the server.';
const CONFIG_FILE_ONLY_KEYS = new Set(['corsOrigins', 'bind', 'tls', 'postsDir', 'themeDir']);

export type PatchCheck = { ok: true } | { ok: false; error: string };

/** Top-level keys an MCP update_config patch may name. */
export const MCP_CONFIG_KEYS = [
    'siteName', 'siteLogo', 'currentTheme', 'pagination', 'sortBy', 'sortOrder',
    'searchPlacement', 'appearance', 'footer'
] as const;

const MCP_NESTED_KEYS: Record<string, readonly string[]> = {
    appearance: ['themeMode', 'crtEffects', 'textGlow'],
    footer: ['show', 'copyrightText', 'creditText']
};

/** Keys the admin REST route accepts at the top level (it also edits service, security and AI). */
export const REST_CONFIG_KEYS = [
    ...MCP_CONFIG_KEYS, 'security', 'service', 'aiConfig'
] as const;

/** Keys the admin REST route may change that an MCP patch may not. */
const REST_ONLY_KEYS = new Set<string>(REST_CONFIG_KEYS.filter((k) => !(MCP_CONFIG_KEYS as readonly string[]).includes(k)));

/**
 * Nested keys the admin REST route accepts. corsOrigins, service.bind and
 * service.tls are config-file only: never settable from a request body.
 */
const REST_NESTED_KEYS: Record<string, readonly string[]> = {
    service: ['port'],
    security: [
        'authMode', 'sessionTtlSeconds', 'sessionCookieName', 'disableAI', 'disableImages',
        'disablePublicSearch', 'disableWebLogin', 'apiRateLimitWindow', 'apiRateLimitMax',
        'loginRateLimitWindow', 'loginRateLimitMax', 'mcpRateLimitWindow', 'mcpRateLimitMax',
        'trustProxy', 'tokenRateLimits'
    ],
    aiConfig: ['enabled', 'provider', 'baseUrl', 'modelId', 'apiKey']
};

/** Keys that are never settable through an MCP patch, whatever their place. */
export const FORBIDDEN_CONFIG_KEYS = new Set([
    'service', 'security', 'postsDir', 'themeDir', 'aiConfig', 'csp', 'bind', 'corsOrigins',
    'authMode', 'tls'
]);

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

export const TOO_DEEP = 'depth';
export const MAX_PATCH_DEPTH = 20;

/**
 * The first prototype-pollution key found anywhere in the value, or null, or
 * TOO_DEEP when the value nests deeper than MAX_PATCH_DEPTH.
 * Object.getOwnPropertyNames sees an own "__proto__" that JSON.parse creates and
 * that a plain `in`/`Object.keys` walk of a spread copy would miss; an object
 * whose prototype was replaced is reported too.
 */
export function findPollutionKey(value: unknown, depth = 0): string | null {
    if (depth > MAX_PATCH_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findPollutionKey(item, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return '__proto__';
    for (const name of Object.getOwnPropertyNames(value)) {
        if (POLLUTION_KEYS.has(name)) return name;
        const hit = findPollutionKey((value as Record<string, unknown>)[name], depth + 1);
        if (hit) return hit;
    }
    return null;
}

function isWebLoginOnly(v: unknown): boolean {
    if (!isPlainObject(v)) return false;
    const names = Object.getOwnPropertyNames(v);
    return names.length === 1 && names[0] === 'disableWebLogin' && typeof v.disableWebLogin === 'boolean';
}

function pollutionError(what: 'patch' | 'body', bad: string): string {
    if (bad === TOO_DEEP) return `Config ${what} is more than ${MAX_PATCH_DEPTH} levels deep. ${NO_CHANGES}`;
    return `Config ${what} contains a forbidden key (${bad}). ${NO_CHANGES}`;
}

/** Validate the patch of the MCP update_config tool. The error never echoes a value. */
export function validateMcpConfigPatch(patch: unknown): PatchCheck {
    if (!isPlainObject(patch)) return { ok: false, error: `Config patch must be an object. ${NO_CHANGES}` };
    const bad = findPollutionKey(patch);
    if (bad) return { ok: false, error: pollutionError('patch', bad) };
    const allowed = new Set<string>(MCP_CONFIG_KEYS);
    for (const key of Object.getOwnPropertyNames(patch)) {
        // Compatibility (Track 2120): a patch that names only security.disableWebLogin
        // is accepted and the flag is ignored with a warning, as it always was. It is
        // the one security key that is inert here; every other security key is refused.
        if (key === 'security' && isWebLoginOnly(patch[key])) continue;
        if (FORBIDDEN_CONFIG_KEYS.has(key)) {
            const v = patch[key];
            const fileOnly =
                CONFIG_FILE_ONLY_KEYS.has(key) ||
                (REST_ONLY_KEYS.has(key) &&
                    isPlainObject(v) &&
                    Object.getOwnPropertyNames(v).some((k) => CONFIG_FILE_ONLY_KEYS.has(k)));
            const hint = fileOnly ? ` ${FILE_ONLY_HINT}` : REST_ONLY_KEYS.has(key) ? ` ${REST_HINT}` : '';
            return { ok: false, error: `Config key "${key}" cannot be changed through this tool.${hint} ${NO_CHANGES}` };
        }
        if (!allowed.has(key)) return { ok: false, error: `Unknown config key "${key}". ${NO_CHANGES}` };
        const nested = MCP_NESTED_KEYS[key];
        if (nested) {
            const value = patch[key];
            if (!isPlainObject(value)) return { ok: false, error: `Config key "${key}" must be an object. ${NO_CHANGES}` };
            for (const inner of Object.getOwnPropertyNames(value)) {
                if (FORBIDDEN_CONFIG_KEYS.has(inner)) {
                    return { ok: false, error: `Config key "${key}.${inner}" cannot be changed through this tool. ${NO_CHANGES}` };
                }
                if (!nested.includes(inner)) return { ok: false, error: `Unknown config key "${key}.${inner}". ${NO_CHANGES}` };
            }
        }
    }
    return { ok: true };
}

/** Validate the body of POST /api/admin/config: no pollution key, no unknown top-level key. */
export function validateRestConfigBody(body: unknown): PatchCheck {
    if (!isPlainObject(body)) return { ok: true }; // an empty/non-object body is a no-op there
    const bad = findPollutionKey(body);
    if (bad) return { ok: false, error: pollutionError('body', bad) };
    const allowed = new Set<string>(REST_CONFIG_KEYS);
    for (const key of Object.getOwnPropertyNames(body)) {
        if (key === 'postsDir' || key === 'themeDir') {
            return { ok: false, error: `Config key "${key}" cannot be changed through this route. ${FILE_ONLY_HINT} ${NO_CHANGES}` };
        }
        if (!allowed.has(key)) return { ok: false, error: `Unknown config key "${key}". ${NO_CHANGES}` };
    }
    for (const [section, keys] of Object.entries(REST_NESTED_KEYS)) {
        const value = body[section];
        if (value === undefined || !isPlainObject(value)) continue;
        for (const inner of Object.getOwnPropertyNames(value)) {
            if (!keys.includes(inner)) {
                return { ok: false, error: `Config key "${section}.${inner}" cannot be changed through this route. ${NO_CHANGES}` };
            }
        }
    }
    const sec = body.security;
    if (isPlainObject(sec) && sec.authMode !== undefined && sec.authMode !== 'jwt' && sec.authMode !== 'session') {
        return { ok: false, error: `security.authMode must be "jwt" or "session". ${NO_CHANGES}` };
    }
    return { ok: true };
}
