/**
 * Track #2119 (follow-up): a post whose front matter fails to parse is NOT
 * published.
 *
 * What this file proves:
 *   - getPosts and getPost return a stub whose status is 'draft' for a file
 *     whose front matter cannot be parsed, never 'published';
 *   - the stub carries no parser error and no snippet of the file;
 *   - the public REST reads and the meta page hide such a post: the list does
 *     not name it, GET /api/posts/:slug answers 404 'Post not found', and the
 *     meta page leaks neither its title, its summary nor its body;
 *   - the write path refuses such a post: readFrontMatter does not turn a
 *     parse error into an empty front matter, savePost throws and leaves the
 *     bytes alone, and publish, unpublish and save (MCP and REST) are refused
 *     with a message that quotes no parser error and no line of the body;
 *   - a well-formed published post in the same directory still shows and can
 *     still be saved, and a new slug is still saved as a draft.
 *
 * The malformed post is a real file with broken YAML, not a mock: the parser
 * really throws, so the stub really is the one a visitor would meet.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMdwebMcpServer } from '../server/mcp/create-server.ts';
import { registerRoutes } from '../server/register-routes.ts';
import { createActiveConfigHolder } from '../server/lib/app-context.ts';
import { RoleGuardFactory } from '../server/middleware/auth.ts';
import { defaultConfig, type Config } from '../server/lib/config.ts';
import { getPost, getPosts, postStatus, readFrontMatter, savePost } from '../server/lib/posts.ts';
import {
    publishPostAsCaller,
    savePostAsCaller,
    unpublishPostAsCaller
} from '../server/lib/post-policy.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import type { TokenScopes } from '../server/lib/token-scope.ts';

const SECRET = 'parse-error-2119-secret-at-least-16-chars';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');

let tmp = '';
let postsDir = '';
/** True when this run created dist/ for the meta page (the repo has no build). */
let madeDist = false;

/** The slug of the malformed post. */
const BROKEN = 'broken-draft';
/** A line of the body of the malformed post: it must never reach a reader. */
const SECRET_BODY = 'secret draft body';
/** Front matter that gray-matter cannot parse (unterminated flow sequence). */
const MALFORMED = `---\ntitle: [unterminated\n---\n${SECRET_BODY}\n`;
/** A post that is fine and published: the control of every check below. */
const GOOD = 'title: Public title\nsummary: Public summary\ndate: 2026-01-01\nauthor: writer\nstatus: published\n';

/** An Express app with the real routes, bound to the temp posts dir. */
function buildRestApp() {
    const cfg: Config = { ...defaultConfig(), postsDir };
    const holder = createActiveConfigHolder(cfg);
    const guards = new RoleGuardFactory(SECRET, { getMode: () => 'jwt' });
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
        secret: SECRET,
        getActiveConfig: holder.get,
        setActiveConfig: holder.set,
        authenticate: guards.authenticate(),
        authenticateMcp: guards.authenticate({ mcp: true }),
        requireAdmin: guards.requireAdmin(),
        requireWriter: guards.requireContributorOrAdmin(),
        upload: {} as never
    });
    return app;
}

