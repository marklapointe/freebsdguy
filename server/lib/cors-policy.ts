/**
 * CORS allowlist. Credentials are never paired with a wildcard origin.
 */

const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9._:-]+$/;

export function parseOriginList(raw: unknown): string[] {
    const parts: string[] = [];
    if (typeof raw === 'string') parts.push(...raw.split(','));
    else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string') parts.push(...item.split(','));
        }
    }
    const out: string[] = [];
    for (const part of parts) {
        const origin = part.trim();
        if (!origin || origin === '*') continue;
        if (!ORIGIN_RE.test(origin)) continue;
        if (!out.includes(origin)) out.push(origin);
    }
    return out;
}

/** Env wins when set (including a value that parses empty, such as "*"). */
export function resolveAllowedOrigins(configList: unknown, envValue: string | undefined): string[] {
    if (envValue !== undefined && envValue.trim() !== '') return parseOriginList(envValue);
    return parseOriginList(configList);
}

/**
 * Origin callback result for the cors package.
 * `true` is only used when the request has no Origin header (not a CORS request).
 * A present Origin is echoed only when it is on the allowlist — never "*".
 */
export function corsOriginDecision(allowed: string[], requestOrigin: string | undefined): string | false | true {
    if (!requestOrigin) return true;
    if (requestOrigin === '*') return false;
    if (allowed.includes(requestOrigin)) return requestOrigin;
    return false;
}
