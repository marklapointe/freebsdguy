/**
 * Personal access tokens (PAT) for REST + MCP.
 * Plaintext shown once at mint; disk stores SHA-256 hashes only.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { usersPath, writeJsonAtomic, findUserByUsername } from './config.ts';
import {
    legacyScopeLabel,
    parseTokenScopes,
    storedTokenScopes,
    type Scope,
    type TokenScope
} from './token-scope.ts';

export const PAT_PREFIX = 'mdw_';
export const MAX_TOKENS_PER_USER = 20;
/** Longest lifetime a token may be given. */
export const MAX_TTL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenRecord {
    id: string;
    username: string;
    label: string;
    hash: string;
    prefix: string;
    /** The legacy single scope, kept for display and for records written before scopes. */
    scope: TokenScope;
    /** The scopes this token holds. */
    scopes: Scope[];
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
    /** Epoch ms at which the token stops authenticating. Absent = never expires. */
    expiresAt?: number;
}

/** Public metadata — never includes hash. */
export interface TokenPublic {
    id: string;
    username: string;
    label: string;
    prefix: string;
    /** The legacy single scope, kept for display. */
    scope: TokenScope;
    /** The scopes this token holds. */
    scopes: Scope[];
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
    expiresAt?: number;
}

export function tokensPath(): string {
    if (process.env.TOKENS_PATH) return process.env.TOKENS_PATH;
    return path.join(path.dirname(usersPath()), 'tokens.json');
}

export function isPatToken(token: string | undefined | null): boolean {
    return typeof token === 'string' && token.startsWith(PAT_PREFIX) && token.length > PAT_PREFIX.length + 8;
}

function hashToken(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
    try {
        const ba = Buffer.from(a, 'hex');
        const bb = Buffer.from(b, 'hex');
        if (ba.length !== bb.length) return false;
        return crypto.timingSafeEqual(ba, bb);
    } catch {
        return false;
    }
}

function loadRaw(): TokenRecord[] {
    const fp = tokensPath();
    if (!fs.existsSync(fp)) return [];
    try {
        const text = fs.readFileSync(fp, 'utf8');
        if (!text.trim()) return [];
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.hash === 'string'
        ) as TokenRecord[];
    } catch {
        return [];
    }
}

function saveRaw(records: TokenRecord[]): void {
    writeJsonAtomic(tokensPath(), records);
}

function toPublic(r: TokenRecord): TokenPublic {
    const scopes = storedTokenScopes(r);
    return {
        id: r.id,
        username: r.username,
        label: r.label,
        prefix: r.prefix,
        scope: legacyScopeLabel(scopes),
        scopes: [...scopes],
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
        expiresAt: r.expiresAt
    };
}

function ttlError(label: string): Error {
    return new Error(`${label} must be an integer between 1 and ${MAX_TTL_DAYS}`);
}

/**
 * Validate a lifetime in whole days. Undefined means "never expires"; anything that
 * is not an integer day count inside the range is refused, so a typo cannot mint a
 * token that quietly never expires.
 */
export function validateTtlDays(value: unknown, label = 'ttlDays'): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_TTL_DAYS) {
        throw ttlError(label);
    }
    return value;
}

/** Parse a lifetime written on a command line: digits only, then the same range check. */
export function parseTtlDays(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const raw = value.trim();
    if (!/^\d+$/.test(raw)) throw ttlError('ttl-days');
    return validateTtlDays(Number(raw), 'ttl-days');
}

/**
 * A token past its expiry no longer authenticates. A damaged expiry fails closed:
 * only a missing expiry means "never expires", anything else we cannot read as a
 * number (null, a string, NaN) is treated as already expired.
 */
function isExpired(record: TokenRecord, now: number = Date.now()): boolean {
    const expiresAt: unknown = record.expiresAt;
    if (expiresAt === undefined) return false;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return true;
    return now >= expiresAt;
}

function activeForUser(records: TokenRecord[], username: string): TokenRecord[] {
    return records.filter((r) => r.username === username && !r.revokedAt && !isExpired(r));
}

export function mintToken(
    username: string,
    label = '',
    scope?: unknown,
    opts?: { ttlDays?: number }
): { plaintext: string; record: TokenRecord } {
    const parsedScopes = parseTokenScopes(scope);
    const ttlDays = validateTtlDays(opts?.ttlDays);
    if (!username || !findUserByUsername(username)) {
        throw new Error('User not found or locked');
    }
    const records = loadRaw();
    if (activeForUser(records, username).length >= MAX_TOKENS_PER_USER) {
        throw new Error(`Token limit reached (max ${MAX_TOKENS_PER_USER} active per user)`);
    }

    const secret = crypto.randomBytes(32).toString('base64url');
    const plaintext = `${PAT_PREFIX}${secret}`;
    const id = crypto.randomBytes(16).toString('hex');
    const prefix = secret.slice(0, 8);
    const createdAt = Date.now();
    const record: TokenRecord = {
        id,
        username,
        label: String(label || '').slice(0, 120),
        hash: hashToken(plaintext),
        prefix,
        scope: legacyScopeLabel(parsedScopes),
        scopes: [...parsedScopes],
        createdAt
    };
    if (ttlDays !== undefined) record.expiresAt = createdAt + ttlDays * DAY_MS;
    records.push(record);
    saveRaw(records);
    return { plaintext, record };
}

export function verifyToken(plaintext: string): TokenPublic | null {
    if (!isPatToken(plaintext)) return null;
    const h = hashToken(plaintext);
    const records = loadRaw();
    const match = records.find((r) => !r.revokedAt && timingSafeEqualHex(r.hash, h));
    if (!match) return null;
    if (isExpired(match)) return null;
    match.lastUsedAt = Date.now();
    try {
        saveRaw(records);
    } catch {
        /* best-effort lastUsedAt */
    }
    return toPublic(match);
}

export function listTokensForUser(username: string): TokenPublic[] {
    return loadRaw()
        .filter((r) => r.username === username)
        .map(toPublic)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function listAllTokens(usernameFilter?: string): TokenPublic[] {
    return loadRaw()
        .filter((r) => !usernameFilter || r.username === usernameFilter)
        .map(toPublic)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeToken(id: string, opts?: { onlyUsername?: string }): boolean {
    const records = loadRaw();
    const rec = records.find((r) => r.id === id);
    if (!rec) return false;
    if (opts?.onlyUsername && rec.username !== opts.onlyUsername) return false;
    if (rec.revokedAt) return true;
    rec.revokedAt = Date.now();
    saveRaw(records);
    return true;
}

/** Soft-revoke all tokens for a username (user delete). Returns count newly revoked. */
export function revokeTokensForUser(username: string): number {
    const records = loadRaw();
    let n = 0;
    const now = Date.now();
    for (const r of records) {
        if (r.username === username && !r.revokedAt) {
            r.revokedAt = now;
            n++;
        }
    }
    if (n) saveRaw(records);
    return n;
}
