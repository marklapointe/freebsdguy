/**
 * P0 A1: /mcp answers 401 (with WWW-Authenticate) to a missing, non-PAT or
 * invalid bearer, and writes an audit row for each, never the bearer itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import express from 'express';
import { app } from '../server/index.ts';
import { RoleGuardFactory } from '../server/middleware/auth.ts';
import { FileSessionStore } from '../server/lib/session-store.ts';
import { registerMcpRoutes } from '../server/mcp/register-mcp.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';

let tmp = '';
let audit = '';

const rows = (): Record<string, any>[] =>
    fs.existsSync(audit)
        ? fs.readFileSync(audit, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];

const BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function post(auth?: string) {
    const r = request(app)
        .post('/mcp')
        .set('MCP-Protocol-Version', '2025-06-18')
        .set('Accept', 'application/json, text/event-stream');
    if (auth) r.set('Authorization', auth);
    return r.send(BODY);
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-a1-'));
    audit = path.join(tmp, 'audit.log');
    vi.stubEnv('AUDIT_LOG_PATH', audit);
    vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
    resetRateLimits();
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
    resetRateLimits();
});

describe('/mcp unauthenticated', () => {
    const cases: [string, string | undefined, 'missing' | 'invalid'][] = [
        ['no token', undefined, 'missing'],
        ['Bearer not-a-token', 'Bearer not-a-token', 'invalid'],
        ['Bearer mdw_garbage', 'Bearer mdw_garbage', 'invalid'],
        ['Bearer with a JWT-shaped value', 'Bearer aaa.bbb.ccc', 'invalid']
    ];
    for (const [name, header, reason] of cases) {
        it(`${name} -> 401 and an audit row (${reason})`, async () => {
            const res = await post(header);
            expect(res.status).toBe(401);
            expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
            expect(JSON.stringify(res.body)).not.toMatch(/create_post|list_posts|tools/);
            const denied = rows().filter((r) => r.event === 'token' && r.action === 'denied');
            expect(denied.length).toBe(1);
            expect(denied[0].outcome).toBe('denied');
            expect(denied[0].reason).toBe(reason);
            expect(denied[0].ip).toBeTruthy();
            if (header) {
                const secret = header.split(' ')[1];
                expect(fs.readFileSync(audit, 'utf8')).not.toContain(secret);
            }
        });
    }

    it('REST routes answer 401 + WWW-Authenticate for a bad JWT, like /mcp', async () => {
        const res = await request(app).get('/api/me').set('Authorization', 'Bearer not-a-token');
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
        expect(res.body.message).toBe('Invalid or expired token');
        expect(fs.readFileSync(audit, 'utf8')).not.toContain('not-a-token');
    });
});

describe('/mcp in session mode', () => {
    function sessionApp() {
        const store = new FileSessionStore(path.join(tmp, 'sessions'));
        store.ensureDir();
        const guards = new RoleGuardFactory('p0-a1-session-secret-16chars', {
            getMode: () => 'session',
            getSessionStore: () => store,
            getSessionCookieName: () => 'mdweb.sid'
        });
        const mini = express();
        mini.use(express.json());
        registerMcpRoutes(mini, {
            secret: 'x',
            getActiveConfig: () => ({}) as never,
            setActiveConfig: () => undefined,
            authenticate: guards.authenticate(),
            authenticateMcp: guards.authenticate({ mcp: true }),
            requireAdmin: guards.requireAdmin(),
            requireWriter: guards.requireContributorOrAdmin(),
            upload: {} as never
        });
        return mini;
    }
    const cases: [string, { auth?: string; cookie?: string }, 'missing' | 'invalid'][] = [
        ['no cookie, no header', {}, 'missing'],
        ['Bearer not-a-token without a cookie', { auth: 'Bearer not-a-token' }, 'invalid'],
        ['bad session cookie', { cookie: 'mdweb.sid=nope-not-a-session' }, 'invalid']
    ];
    for (const [name, h, reason] of cases) {
        it(`${name} -> 401 and an audit row (${reason})`, async () => {
            const r = request(sessionApp()).post('/mcp').set('Accept', 'application/json, text/event-stream');
            if (h.auth) r.set('Authorization', h.auth);
            if (h.cookie) r.set('Cookie', h.cookie);
            const res = await r.send(BODY);
            expect(res.status).toBe(401);
            expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
            const denied = rows().filter((x) => x.event === 'token' && x.action === 'denied');
            expect(denied.length).toBe(1);
            expect(denied[0].reason).toBe(reason);
            if (h.auth) expect(fs.readFileSync(audit, 'utf8')).not.toContain('not-a-token');
        });
    }
});
