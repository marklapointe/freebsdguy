/**
 * The fields every audit row of a request carries (Track #2119 U8).
 *
 * A row says who acted (tokenId), how they authenticated (via), where the
 * request came from (ip) and which site served it (site). Nothing here is a
 * secret: the token id is a random handle, never the token itself, and the
 * arguments of a tool call are hashed, never written.
 */
import crypto from 'crypto';

/** How a caller authenticated. */
export type AuthVia = 'pat' | 'jwt' | 'session';

export interface AuditFields {
    /** The personal access token's id. Absent for a JWT or a session caller. */
    tokenId?: string;
    /** How the caller authenticated. */
    via?: AuthVia;
    /** The address the request came from. */
    ip?: string;
    /** The site this server serves. */
    site?: string;
}

/** The request shape the audit fields are read from. */
export interface AuditRequestLike {
    authVia?: AuthVia;
    tokenId?: string;
    ip?: string;
    socket?: { remoteAddress?: string | null } | null;
}

/**
 * The site this server serves: MDWEB_SITE_ID wins, then the host of the
 * configured siteUrl. A site that cannot be named is left out — a row never
 * claims a site it does not know.
 */
export function resolveAuditSite(
    cfg?: { siteUrl?: unknown } | null,
    env: NodeJS.ProcessEnv = process.env
): string | undefined {
    const fromEnv = env.MDWEB_SITE_ID;
    if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
    const url = cfg?.siteUrl;
    if (typeof url === 'string' && url.trim()) {
        try {
            return new URL(url.trim()).host || undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** The audit fields of a request. An anonymous request has none. */
export function requestAuditFields(
    req: AuditRequestLike | null | undefined,
    site?: string
): AuditFields {
    const fields: AuditFields = {};
    if (!req) return fields;
    if (req.tokenId) fields.tokenId = req.tokenId;
    if (req.authVia) fields.via = req.authVia;
    const ip = req.ip || req.socket?.remoteAddress || undefined;
    if (ip) fields.ip = ip;
    if (site) fields.site = site;
    return fields;
}

/**
 * Canonical JSON: the object keys are sorted, so two calls with the same
 * arguments in a different order hash the same. Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        const encoded = JSON.stringify(value);
        return encoded === undefined ? 'null' : encoded;
    }
    if (Array.isArray(value)) {
        return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return (
        '{' +
        keys
            .map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key]))
            .join(',') +
        '}'
    );
}

/** The sha256 of a string, hex. */
export function sha256Hex(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The sha256 of the canonical JSON of the arguments. The arguments themselves
 * never reach the audit log: a hash says "these arguments", not what they were.
 */
export function argsSha256(args: unknown): string {
    return sha256Hex(canonicalJson(args));
}
