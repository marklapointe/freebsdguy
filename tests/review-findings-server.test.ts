/**
 * Regression tests for CODE_REVIEW_FINDINGS.md (server side).
 * Each `describe` maps to a numbered finding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { app } from '../server/index.ts';
import { loadConfig, saveConfig, loadUsers, saveUsers } from '../server/lib/config.ts';
import { AIServiceFactory } from '../server/lib/ai-service.ts';
import { parseCookies } from '../server/lib/session-store.ts';
import { getPosts } from '../server/lib/posts.ts';
import { withManifestLock, loadManifest, saveManifest } from '../server/lib/images.ts';
import { PublicConfigBuilder } from '../server/lib/public-config.ts';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
const adminToken = () => jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
const contributorToken = () => jwt.sign({ username: 'writer', role: 'contributor' }, SECRET);

async function enableAI(overrides: Record<string, unknown> = {}) {
    // Go through the admin API so the in-memory active config is updated (as in production)
    const body = {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: 'stored-admin-key',
        modelId: 'llama3',
        ...overrides
    };
    const t = adminToken();
    await request(app).post('/api/admin/ai-config').set('Authorization', `Bearer ${t}`).send(body);
    await request(app).post('/api/admin/config').set('Authorization', `Bearer ${t}`).send({ security: { disableAI: false } });
}

describe('#1 AI routes: caller cannot redirect stored API key / SSRF', () => {
    let createSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        const users = loadUsers();
        users.users = [{ username: 'writer', passwordHash: 'x', role: 'contributor' } as any];
        saveUsers(users);
        await enableAI();
        createSpy = vi.spyOn(AIServiceFactory, 'create').mockImplementation(
            () =>
                ({
                    summarize: async () => 'sum',
                    enhance: async () => 'enh',
                    getModels: async () => ['m1']
                }) as any
        );
    });

    afterEach(() => {
        createSpy.mockRestore();
    });

    it('contributor overrides of provider/baseUrl are ignored on /api/ai/summarize', async () => {
        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${contributorToken()}`)
            .send({ content: 'x', provider: 'openai', baseUrl: 'https://attacker.example', modelId: 'evil' });
        expect(res.status).toBe(200);
        expect(createSpy).toHaveBeenCalledTimes(1);
        const [provider, cfg] = createSpy.mock.calls[0] as any[];
        expect(provider).toBe('ollama');
        expect(cfg.baseUrl).toBe('http://127.0.0.1:11434');
        expect(cfg.modelId).toBe('llama3');
    });

    it('contributor overrides are ignored on /api/ai/enhance', async () => {
        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${contributorToken()}`)
            .send({ content: 'x', provider: 'openai', baseUrl: 'https://attacker.example' });
        expect(res.status).toBe(200);
        const [, cfg] = createSpy.mock.calls[0] as any[];
        expect(cfg.baseUrl).toBe('http://127.0.0.1:11434');
    });

    it('contributor overrides are ignored on GET /api/ai/models', async () => {
        const res = await request(app)
            .get('/api/ai/models?provider=ollama&baseUrl=http://10.0.0.5:8080')
            .set('Authorization', `Bearer ${contributorToken()}`);
        expect(res.status).toBe(200);
        const [, cfg] = createSpy.mock.calls[0] as any[];
        expect(cfg.baseUrl).toBe('http://127.0.0.1:11434');
    });

    it('admin override of baseUrl is honored but never sends the stored key to a different host', async () => {
        const res = await request(app)
            .get('/api/ai/models?provider=openai&baseUrl=https://other.example/v1')
            .set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        const [provider, cfg] = createSpy.mock.calls[0] as any[];
        expect(provider).toBe('openai');
        expect(cfg.baseUrl).toBe('https://other.example/v1');
        expect(cfg.apiKey).toBeUndefined();
    });

    it('admin override with the stored host keeps the stored key', async () => {
        const res = await request(app)
            .get('/api/ai/models?provider=ollama&baseUrl=http://127.0.0.1:11434')
            .set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        const [, cfg] = createSpy.mock.calls[0] as any[];
        expect(cfg.apiKey).toBe('stored-admin-key');
    });

    it('rejects non-http(s) baseUrl overrides from admin', async () => {
        const res = await request(app)
            .get('/api/ai/models?provider=ollama&baseUrl=file:///etc/passwd')
            .set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(400);
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('GET /api/ai/models honors security.disableAI', async () => {
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { disableAI: true } });
        const res = await request(app)
            .get('/api/ai/models')
            .set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(403);
        expect(createSpy).not.toHaveBeenCalled();
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { disableAI: false } });
    });
});

describe('#2 parseCookies tolerates malformed percent-escapes', () => {
    it('does not throw on a bare % and keeps other cookies', () => {
        expect(() => parseCookies('pct=100%; mdweb.sid=abc')).not.toThrow();
        const out = parseCookies('pct=100%; mdweb.sid=abc');
        expect(out['mdweb.sid']).toBe('abc');
        expect(out.pct).toBe('100%');
    });

    it('decodes well-formed escapes', () => {
        expect(parseCookies('x=%E2%9C%93').x).toBe('✓');
        expect(parseCookies('x=%E0').x).toBe('%E0');
    });

    it('session-mode auth returns 401/403, not 500, with a malformed cookie', async () => {
        const users = loadUsers();
        users.admin.passwordHash = await bcrypt.hash('cookie-test-pw', 10);
        saveUsers(users);
        // Switch to session mode (JWT still valid for this call)
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { authMode: 'session' } });
        try {
            const res = await request(app).get('/api/me').set('Cookie', 'pct=100%; other=%E0');
            expect([401, 403]).toContain(res.status);
            const out = await request(app).post('/api/logout').set('Cookie', 'pct=100%');
            expect(out.status).toBe(200);
        } finally {
            const login = await request(app)
                .post('/api/login')
                .send({ username: users.admin.username, password: 'cookie-test-pw' });
            const cookie = (login.headers['set-cookie'] || [])[0]?.split(';')[0] || '';
            const revert = await request(app)
                .post('/api/admin/config')
                .set('Cookie', cookie)
                .send({ security: { authMode: 'jwt' } });
            expect(revert.status).toBe(200);
        }
    });
});

describe('#5/#3 posts slug handling and validation', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-posts-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('slug strips only the trailing .md extension', () => {
        fs.writeFileSync(path.join(dir, 'my.mdx-notes.md'), '---\ntitle: T\n---\nbody');
        const posts = getPosts(dir);
        expect(posts.map(p => p.slug)).toContain('my.mdx-notes');
    });

    it('POST /api/posts rejects empty / whitespace / missing slug', async () => {
        for (const slug of ['', '   ', undefined]) {
            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${adminToken()}`)
                .send({ slug, title: 'x', content: 'y' });
            expect(res.status).toBe(400);
        }
        const cfg = loadConfig();
        const postsDir = path.resolve(path.dirname(process.env.CONFIG_DIR || ''), cfg.postsDir || './posts');
        expect(fs.existsSync(path.join(postsDir, 'undefined.md'))).toBe(false);
        expect(fs.existsSync(path.join(postsDir, '.md'))).toBe(false);
    });
});

describe('port defaults agree (5173)', () => {
    it('public config without service defaults to 5173', () => {
        const pub = PublicConfigBuilder.from({ siteName: 'x' } as any).withoutService().build();
        expect(pub.service).toEqual({ port: 5173 });
    });

    it('POST /api/admin/config with an empty port keeps 5173', async () => {
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ service: { port: '' } });
        expect(res.status).toBe(200);
        expect(loadConfig().service?.port).toBe(5173);
    });
});

describe('#8 image manifest mutations are serialized', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-img-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('concurrent withManifestLock calls do not lose writes', async () => {
        const entry = (n: string) => ({ filename: n, originalName: n, md5: n, size: 1, uploadedAt: 1 });
        const slowWriter = withManifestLock(dir, async () => {
            const m = loadManifest(dir);
            await new Promise(r => setTimeout(r, 30));
            m['a.webp'] = entry('a.webp');
            saveManifest(dir, m);
        });
        const fastWriter = withManifestLock(dir, async () => {
            const m = loadManifest(dir);
            m['b.webp'] = entry('b.webp');
            saveManifest(dir, m);
        });
        await Promise.all([slowWriter, fastWriter]);
        const m = loadManifest(dir);
        expect(Object.keys(m).sort()).toEqual(['a.webp', 'b.webp']);
    });

    it('lock is released after a failing task', async () => {
        await expect(withManifestLock(dir, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        const v = await withManifestLock(dir, async () => 42);
        expect(v).toBe(42);
    });
});

describe('#3 preflight accepts SESSION_SECRET like the server does', () => {
    it('does not flag JWT_SECRET_DEFAULT when only SESSION_SECRET is set in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('JWT_SECRET', '');
        vi.stubEnv('SESSION_SECRET', 'a-perfectly-fine-session-secret-32chars');
        try {
            const { runPreflight } = await import('../server/lib/preflight.ts');
            const issues = await runPreflight(false);
            expect(issues.find(i => i.id === 'JWT_SECRET_DEFAULT')).toBeUndefined();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
