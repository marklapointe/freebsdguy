/**
 * FreeBSD jail hardening (WP #1682).
 * Behavior tests written against the pre-fix server. Each assertion describes
 * the production rule; they fail until the corresponding fix lands.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken, verifyToken } from '../server/lib/api-tokens.ts';
import { defaultConfig, defaultUsers, loadUsers, sanitizeConfig, saveUsers } from '../server/lib/config.ts';
import { resolveJwtSecret } from '../server/lib/jwt-secret.ts';
import { runPreflight } from '../server/lib/preflight.ts';
import {
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_PASSWORD_HASH
} from '../server/lib/default-credentials.ts';
import { parseMintTokenArgs } from '../server/lib/mint-token-cli.ts';
import { resolveBindHost, startHttpServer } from '../server/lib/bind-address.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { bootstrapAdmin, issueSetupToken } from '../server/lib/setup-admin.ts';

function mcpCall(pat: string, body: unknown) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
}

describe('WP #1682 token scope', () => {
    let dir: string;
    let tokensFile: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-scope-'));
        tokensFile = path.join(dir, 'tokens.json');
        vi.stubEnv('TOKENS_PATH', tokensFile);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('stores read scope next to the token hash', () => {
        const { record } = mintToken('admin', 'reader', 'read');
        expect(record.scope).toBe('read');
        const disk = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        expect(disk[0].scope).toBe('read');
        expect(disk[0].hash).toBe(record.hash);
        expect(verifyToken(mintToken('admin', 'writer', 'write').plaintext)?.scope).toBe('write');
    });

    it('refuses read tokens on create, edit, and delete routes', async () => {
        const read = mintToken('admin', 'ro', 'read').plaintext;
        const write = mintToken('admin', 'rw', 'write').plaintext;

        const readPost = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${read}`)
            .send({ slug: 'scope-post', title: 'T', content: 'C' });
        expect(readPost.status).toBe(403);
        expect(JSON.stringify(readPost.body)).toMatch(/read-only/i);

        const readDelete = await request(app)
            .delete('/api/posts/does-not-exist')
            .set('Authorization', `Bearer ${read}`);
        expect(readDelete.status).toBe(403);

        const readUser = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${read}`)
            .send({ username: 'newuser', password: 'longpassword', role: 'contributor' });
        expect(readUser.status).toBe(403);

        const me = await request(app).get('/api/me').set('Authorization', `Bearer ${read}`);
        expect(me.status).toBe(200);

        const writePost = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${write}`)
            .send({ slug: 'scope-post', title: 'T', content: 'C' });
        expect(writePost.status).toBe(200);
    });

    it('refuses read tokens on mutating MCP tools and allows read tools', async () => {
        const read = mintToken('admin', 'mcp-ro', 'read').plaintext;
        const denied = await mcpCall(read, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'create_post',
                arguments: { slug: 'mcp-scope', title: 'T', content: 'C' }
            }
        });
        expect(denied.status).toBe(200);
        expect(JSON.stringify(denied.body)).toMatch(/read-only/i);

        const allowed = await mcpCall(read, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'list_posts', arguments: {} }
        });
        expect(allowed.status).toBe(200);
        expect(JSON.stringify(allowed.body)).not.toMatch(/read-only/i);
    });

    it('mint-token CLI reads --scope and rejects a password on argv', async () => {
        const parsed = parseMintTokenArgs([
            'node',
            'mint-token',
            '--username',
            'admin',
            '--label',
            'cursor',
            '--scope',
            'read'
        ]);
        expect(parsed).toMatchObject({ username: 'admin', label: 'cursor', scope: 'read' });
        expect(() =>
            parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'root'])
        ).toThrow(/scope/i);
    });
});

describe('WP #1682 bind address', () => {
    it('defaults service.host to 127.0.0.1 and keeps an explicit host', () => {
        expect(defaultConfig().service?.host).toBe('127.0.0.1');
        const kept = sanitizeConfig({ service: { port: 8080, host: '192.0.2.10' } });
        expect(kept.config.service?.host).toBe('192.0.2.10');
        expect(kept.config.service?.port).toBe(8080);
        const rejected = sanitizeConfig({ service: { port: 5173, host: '*' } });
        expect(rejected.config.service?.host).toBe('127.0.0.1');
        expect(rejected.warnings.join(' ')).toMatch(/host/i);
    });

    it('listen helper binds the configured host', async () => {
        expect(resolveBindHost({})).toBe('127.0.0.1');
        expect(resolveBindHost({ host: '0.0.0.0' })).toBe('0.0.0.0');
        const express = (await import('express')).default;
        const server = startHttpServer(express(), 0, '127.0.0.1');
        await new Promise<void>((resolve, reject) => {
            server.once('listening', () => resolve());
            server.once('error', reject);
        });
        const addr = server.address();
        expect(addr && typeof addr === 'object' ? addr.address : '').toBe('127.0.0.1');
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});

describe('WP #1682 rate limiting', () => {
    afterEach(async () => {
        vi.unstubAllEnvs();
        resetRateLimits();
    });

    it('returns 429 on login, /api, and /mcp when the configured limit is exceeded', async () => {
        resetRateLimits();
        vi.stubEnv('MDWEB_ENFORCE_RATE_LIMIT', '1');
        vi.stubEnv('MDWEB_LOGIN_RATE_MAX', '2');
        vi.stubEnv('MDWEB_LOGIN_RATE_WINDOW_MS', '60000');
        vi.stubEnv('MDWEB_API_RATE_MAX', '2');
        vi.stubEnv('MDWEB_API_RATE_WINDOW_MS', '60000');
        vi.stubEnv('MDWEB_MCP_RATE_MAX', '2');
        vi.stubEnv('MDWEB_MCP_RATE_WINDOW_MS', '60000');

        const loginStatuses: number[] = [];
        for (let i = 0; i < 3; i++) {
            const res = await request(app).post('/api/login').send({ username: 'nobody', password: 'nope' });
            loginStatuses.push(res.status);
        }
        expect(loginStatuses[2]).toBe(429);
        expect(loginStatuses[2] && loginStatuses[0]).not.toBe(429);

        const health = await request(app).get('/api/health');
        expect(health.status).toBe(200);

        let lastApi = 200;
        for (let i = 0; i < 3; i++) {
            lastApi = (await request(app).get('/api/health')).status;
        }
        expect(lastApi).toBe(429);

        let lastMcp = 200;
        for (let i = 0; i < 3; i++) {
            lastMcp = (await request(app).post('/mcp').send({})).status;
        }
        expect(lastMcp).toBe(429);
    });
});

describe('WP #1682 secrets off argv', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-secret-'));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('refuses a JWT secret file that is not mode 0600 and reads one that is', () => {
        const loose = path.join(dir, 'loose.secret');
        const tight = path.join(dir, 'tight.secret');
        fs.writeFileSync(loose, 'abcdefghijklmnopqrstuvwxyz012345\n', { mode: 0o644 });
        fs.chmodSync(loose, 0o644);
        fs.writeFileSync(tight, 'abcdefghijklmnopqrstuvwxyz012345\n', { mode: 0o600 });
        fs.chmodSync(tight, 0o600);

        vi.stubEnv('JWT_SECRET', '');
        vi.stubEnv('SESSION_SECRET', '');
        vi.stubEnv('JWT_SECRET_FILE', loose);
        expect(() => resolveJwtSecret(null, 'production')).toThrow(/0600/);

        vi.stubEnv('JWT_SECRET_FILE', tight);
        expect(resolveJwtSecret(null, 'production')).toBe('abcdefghijklmnopqrstuvwxyz012345');
    });

    it('change-password refuses argv and accepts stdin or a 0600 file', () => {
        const usersFile = path.join(dir, 'users.json');
        fs.writeFileSync(
            usersFile,
            JSON.stringify({
                admin: { username: 'admin', passwordHash: 'original-hash', role: 'admin' },
                users: []
            })
        );
        const env = {
            ...process.env,
            USERS_PATH: usersFile,
            CONFIG_DIR: dir,
            VITEST: '1'
        };
        const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
        const script = path.join(process.cwd(), 'server', 'scripts', 'change-password.ts');

        const argvRun = spawnSync(tsx, [script, 'admin', 'SentinelPasswordValue99'], {
            env,
            encoding: 'utf8'
        });
        const afterArgv = JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.passwordHash;
        expect(argvRun.status).not.toBe(0);
        expect(`${argvRun.stderr}\n${argvRun.stdout}`).toMatch(/stdin|command line|argv/i);
        expect(afterArgv).toBe('original-hash');

        const stdinRun = spawnSync(tsx, [script, 'admin'], {
            env,
            encoding: 'utf8',
            input: 'SentinelPasswordValue99\n'
        });
        expect(stdinRun.status).toBe(0);
        expect(JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.passwordHash).not.toBe('original-hash');

        const loose = path.join(dir, 'pw.txt');
        fs.writeFileSync(loose, 'AnotherSentinelPassword99\n', { mode: 0o644 });
        fs.chmodSync(loose, 0o644);
        const beforeFile = JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.passwordHash;
        const looseRun = spawnSync(tsx, [script, 'admin', '--password-file', loose], {
            env,
            encoding: 'utf8'
        });
        expect(looseRun.status).not.toBe(0);
        expect(JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.passwordHash).toBe(beforeFile);

        const tight = path.join(dir, 'pw.secret');
        fs.writeFileSync(tight, 'FileSentinelPassword99\n', { mode: 0o600 });
        fs.chmodSync(tight, 0o600);
        const tightRun = spawnSync(tsx, [script, 'admin', '--password-file', tight], {
            env,
            encoding: 'utf8'
        });
        expect(tightRun.status).toBe(0);
        expect(JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.passwordHash).not.toBe(beforeFile);
    });

    it('rc scripts pass JWT_SECRET_FILE and do not put the secret on the command line', () => {
        for (const rel of ['mdweb.rc', 'ports/www/mdweb/files/mdweb.in']) {
            const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
            expect(src).toMatch(/JWT_SECRET_FILE=/);
            expect(src).not.toMatch(/export\s+JWT_SECRET\s*(\n|$)/);
            expect(src).not.toMatch(/JWT_SECRET=\$\{JWT_SECRET\}/);
            const args = src.split('command_args')[1] || '';
            expect(args).not.toMatch(/JWT_SECRET=/);
        }
    });
});

describe('WP #1682 no default admin/admin', () => {
    const usersBackup = path.resolve(process.cwd(), 'tests/tmp/users.json.bak-1682');

    beforeEach(() => {
        const p = path.resolve(process.cwd(), 'tests/tmp/users.json');
        if (fs.existsSync(p)) fs.copyFileSync(p, usersBackup);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        const p = path.resolve(process.cwd(), 'tests/tmp/users.json');
        if (fs.existsSync(usersBackup)) {
            fs.copyFileSync(usersBackup, p);
            fs.unlinkSync(usersBackup);
        }
    });

    it('does not ship the default password hash in the port sample or production defaults', () => {
        const sample = JSON.parse(
            fs.readFileSync(path.resolve(process.cwd(), 'ports/www/mdweb/files/users.json.sample'), 'utf8')
        );
        expect(sample.admin.passwordHash).toBe('');
        expect(sample.admin.passwordHash).not.toBe(DEFAULT_ADMIN_PASSWORD_HASH);

        const prevNode = process.env.NODE_ENV;
        const prevVitest = process.env.VITEST;
        try {
            delete process.env.VITEST;
            process.env.NODE_ENV = 'production';
            expect(defaultUsers().admin.passwordHash).toBe('');
        } finally {
            if (prevVitest === undefined) delete process.env.VITEST;
            else process.env.VITEST = prevVitest;
            if (prevNode === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prevNode;
        }
    });

    it('refuses login and startup when the admin password is still admin', async () => {
        saveUsers({
            admin: {
                username: 'admin',
                passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
                role: 'admin'
            },
            users: []
        });
        const res = await request(app)
            .post('/api/login')
            .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toMatch(/default/i);

        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        const issues = await runPreflight(false);
        process.env.NODE_ENV = prev;
        expect(issues.some((i) => i.id === 'DEFAULT_ADMIN_PASSWORD' && i.critical)).toBe(true);
    });

    it('creates the first admin from a one-time setup token or stdin', async () => {
        const usersFile = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-setup-')),
            'users.json'
        );
        const tokenFile = path.join(path.dirname(usersFile), 'setup-token.json');
        const token = issueSetupToken(tokenFile);
        await bootstrapAdmin({
            username: 'admin',
            password: 'correct-horse-battery',
            usersFile,
            setupToken: token,
            setupTokenFile: tokenFile,
            allowStdin: false
        });
        const users = loadUsers(usersFile);
        expect(users.admin.passwordHash).not.toBe(DEFAULT_ADMIN_PASSWORD_HASH);
        expect(users.admin.passwordHash.length).toBeGreaterThan(10);
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: 'correct-horse-battery',
                usersFile: path.join(path.dirname(usersFile), 'second.json'),
                setupToken: token,
                setupTokenFile: tokenFile,
                allowStdin: false
            })
        ).rejects.toThrow(/token/i);

        const stdinFile = path.join(path.dirname(usersFile), 'stdin-users.json');
        await bootstrapAdmin({
            username: 'root',
            password: 'stdin-horse-battery',
            usersFile: stdinFile,
            allowStdin: true
        });
        expect(loadUsers(stdinFile).admin.username).toBe('root');
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: 'admin',
                usersFile: path.join(path.dirname(usersFile), 'bad.json'),
                allowStdin: true
            })
        ).rejects.toThrow(/default/i);
    });
});

describe('WP #1682 CORS allowlist', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does not reflect arbitrary origins or combine * with credentials', async () => {
        const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
        expect(evil.headers['access-control-allow-origin']).not.toBe('*');

        vi.stubEnv('MDWEB_CORS_ORIGINS', 'https://ok.example');
        const ok = await request(app).get('/api/health').set('Origin', 'https://ok.example');
        expect(ok.headers['access-control-allow-origin']).toBe('https://ok.example');
        expect(ok.headers['access-control-allow-credentials']).toBe('true');

        const stillEvil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(stillEvil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
        expect(stillEvil.headers['access-control-allow-origin']).not.toBe('*');

        vi.stubEnv('MDWEB_CORS_ORIGINS', '*');
        const star = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(star.headers['access-control-allow-origin']).not.toBe('*');
        expect(star.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });
});

describe('WP #1682 audit log', () => {
    let dir: string;
    let logFile: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-audit-'));
        logFile = path.join(dir, 'audit.log');
        vi.stubEnv('AUDIT_LOG_PATH', logFile);
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes JSON lines for login, token use, MCP calls, and content changes without secrets', async () => {
        const sentinel = 'SentinelPasswordValue99';
        await request(app).post('/api/login').send({ username: 'admin', password: sentinel });

        const minted = mintToken('admin', 'audit', 'write');
        await request(app).get('/api/me').set('Authorization', `Bearer ${minted.plaintext}`);
        await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${minted.plaintext}`)
            .send({ slug: 'audit-post', title: 'T', content: 'body' });
        await mcpCall(minted.plaintext, {
            jsonrpc: '2.0',
            id: 9,
            method: 'tools/call',
            params: { name: 'list_posts', arguments: {} }
        });

        expect(fs.existsSync(logFile)).toBe(true);
        const text = fs.readFileSync(logFile, 'utf8');
        expect(text).toMatch(/"event":"login"/);
        expect(text).toMatch(/"event":"token"/);
        expect(text).toMatch(/"event":"mcp"/);
        expect(text).toMatch(/"event":"content"/);
        expect(text).not.toContain(sentinel);
        expect(text).not.toContain(minted.plaintext);
        expect(text).not.toMatch(/authorization/i);
        expect(text).not.toMatch(/cookie/i);
        expect(text).not.toMatch(/password/i);
        for (const line of text.split('\n').filter(Boolean)) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });
});
