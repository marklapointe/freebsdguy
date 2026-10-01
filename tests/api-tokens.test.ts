/**
 * Personal access tokens (PAT) — mint / verify / revoke / REST.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import {
    mintToken,
    verifyToken,
    listTokensForUser,
    listAllTokens,
    revokeToken,
    revokeTokensForUser,
    isPatToken,
    MAX_TOKENS_PER_USER
} from '../server/lib/api-tokens.ts';
import { loadUsers, saveUsers } from '../server/lib/config.ts';
import { app } from '../server/index.ts';

describe('api-tokens store', () => {
    let dir: string;
    let tokensPath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-tok-'));
        tokensPath = path.join(dir, 'tokens.json');
        vi.stubEnv('TOKENS_PATH', tokensPath);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('mints mdw_ token, stores only hash, verify resolves username', () => {
        const { plaintext, record } = mintToken('admin', 'cursor');
        expect(plaintext.startsWith('mdw_')).toBe(true);
        expect(isPatToken(plaintext)).toBe(true);
        expect(record.hash).toBeTruthy();
        expect(plaintext.includes(record.hash)).toBe(false);
        expect(record.prefix.length).toBeGreaterThanOrEqual(4);
        expect(record.label).toBe('cursor');

        const disk = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        expect(disk[0].hash).toBe(record.hash);
        expect(JSON.stringify(disk)).not.toContain(plaintext.slice(10));

        const v = verifyToken(plaintext);
        expect(v?.username).toBe('admin');
        expect(v?.id).toBe(record.id);
    });

    it('list never includes hash or plaintext', () => {
        mintToken('admin', 'a');
        const list = listTokensForUser('admin');
        expect(list).toHaveLength(1);
        expect(list[0]).not.toHaveProperty('hash');
        expect(Object.keys(list[0])).toEqual(
            expect.arrayContaining(['id', 'username', 'label', 'prefix', 'createdAt'])
        );
    });

    it('revoke rejects verify; revokeTokensForUser clears owner', () => {
        const users = loadUsers();
        users.users = [
            { username: 'bob', passwordHash: 'h', role: 'contributor' },
            { username: 'alice', passwordHash: 'h', role: 'contributor' }
        ];
        saveUsers(users);

        const { plaintext } = mintToken('bob', 'x');
        expect(revokeToken(listTokensForUser('bob')[0].id)).toBe(true);
        expect(verifyToken(plaintext)).toBeNull();

        const t2 = mintToken('bob', 'y');
        const t3 = mintToken('alice', 'z');
        expect(revokeTokensForUser('bob')).toBe(1);
        expect(verifyToken(t2.plaintext)).toBeNull();
        expect(verifyToken(t3.plaintext)?.username).toBe('alice');
    });

    it('enforces max active tokens per user', () => {
        for (let i = 0; i < MAX_TOKENS_PER_USER; i++) {
            mintToken('admin', `t${i}`);
        }
        expect(() => mintToken('admin', 'overflow')).toThrow(/limit/i);
    });

    it('listAllTokens returns all owners metadata', () => {
        const users = loadUsers();
        users.users = [{ username: 'bob', passwordHash: 'h', role: 'contributor' }];
        saveUsers(users);
        mintToken('admin', '1');
        mintToken('bob', '2');
        expect(listAllTokens()).toHaveLength(2);
    });
});

describe('PAT REST + auth', () => {
    const secret = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-tok-api-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
        vi.stubEnv('MDWEB_AUTH_MODE', 'jwt');
        const users = loadUsers();
        users.users = users.users.filter((u) => u.username !== 'writer');
        users.users.push({ username: 'writer', passwordHash: 'hash', role: 'contributor' });
        saveUsers(users);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('POST /api/tokens mints for self; GET lists without hash; DELETE revokes', async () => {
        const adminTok = jwt.sign({ username: 'admin', role: 'admin' }, secret);
        const create = await request(app)
            .post('/api/tokens')
            .set('Authorization', `Bearer ${adminTok}`)
            .send({ label: 'mine' });
        expect(create.status).toBe(201);
        expect(create.body.token).toMatch(/^mdw_/);
        const pat = create.body.token as string;

        const list = await request(app)
            .get('/api/tokens')
            .set('Authorization', `Bearer ${adminTok}`);
        expect(list.status).toBe(200);
        expect(list.body.tokens).toHaveLength(1);
        expect(list.body.tokens[0].hash).toBeUndefined();
        expect(JSON.stringify(list.body)).not.toContain(pat.slice(8));

        const me = await request(app).get('/api/me').set('Authorization', `Bearer ${pat}`);
        expect(me.status).toBe(200);
        expect(me.body.username).toBe('admin');
        expect(me.body.role).toBe('admin');

        const id = create.body.id as string;
        const del = await request(app)
            .delete(`/api/tokens/${id}`)
            .set('Authorization', `Bearer ${adminTok}`);
        expect(del.status).toBe(200);

        const me2 = await request(app).get('/api/me').set('Authorization', `Bearer ${pat}`);
        expect(me2.status).toBe(403);
    });

    it('admin mints for contributor; contributor cannot hit admin config', async () => {
        const adminTok = jwt.sign({ username: 'admin', role: 'admin' }, secret);
        const create = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${adminTok}`)
            .send({ username: 'writer', label: 'ci' });
        expect(create.status).toBe(201);
        const pat = create.body.token as string;

        const me = await request(app).get('/api/me').set('Authorization', `Bearer ${pat}`);
        expect(me.body.role).toBe('contributor');

        const cfg = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ siteName: 'Nope' });
        expect(cfg.status).toBe(403);
    });

    it('contributor cannot mint for another user via admin route', async () => {
        const adminTok = jwt.sign({ username: 'admin', role: 'admin' }, secret);
        const w = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${adminTok}`)
            .send({ username: 'writer', label: 'w' });
        const writerPat = w.body.token as string;

        const forbidden = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${writerPat}`)
            .send({ username: 'admin', label: 'steal' });
        expect(forbidden.status).toBe(403);
    });

    it('DELETE user revokes their PATs', async () => {
        const adminTok = jwt.sign({ username: 'admin', role: 'admin' }, secret);
        const create = await request(app)
            .post('/api/admin/tokens')
            .set('Authorization', `Bearer ${adminTok}`)
            .send({ username: 'writer', label: 'gone' });
        const pat = create.body.token as string;

        const del = await request(app)
            .delete('/api/admin/users/writer')
            .set('Authorization', `Bearer ${adminTok}`);
        expect(del.status).toBe(200);

        const me = await request(app).get('/api/me').set('Authorization', `Bearer ${pat}`);
        expect(me.status).toBe(403);
    });
});
