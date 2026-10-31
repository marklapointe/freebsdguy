/**
 * Personal access tokens (PAT) for REST + MCP.
 * Plaintext shown once at mint; disk stores SHA-256 hashes only.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { usersPath, writeJsonAtomic, findUserByUsername } from './config.ts';
import { parseTokenScope, storedTokenScope, type TokenScope } from './token-scope.ts';

export const PAT_PREFIX = 'mdw_';
export const MAX_TOKENS_PER_USER = 20;

export interface TokenRecord {
    id: string;
    username: string;
    label: string;
    hash: string;
    prefix: string;
    scope: TokenScope;
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
}

/** Public metadata — never includes hash. */
export interface TokenPublic {
    id: string;
    username: string;
    label: string;
    prefix: string;
    scope: TokenScope;
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
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
    return {
        id: r.id,
        username: r.username,
        label: r.label,
        prefix: r.prefix,
        scope: storedTokenScope(r.scope),
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt
    };
}

function activeForUser(records: TokenRecord[], username: string): TokenRecord[] {
    return records.filter((r) => r.username === username && !r.revokedAt);
}

export function mintToken(
    username: string,
    label = '',
    scope?: unknown
): { plaintext: string; record: TokenRecord } {
    const parsedScope = parseTokenScope(scope);
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
    const record: TokenRecord = {
        id,
        username,
        label: String(label || '').slice(0, 120),
        hash: hashToken(plaintext),
        prefix,
        scope: parsedScope,
        createdAt: Date.now()
    };
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
