/**
 * Close the remaining lines the coverage gate still counts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../server/index.ts';
import { defaultConfig, loadConfig, loadUsers, saveUsers, usersPath } from '../server/lib/config.ts';
import { listAllTokens, listTokensForUser, mintToken, verifyToken } from '../server/lib/api-tokens.ts';
import { ensureChipFill, ensureRuntimeThemeCatalog } from '../server/lib/themes.ts';
import { DEFAULT_ADMIN_PASSWORD_HASH } from '../server/lib/default-credentials.ts';

const secret = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
const adminAuth = () => jwt.sign({ username: 'admin', role: 'admin' }, secret);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('coverage follow-up', () => {
    it('covers token scope errors, default-password login, and token limit', async () => {
        const originalUsers = usersPath();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-cov-follow-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
        const auth = adminAuth();

        const badScope = await request(app)
            .post('/api/tokens')
            .set('Authorization', `Bearer ${auth}`)
            .send({ label: 'x', scope: 'root' });
        expect(badScope.status).toBe(400);

        const missingUser = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${auth}`)
            .send({ label: 'x' });
        expect(missingUser.status).toBe(400);

        const unknown = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${auth}`)
            .send({ username: 'nobody-followup', scope: 'nope' });
        expect(unknown.status).toBe(404);
        const badAdminScope = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${auth}`)
            .send({ username: 'admin', scope: 'nope' });
        expect(badAdminScope.status).toBe(400);

        const listed = await request(app)
            .get('/api/admin/tokens')
            .query({ username: 'admin' })
            .set('Authorization', `Bearer ${auth}`);
        expect(listed.status).toBe(200);

        const users = loadUsers();
        users.users = users.users.filter((u) => u.username !== 'default-pw' && u.username !== 'writer' && u.username !== 'chmod-user');
        users.users.push(
            { username: 'writer', passwordHash: 'h', role: 'contributor' },
            { username: 'default-pw', passwordHash: DEFAULT_ADMIN_PASSWORD_HASH, role: 'contributor' },
            { username: 'chmod-user', passwordHash: 'h', role: 'contributor' }
        );
        saveUsers(users);
        const blocked = await request(app).post('/api/login').send({ username: 'default-pw', password: 'admin' });
        expect(blocked.status).toBe(403);

        const compare = vi.spyOn((await import('bcryptjs')).default, 'compare').mockRejectedValueOnce(new Error('compare failed'));
        const failedCompare = await request(app).post('/api/login').send({ username: 'default-pw', password: 'admin' });
        expect(failedCompare.status).toBe(401);
        compare.mockRestore();

        let limited = 201;
        for (let i = 0; i < 25 && limited !== 400; i++) {
            const res = await request(app)
                .post('/api/tokens')
                .set('Authorization', `Bearer ${auth}`)
                .send({ label: `n${i}`, scope: 'read' });
            limited = res.status;
        }
        expect(limited).toBe(400);
        const adminLimited = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${auth}`)
            .send({ username: 'admin', label: 'more', scope: 'read' });
        expect(adminLimited.status).toBe(400);

        const cleaned = loadUsers();
        cleaned.users = cleaned.users.filter((u) => u.username !== 'chmod-user' && u.username !== 'default-pw');
        saveUsers(cleaned);
        const sys = process.env.CONFIG_DIR;
        vi.stubEnv('CONFIG_DIR', '/usr/local/etc/mdweb');
        expect(defaultConfig().postsDir).toBe('/var/db/mdweb/posts');
        if (sys === undefined) delete process.env.CONFIG_DIR;
        else process.env.CONFIG_DIR = sys;

        const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-migrate-'));
        vi.stubEnv('CONFIG_PATH', path.join(fresh, 'config.json'));
        loadConfig();
        expect(fs.existsSync(path.join(fresh, 'config.json'))).toBe(true);

        const tokensFile = path.join(dir, 'odd-tokens.json');
        vi.stubEnv('TOKENS_PATH', tokensFile);
        fs.writeFileSync(tokensFile, '{}');
        expect(listTokensForUser('admin')).toEqual([]);
        fs.writeFileSync(tokensFile, 'not-json');
        expect(listTokensForUser('admin')).toEqual([]);
        expect(() => mintToken('no-such-user', 'x', 'read')).toThrow(/not found/i);
        mintToken('admin', 'one', 'read');
        mintToken('admin', 'two', 'write');
        expect(listAllTokens().length).toBeGreaterThanOrEqual(2);
        expect(listTokensForUser('admin').length).toBeGreaterThanOrEqual(2);
        const timing = vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
            throw new Error('timing');
        });
        const minted = mintToken('admin', 'timing', 'read');
        expect(verifyToken(minted.plaintext)).toBeNull();
        timing.mockRestore();
        for (const hex of ['#111111', '#777777', '#a0a0a0', '#5c6b73', '#c0c0c0', '#404040']) {
            expect(ensureChipFill(hex)).toMatch(/^#/);
        }
        const themeDest = path.join(dir, 'brand-new-themes');
        expect(ensureRuntimeThemeCatalog(themeDest).total).toBeGreaterThan(0);

        const lockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-lock-'));
        const lockedUsers = path.join(lockedDir, 'users.json');
        fs.writeFileSync(
            lockedUsers,
            JSON.stringify({
                admin: { username: 'admin', passwordHash: 'present', role: 'admin' },
                users: [{ username: 'chmod-user', passwordHash: 'h', role: 'contributor' }]
            })
        );
        vi.stubEnv('USERS_PATH', lockedUsers);
        const adminPat = mintToken('admin', 'lock', 'write').plaintext;
        fs.chmodSync(lockedDir, 0o555);
        try {
            const deleted = await request(app)
                .post('/mcp')
                .set('Authorization', `Bearer ${adminPat}`)
                .set('Accept', 'application/json, text/event-stream')
                .send({
                    jsonrpc: '2.0',
                    id: 9,
                    method: 'tools/call',
                    params: { name: 'delete_user', arguments: { username: 'chmod-user' } }
                });
            expect(JSON.stringify(deleted.body)).toMatch(/EACCES|permission|denied|read-only/i);
        } finally {
            fs.chmodSync(lockedDir, 0o755);
        }

        const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-tok-lock-'));
        const tokenFile = path.join(tokenDir, 'tokens.json');
        vi.stubEnv('TOKENS_PATH', tokenFile);
        vi.stubEnv('USERS_PATH', originalUsers);
        const pat = mintToken('admin', 'revoke-lock', 'write');
        fs.chmodSync(tokenDir, 0o555);
        try {
            const revoked = await request(app)
                .post('/mcp')
                .set('Authorization', `Bearer ${pat.plaintext}`)
                .set('Accept', 'application/json, text/event-stream')
                .send({
                    jsonrpc: '2.0',
                    id: 11,
                    method: 'tools/call',
                    params: { name: 'revoke_token', arguments: { id: pat.record.id } }
                });
            expect(JSON.stringify(revoked.body)).toMatch(/EACCES|permission|denied/i);
        } finally {
            fs.chmodSync(tokenDir, 0o755);
        }

        vi.unstubAllEnvs();
    });
});