/** An MCP client bound to one caller and to the temp posts dir. */
async function connectMcp(username: string, role: 'admin' | 'contributor', tokenScopes?: TokenScopes) {
    const cfg: Config = { ...defaultConfig(), postsDir };
    const server = createMdwebMcpServer({
        user: { username, role },
        getActive: () => cfg,
        setActive: () => undefined,
        ...(tokenScopes ? { tokenScopes } : {})
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'parse-error-2119', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}

/** Call a tool and return the raw text. */
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
    let res: any;
    try {
        res = await client.callTool({ name, arguments: args });
    } catch (e) {
        res = { isError: true, content: [{ type: 'text', text: String(e) }] };
    }
    return {
        text: String(res?.content?.[0]?.text ?? ''),
        isError: Boolean(res?.isError)
    };
}

describe('a post whose front matter does not parse is not published (Track 2119)', () => {
    beforeAll(() => {
        // The meta page only exists when the SPA shell is built. There is no
        // build in the repo, so the test makes one and removes it afterwards.
        if (!fs.existsSync(path.join(distDir, 'index.html'))) {
            fs.mkdirSync(distDir, { recursive: true });
            fs.writeFileSync(
                path.join(distDir, 'index.html'),
                '<!doctype html><html><head><title>MDWeb</title></head><body><div id="root"></div></body></html>'
            );
            madeDist = true;
        }
    });

    afterAll(() => {
        if (madeDist) fs.rmSync(distDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-parse-error-2119-'));
        postsDir = path.join(tmp, 'posts');
        fs.mkdirSync(postsDir);
        vi.stubEnv('CONFIG_PATH', path.join(tmp, 'config.json'));
        vi.stubEnv('USERS_PATH', path.join(tmp, 'users.json'));
        vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
        vi.stubEnv('AUDIT_LOG_PATH', path.join(tmp, 'audit.log'));
        fs.writeFileSync(
            path.join(tmp, 'users.json'),
            JSON.stringify({
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: [{ username: 'writer', passwordHash: 'h', role: 'contributor' }]
            })
        );
        // The malformed post and a well-formed published one, side by side.
        fs.writeFileSync(path.join(postsDir, `${BROKEN}.md`), MALFORMED);
        fs.writeFileSync(path.join(postsDir, 'good.md'), `---\n${GOOD}---\nbody of the public post\n`);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe('the stub the parsers return', () => {
        it('is a draft, never a published post', () => {
            const posts = getPosts(postsDir);
            const stub = posts.find((p) => p.slug === BROKEN);
            expect(stub).toBeTruthy();
            expect(stub!.status).toBe('draft');
            expect(stub!.status).not.toBe('published');

            const one = getPost(postsDir, BROKEN);
            expect(one).toBeTruthy();
            expect(one!.status).toBe('draft');
            expect(one!.status).not.toBe('published');
        });

        it('carries no parser error and no snippet of the file', () => {
            const stub = getPost(postsDir, BROKEN)!;
            const text = `${stub.title}\n${stub.summary}\n${stub.content}`;
            expect(text).not.toContain(SECRET_BODY);
            expect(text).not.toMatch(/unexpected end of the stream/i);
            expect(text).not.toMatch(/flow collection/i);
            expect(text).not.toMatch(/at line \d+, column \d+/i);
        });

        it('leaves a well-formed post published', () => {
            expect(getPost(postsDir, 'good')?.status).toBe('published');
            expect(getPosts(postsDir).find((p) => p.slug === 'good')?.status).toBe('published');
        });

        it('stays unpublished when the same file is read again', () => {
            // gray-matter caches a file before it parses it: a broken front
            // matter throws once and then hands out the half-parsed file, with
            // the whole file as the body. A second read must not publish it.
            for (let i = 0; i < 3; i++) {
                const stub = getPost(postsDir, BROKEN)!;
                expect(stub.status).toBe('draft');
                expect(stub.content).not.toContain(SECRET_BODY);
                const listed = getPosts(postsDir).find((p) => p.slug === BROKEN)!;
                expect(listed.status).toBe('draft');
                expect(listed.summary).not.toContain(SECRET_BODY);
            }
        });
    });

    describe('the public REST reads', () => {
        it('do not list the malformed post', async () => {
            const res = await request(buildRestApp()).get('/api/posts');
            expect(res.status).toBe(200);
            const slugs = res.body.posts.map((p: any) => p.slug);
            expect(slugs).not.toContain(BROKEN);
            expect(JSON.stringify(res.body)).not.toContain('Error:');
            expect(JSON.stringify(res.body)).not.toContain(SECRET_BODY);
        });

        it('answer 404 for the malformed post', async () => {
            const app = buildRestApp();
            // Twice: the second read is the one that used to serve the file.
            for (let i = 0; i < 2; i++) {
                const res = await request(app).get(`/api/posts/${BROKEN}`);
                expect(res.status).toBe(404);
                expect(res.body).toEqual({ message: 'Post not found' });
                expect(JSON.stringify(res.body)).not.toContain(SECRET_BODY);
                expect(JSON.stringify(res.body)).not.toMatch(/unexpected end of the stream/i);
            }
        });

        it('still show a well-formed published post', async () => {
            const app = buildRestApp();
            const list = await request(app).get('/api/posts');
            expect(list.body.posts.map((p: any) => p.slug)).toContain('good');

            const one = await request(app).get('/api/posts/good');
            expect(one.status).toBe(200);
            expect(one.body.title).toBe('Public title');
        });
    });

    describe('the meta page', () => {
        it('does not leak the malformed post', async () => {
            const res = await request(buildRestApp()).get(`/post/${BROKEN}`);
            expect(res.status).toBe(200);
            expect(res.text).not.toContain(SECRET_BODY);
            expect(res.text).not.toContain(`Error: ${BROKEN}`);
            expect(res.text).not.toMatch(/unexpected end of the stream/i);
        });

        it('still shows a well-formed published post', async () => {
            const res = await request(buildRestApp()).get('/post/good');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Public title');
        });
    });

    describe('MCP', () => {
        it('does not hand the malformed post to a reader', async () => {
            const reader = await connectMcp('writer', 'contributor', ['read']);
            const one = await callTool(reader, 'get_post', { slug: BROKEN });
            expect(one.isError).toBe(true);
            expect(one.text).toMatch(/not found/i);

            const listed = await callTool(reader, 'list_posts', {});
            expect(listed.text).not.toContain(BROKEN);
        });
    });

    describe('the write path', () => {
        /** The bytes of the malformed post, as they are on disk right now. */
        const brokenBytes = () => fs.readFileSync(path.join(postsDir, `${BROKEN}.md`), 'utf8');

        /** The scopes a writer needs to save and to publish. */
        const WRITE_SCOPES: TokenScopes = ['read', 'content:write', 'publish'];

        it('does not read a parse error as an empty front matter', () => {
            // {} is what a missing file looks like, and postStatus({}) is
            // 'published': a parse error must never look like that.
            expect(postStatus({})).toBe('published');
            expect(() => readFrontMatter(postsDir, BROKEN)).toThrow();
        });

        it('refuses to save a post whose front matter does not parse', () => {
            const before = brokenBytes();
            expect(() =>
                savePost(postsDir, { slug: BROKEN, title: 'Hijacked', content: 'new body' })
            ).toThrow();

            const after = brokenBytes();
            expect(after).toBe(before);
            expect(after).toContain(SECRET_BODY);
            expect(after).not.toContain('status: published');
        });

        it('refuses to save a broken post even when the input asks for published', () => {
            const before = brokenBytes();
            expect(() =>
                savePost(postsDir, {
                    slug: BROKEN,
                    title: 'Hijacked',
                    content: 'new body',
                    status: 'published'
                })
            ).toThrow();

            const after = brokenBytes();
            expect(after).toBe(before);
            expect(after).not.toMatch(/status:\s*published/);
            expect(getPost(postsDir, BROKEN)?.status).not.toBe('published');
        });

        it('refuses to publish a post whose front matter does not parse', () => {
            const before = brokenBytes();
            const result = publishPostAsCaller(postsDir, BROKEN, { username: 'admin', role: 'admin' });
            expect(result.ok).toBe(false);
            expect(result.ok ? '' : result.error).toMatch(/front matter/i);
            expect(result.ok ? '' : result.error).not.toContain(SECRET_BODY);
            expect(brokenBytes()).toBe(before);
        });

        it('refuses to unpublish a post whose front matter does not parse', () => {
            const before = brokenBytes();
            const result = unpublishPostAsCaller(postsDir, BROKEN, { username: 'admin', role: 'admin' });
            expect(result.ok).toBe(false);
            expect(brokenBytes()).toBe(before);
        });

        it('refuses to save a broken post over MCP', async () => {
            const before = brokenBytes();
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            const res = await callTool(c, 'update_post', {
                slug: BROKEN,
                title: 'Hijacked',
                content: 'new body'
            });
            expect(res.isError).toBe(true);
            expect(res.text).toMatch(/front matter/i);
            // The refusal quotes no parser error, no snippet of the file and no
            // line of the draft body.
            expect(res.text).not.toContain(SECRET_BODY);
            expect(res.text).not.toMatch(/unexpected end of the stream/i);
            expect(brokenBytes()).toBe(before);
        });

        it('refuses to publish a broken post over MCP', async () => {
            const before = brokenBytes();
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            const res = await callTool(c, 'publish_post', { slug: BROKEN });
            expect(res.isError).toBe(true);
            expect(res.text).toMatch(/front matter/i);
            expect(res.text).not.toContain(SECRET_BODY);
            expect(res.text).not.toMatch(/unexpected end of the stream/i);
            expect(brokenBytes()).toBe(before);

            // The public read of the broken post is still a 404 and still says
            // nothing of the file.
            const one = await request(buildRestApp()).get(`/api/posts/${BROKEN}`);
            expect(one.status).toBe(404);
            expect(JSON.stringify(one.body)).not.toContain(SECRET_BODY);
        });

        it('refuses a REST save of a broken post', async () => {
            const before = brokenBytes();
            const pat = mintToken('admin', 'admin-pat', [
                'read',
                'content:write',
                'publish',
                'moderate'
            ]).plaintext;
            const res = await request(buildRestApp())
                .post('/api/posts')
                .set('Authorization', `Bearer ${pat}`)
                .send({ slug: BROKEN, title: 'Hijacked', content: 'new body' });
            expect(res.status).toBe(400);
            expect(String(res.body?.message ?? '')).toMatch(/front matter/i);
            expect(String(res.body?.message ?? '')).not.toContain(SECRET_BODY);
            expect(brokenBytes()).toBe(before);
        });

        it('still saves a well-formed published post and a new draft', () => {
            savePost(postsDir, { slug: 'good', title: 'Public title v2', content: 'body v2' });
            const good = getPost(postsDir, 'good');
            expect(good?.status).toBe('published');
            expect(good?.title).toBe('Public title v2');

            const created = savePostAsCaller(
                postsDir,
                { slug: 'brand-new', title: 'T', content: 'C' },
                { username: 'writer', role: 'contributor' }
            );
            expect(created.ok).toBe(true);
            expect(getPost(postsDir, 'brand-new')?.status).toBe('draft');
        });
    });
});
