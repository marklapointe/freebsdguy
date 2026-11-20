/**
 * Track #2119 U8: per-token limits, CORS credentials off, extended audit rows.
 *
 * What this file proves:
 *   - a token gets its own read/write/publish buckets, so one agent behind the
 *     gateway cannot spend another agent's budget (H1);
 *   - a request refused for its auth or its scope spends nothing;
 *   - no response ever carries Access-Control-Allow-Credentials (J6);
 *   - the audit rows name the token, how it authenticated, the tool, a hash of
 *     the arguments, and the bytes a post write produced — never the token or
 *     the post body (G1/G2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { appRateLimiter, resetRateLimits } from '../server/lib/rate-limit.ts';

/** Where the test config (tests/tmp/config.json) puts the posts. */
const postsDir = path.resolve(process.cwd(), 'tests/tmp/posts');

let tmp = '';
let auditFile = '';
let tokensFile = '';
const createdSlugs = new Set<string>();

function mcpCall(pat: string, body: unknown) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
}

function toolCall(name: string, args: Record<string, unknown>, id = 1) {
    return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function auditRows(): Record<string, any>[] {
    if (!fs.existsSync(auditFile)) return [];
    return fs
        .readFileSync(auditFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>);
}

/** A REST save; every write here is a POST /api/posts (a "write"). */
function savePost(pat: string, slug: string, content = 'body') {
    createdSlugs.add(slug);
    return request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${pat}`)
        .send({ slug, title: 'T', content });
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-u8-'));
    auditFile = path.join(tmp, 'audit.log');
    tokensFile = path.join(tmp, 'tokens.json');
    vi.stubEnv('AUDIT_LOG_PATH', auditFile);
    vi.stubEnv('TOKENS_PATH', tokensFile);
    fs.mkdirSync(postsDir, { recursive: true });
    resetRateLimits();
});

afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
    for (const slug of createdSlugs) {
        const file = path.join(postsDir, `${slug}.md`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    createdSlugs.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('per-token rate limits (H1)', () => {
    beforeEach(() => {
        // The per-IP limits stay, but they are not what this suite proves.
        vi.stubEnv('MDWEB_ENFORCE_RATE_LIMIT', '1');
        vi.stubEnv('MDWEB_API_RATE_MAX', '1000');
        vi.stubEnv('MDWEB_MCP_RATE_MAX', '1000');
        vi.stubEnv('MDWEB_LOGIN_RATE_MAX', '1000');
        vi.stubEnv('MDWEB_TOKEN_READ_PER_MIN', '1000');
    });

    it('refuses the 11th write by one token, leaves another token and reads alone', async () => {
        vi.stubEnv('MDWEB_TOKEN_WRITE_PER_MIN', '10');
        const { plaintext, record } = mintToken('admin', 'u8-write', ['read', 'content:write']);

        for (let i = 0; i < 10; i++) {
            const res = await savePost(plaintext, 'u8-write-post', `body ${i}`);
            expect(res.status).toBe(200);
        }

        const eleventh = await savePost(plaintext, 'u8-write-post', 'one too many');
        expect(eleventh.status).toBe(429);
        expect(eleventh.headers['retry-after']).toBeTruthy();
        expect(eleventh.body).toEqual({ message: 'Too many requests' });

        // Another token has its own bucket.
        const other = mintToken('admin', 'u8-write-other', ['read', 'content:write']);
        expect((await savePost(other.plaintext, 'u8-write-other-post')).status).toBe(200);

        // A read is a different class and still passes.
        const read = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(read.status).toBe(200);

        const limited = auditRows().filter((row) => row.action === 'rate_limited');
        expect(limited.length).toBeGreaterThan(0);
        expect(limited[0].tokenId).toBe(record.id);
        expect(limited[0].class).toBe('write');
        expect(JSON.stringify(limited)).not.toContain(plaintext);
    });

    it('refuses the 4th publish in an hour', async () => {
        vi.stubEnv('MDWEB_TOKEN_WRITE_PER_MIN', '100');
        vi.stubEnv('MDWEB_TOKEN_PUBLISH_PER_HOUR', '3');
        const { plaintext } = mintToken('admin', 'u8-publish', [
            'read',
            'content:write',
            'publish'
        ]);
        expect((await savePost(plaintext, 'u8-publish-post')).status).toBe(200);

        for (let i = 0; i < 3; i++) {
            const res = await mcpCall(
                plaintext,
                toolCall('publish_post', { slug: 'u8-publish-post' }, i + 1)
            );
            expect(res.status).toBe(200);
        }

        const fourth = await mcpCall(
            plaintext,
            toolCall('publish_post', { slug: 'u8-publish-post' }, 4)
        );
        expect(fourth.status).toBe(429);
        expect(fourth.headers['retry-after']).toBeTruthy();
    });

    it('does not spend a write bucket on a scope-denied write', async () => {
        vi.stubEnv('MDWEB_TOKEN_WRITE_PER_MIN', '1');
        const { plaintext } = mintToken('admin', 'u8-denied', ['read', 'content:write']);

        // Needs the admin scope, which this token does not hold.
        const denied = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${plaintext}`)
            .send({ siteName: 'Nope' });
        expect(denied.status).toBe(403);

        // The one write this token may make is still available: the denial
        // above spent nothing.
        expect((await savePost(plaintext, 'u8-denied-post')).status).toBe(200);
    });

    it('does not spend a write bucket on a refused publish', async () => {
        vi.stubEnv('MDWEB_TOKEN_WRITE_PER_MIN', '10');
        vi.stubEnv('MDWEB_TOKEN_PUBLISH_PER_HOUR', '1');
        const { plaintext, record } = mintToken('admin', 'u8-publish-double', [
            'read',
            'content:write',
            'publish'
        ]);
        const slug = 'u8-publish-double-post';

        // Create a draft (one write).
        expect((await savePost(plaintext, slug)).status).toBe(200);

        // First publish: consumes the only publish slot and one more write.
        expect(
            (
                await mcpCall(
                    plaintext,
                    toolCall('publish_post', { slug }, 1)
                )
            ).status
        ).toBe(200);

        const writeRemainingBefore = appRateLimiter.remaining(
            `tok:${record.id}:write`,
            10,
            60_000
        );
        expect(writeRemainingBefore).toBe(8);

        // Second publish is refused by the publish bucket alone.
        const refused = await mcpCall(
            plaintext,
            toolCall('publish_post', { slug }, 2)
        );
        expect(refused.status).toBe(429);

        // The write bucket is untouched by the refused publish.
        const writeRemainingAfter = appRateLimiter.remaining(
            `tok:${record.id}:write`,
            10,
            60_000
        );
        expect(writeRemainingAfter).toBe(8);
    });
});

