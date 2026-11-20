/**
 * Track 2119 (threat model A1/A6) — a personal access token the server cannot trust
 * is answered with 401, not 403, and tokens can carry an expiry.
 *
 * A1/A6: an unknown, revoked, expired or orphaned token means "you are not
 * authenticated", so the answer is 401 with a WWW-Authenticate header and one body
 * that does not tell the caller which of the four it was. A read token that may not
 * perform the request is a different thing: that token IS trusted, so it stays 403.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { mintToken, verifyToken, revokeToken, MAX_TOKENS_PER_USER } from '../server/lib/api-tokens.ts';
import { parseMintTokenArgs } from '../server/lib/mint-token-cli.ts';
import { RoleGuardFactory } from '../server/middleware/auth.ts';
import { app } from '../server/index.ts';

const DENIED_MESSAGE = 'Invalid or expired token';
const DAY_MS = 24 * 60 * 60 * 1000;

let tmp = '';
let tokensFile = '';
let usersFile = '';
let auditFile = '';

/** Response double with the three things the PAT middleware touches. */
function mockRes() {
    const res: any = {
        statusCode: 200,
        body: null as any,
        headers: {} as Record<string, string>,
        status(c: number) {
            this.statusCode = c;
            return this;
        },
        set(name: string, value: string) {
            this.headers[String(name).toLowerCase()] = value;
            return this;
        },
        json(b: any) {
            this.body = b;
            return this;
        }
    };
    return res;
}

/** The audit rows written so far. */
function auditRows(): Record<string, unknown>[] {
    if (!fs.existsSync(auditFile)) return [];
    return fs
        .readFileSync(auditFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Write users.json the way the admin UI leaves it. */
function writeUsers(usernames: string[]): void {
    fs.writeFileSync(
        usersFile,
        JSON.stringify({
            admin: { username: 'admin', passwordHash: 'not-empty-hash', role: 'admin' },
            users: usernames.map((username) => ({
                username,
                passwordHash: 'not-empty-hash',
                role: 'contributor'
            }))
        })
    );
}

/** Put a token's expiry in the past on disk, the way a dated record looks. */
function expireOnDisk(id: string): void {
    const records = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as Array<Record<string, unknown>>;
    const rec = records.find((r) => r.id === id);
    expect(rec).toBeTruthy();
    rec.expiresAt = Date.now() - 60_000;
    fs.writeFileSync(tokensFile, JSON.stringify(records));
}

/** A PAT-shaped string that was never minted. */
const UNKNOWN_TOKEN = 'mdw_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('a token that cannot be trusted answers 401', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-2119-'));
        tokensFile = path.join(tmp, 'tokens.json');
        usersFile = path.join(tmp, 'users.json');
        auditFile = path.join(tmp, 'audit.log');
        vi.stubEnv('TOKENS_PATH', tokensFile);
        vi.stubEnv('USERS_PATH', usersFile);
        vi.stubEnv('AUDIT_LOG_PATH', auditFile);
        vi.stubEnv('MDWEB_AUTH_MODE', 'jwt');
        writeUsers(['writer']);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('a. an unknown token is 401 with WWW-Authenticate and the standard body', async () => {
        const res = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${UNKNOWN_TOKEN}`);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: DENIED_MESSAGE });
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('b. a revoked token is 401 with the same body', async () => {
        const { plaintext, record } = mintToken('admin', 'revoked', 'read');
        expect(revokeToken(record.id)).toBe(true);

        const res = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: DENIED_MESSAGE });
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('c. an expired token is 401 and verifyToken refuses it', async () => {
        const { plaintext, record } = mintToken('admin', 'expired', 'read');
        expireOnDisk(record.id);

        expect(verifyToken(plaintext)).toBeNull();

        const res = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: DENIED_MESSAGE });
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('d. a token whose user is gone is 401 with the same body', async () => {
        const { plaintext } = mintToken('writer', 'orphan', 'read');
        // The user is deleted from users.json; the token record itself is untouched.
        writeUsers([]);

        const res = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: DENIED_MESSAGE });
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('e. a valid token still passes and a read token is still refused with 403', async () => {
        const guards = new RoleGuardFactory('test-secret-at-least-16-chars', { getMode: () => 'jwt' });
        const auth = guards.authenticate();
        const next = vi.fn();
        const { plaintext } = mintToken('admin', 'good', 'read');

        const res = mockRes();
        const req: any = { headers: { authorization: `Bearer ${plaintext}` }, method: 'GET', originalUrl: '/api/me' };
        auth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user.username).toBe('admin');
        expect(req.authVia).toBe('pat');
        expect(res.statusCode).toBe(200);

        // Scope denial is unchanged: the token is trusted, it may just not write.
        const denied = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${plaintext}`)
            .send({ slug: '2119-scope', title: 'T', content: 'C' });
        expect(denied.status).toBe(403);
        expect(denied.body.message).toMatch(/Token lacks scope/i);
    });

    it('h. every denial writes a token/denied audit row and no token text', async () => {
        const revoked = mintToken('admin', 'audit-revoked', 'read');
        revokeToken(revoked.record.id);
        const expired = mintToken('admin', 'audit-expired', 'read');
        expireOnDisk(expired.record.id);
        const orphan = mintToken('writer', 'audit-orphan', 'read');
        writeUsers([]);

        await request(app).get('/api/me').set('Authorization', `Bearer ${UNKNOWN_TOKEN}`);
        await request(app).get('/api/me').set('Authorization', `Bearer ${revoked.plaintext}`);
        await request(app).get('/api/me').set('Authorization', `Bearer ${expired.plaintext}`);
        await request(app).get('/api/me').set('Authorization', `Bearer ${orphan.plaintext}`);

        const denied = auditRows().filter((r) => r.event === 'token' && r.action === 'denied');
        expect(denied).toHaveLength(4);
        for (const row of denied) {
            expect(['invalid', 'user']).toContain(row.reason);
        }
        // The orphan is the one that names a user; the other three are the token itself.
        expect(denied.filter((r) => r.reason === 'user')).toHaveLength(1);
        expect(denied.filter((r) => r.reason === 'invalid')).toHaveLength(3);

        const raw = fs.readFileSync(auditFile, 'utf8');
        expect(raw).not.toContain('mdw_');
        expect(raw).not.toContain(UNKNOWN_TOKEN);
        expect(raw).not.toContain(revoked.plaintext);
        expect(raw).not.toContain(expired.plaintext);
        expect(raw).not.toContain(orphan.plaintext);
    });
});