describe('CORS never allows credentials (J6)', () => {
    const credentials = (res: request.Response) =>
        res.headers['access-control-allow-credentials'];

    it('omits Access-Control-Allow-Credentials for allowed, evil, and preflight requests', async () => {
        const evil = await request(app)
            .get('/api/health')
            .set('Origin', 'https://evil.example');
        expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
        expect(credentials(evil)).toBeUndefined();

        vi.stubEnv('MDWEB_CORS_ORIGINS', 'https://ok.example');

        const ok = await request(app)
            .get('/api/health')
            .set('Origin', 'https://ok.example');
        expect(ok.headers['access-control-allow-origin']).toBe('https://ok.example');
        expect(credentials(ok)).toBeUndefined();

        for (const route of ['/mcp', '/api/posts']) {
            const preflight = await request(app)
                .options(route)
                .set('Origin', 'https://ok.example')
                .set('Access-Control-Request-Method', 'POST');
            expect(preflight.headers['access-control-allow-origin']).toBe('https://ok.example');
            expect(credentials(preflight)).toBeUndefined();

            const evilPreflight = await request(app)
                .options(route)
                .set('Origin', 'https://evil.example')
                .set('Access-Control-Request-Method', 'POST');
            expect(credentials(evilPreflight)).toBeUndefined();
        }
    });
});

describe('audit rows (G1/G2)', () => {
    it('records an MCP create with tokenId, via, tool, arg hash and post hashes', async () => {
        const { plaintext, record } = mintToken('admin', 'u8-audit', ['read', 'content:write']);
        const bodyText = 'SentinelBodyValue99';

        const res = await mcpCall(
            plaintext,
            toolCall('create_post', {
                slug: 'u8-audit-create',
                title: 'T',
                content: bodyText
            })
        );
        expect(res.status).toBe(200);
        createdSlugs.add('u8-audit-create');

        const rows = auditRows();
        const mcp = rows.find((row) => row.event === 'mcp' && row.tool === 'create_post');
        expect(mcp).toBeTruthy();
        expect(mcp.tokenId).toBe(record.id);
        expect(mcp.via).toBe('pat');
        expect(mcp.outcome).toBe('accepted');
        expect(mcp.argsSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(Array.isArray(mcp.scopes)).toBe(true);

        const post = rows.find(
            (row) => row.event === 'post' && row.action === 'create' && row.slug === 'u8-audit-create'
        );
        expect(post).toBeTruthy();
        expect(post.afterSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(post.beforeSha256).toBeNull();

        const raw = fs.readFileSync(auditFile, 'utf8');
        expect(raw).not.toContain(plaintext);
        expect(raw).not.toContain(bodyText);
    });

    it('records both hashes on an update', async () => {
        const { plaintext } = mintToken('admin', 'u8-audit-up', ['read', 'content:write']);
        const slug = 'u8-audit-update';
        createdSlugs.add(slug);

        expect(
            (
                await mcpCall(
                    plaintext,
                    toolCall('create_post', { slug, title: 'T', content: 'first body' }, 1)
                )
            ).status
        ).toBe(200);
        expect(
            (
                await mcpCall(
                    plaintext,
                    toolCall('update_post', { slug, title: 'T', content: 'second body' }, 2)
                )
            ).status
        ).toBe(200);

        const rows = auditRows().filter((row) => row.event === 'post' && row.slug === slug);
        const created = rows.find((row) => row.action === 'create');
        const updated = rows.find((row) => row.action === 'update');
        expect(created?.beforeSha256).toBeNull();
        expect(updated?.beforeSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(updated?.afterSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(updated?.beforeSha256).not.toBe(updated?.afterSha256);
    });

    it('marks a scope denial denied, with the token and a reason', async () => {
        const { plaintext, record } = mintToken('admin', 'u8-audit-denied', ['read']);
        const res = await mcpCall(
            plaintext,
            toolCall('create_post', { slug: 'u8-audit-denied-post', title: 'T', content: 'C' })
        );
        // A tool call is an HTTP 200 with an error result.
        expect(res.status).toBe(200);

        const row = auditRows().find(
            (r) => r.event === 'mcp' && r.tool === 'create_post' && r.outcome === 'denied'
        );
        expect(row).toBeTruthy();
        expect(row.tokenId).toBe(record.id);
        expect(row.reason).toMatch(/scope/);
    });

    it('marks a bad token denied', async () => {
        const bad = 'mdw_' + 'a'.repeat(64);
        const res = await request(app).get('/api/me').set('Authorization', `Bearer ${bad}`);
        expect(res.status).toBe(401);

        const row = auditRows().find((r) => r.event === 'token' && r.action === 'denied');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('invalid');
    });
});