describe('a token can carry an expiry', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-2119-ttl-'));
        tokensFile = path.join(tmp, 'tokens.json');
        usersFile = path.join(tmp, 'users.json');
        vi.stubEnv('TOKENS_PATH', tokensFile);
        vi.stubEnv('USERS_PATH', usersFile);
        writeUsers([]);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('f. mintToken sets expiresAt from ttlDays and refuses anything else', () => {
        const { record } = mintToken('admin', 'ttl', 'read', { ttlDays: 90 });
        expect(record.expiresAt).toBe(record.createdAt + 90 * DAY_MS);

        const disk = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        expect(disk[0].expiresAt).toBe(record.createdAt + 90 * DAY_MS);

        // No TTL means no expiry: the pre-2119 behaviour.
        const forever = mintToken('admin', 'no-ttl', 'read');
        expect(forever.record.expiresAt).toBeUndefined();
        expect(forever.record.createdAt).toBeGreaterThan(0);
        expect(verifyToken(forever.plaintext)).not.toBeNull();

        for (const bad of [0, -1, 366, 1.5, Number.NaN]) {
            expect(() => mintToken('admin', 'bad-ttl', 'read', { ttlDays: bad })).toThrow(/ttl/i);
        }
    });

    it('g. the CLI parses --ttl-days and refuses a bad value', () => {
        expect(
            parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'read', '--ttl-days', '90'])
        ).toMatchObject({ username: 'admin', scope: ['read'], ttlDays: 90 });
        expect(
            parseMintTokenArgs(['node', 'mint-token', '--username=admin', '--scope=read', '--ttl-days=30'])
        ).toMatchObject({ ttlDays: 30 });

        for (const bad of ['0', 'abc', '400', '-1', '1.5']) {
            expect(() =>
                parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'read', '--ttl-days', bad])
            ).toThrow(/ttl/i);
            expect(() =>
                parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'read', `--ttl-days=${bad}`])
            ).toThrow(/ttl/i);
        }

        // No TTL asked for means no TTL set.
        expect(parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'read'])).toMatchObject({
            ttlDays: undefined
        });
    });

    it('i. a damaged expiry on disk fails closed', () => {
        const { plaintext } = mintToken('admin', 'damaged', 'read');
        const records = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as Array<Record<string, unknown>>;
        records[0].expiresAt = null;
        fs.writeFileSync(tokensFile, JSON.stringify(records));

        expect(verifyToken(plaintext)).toBeNull();
    });

    it('j. expired tokens do not count against the active cap', () => {
        const ids: string[] = [];
        for (let i = 0; i < MAX_TOKENS_PER_USER; i++) {
            ids.push(mintToken('admin', `cap-${i}`, 'read').record.id);
        }
        for (const id of ids) expireOnDisk(id);

        expect(() => mintToken('admin', 'after-cap', 'read')).not.toThrow();
    });

    it('k. verifying a token does not lose its expiry on disk', () => {
        const { plaintext, record } = mintToken('admin', 'keep-expiry', 'read', { ttlDays: 90 });
        expect(verifyToken(plaintext)).not.toBeNull();

        const disk = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as Array<Record<string, unknown>>;
        expect(disk[0].expiresAt).toBe(record.createdAt + 90 * DAY_MS);
    });
});
