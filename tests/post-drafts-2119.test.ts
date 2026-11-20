/**
 * Track #2119 U4a: a post is a draft until it is published.
 *
 * What this file proves:
 *   - a new post is a draft stamped with the caller's username, and an author
 *     in the input is ignored;
 *   - saving an existing post keeps its author, its status and the other
 *     front-matter keys (aliases) that the input does not name;
 *   - only the author of a post may save it, or an admin that holds the
 *     `moderate` scope; everybody else is told "Not your post";
 *   - publish_post publishes a post and stamps publishedAt once, unpublish_post
 *     unpublishes it and needs the admin role and the `moderate` scope;
 *   - a draft is private: the public REST reads and the meta page never show
 *     it, and over MCP only its author and the admins see it;
 *   - a post without a status key is published (every post that predates the
 *     drafts feature);
 *   - every save, publish and unpublish writes an audit row.
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
import { mintToken } from '../server/lib/api-tokens.ts';
import { getPost } from '../server/lib/posts.ts';
import type { TokenScopes } from '../server/lib/token-scope.ts';

const SECRET = 'post-drafts-2119-secret-at-least-16-chars';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');

let tmp = '';
let postsDir = '';
let usersFile = '';
let tokensFile = '';
let auditFile = '';
/** True when this run created dist/ for the meta page (the repo has no build). */
let madeDist = false;

type Role = 'admin' | 'contributor';

const WRITE_SCOPES: TokenScopes = ['read', 'content:write', 'publish'];
const MODERATE_SCOPES: TokenScopes = ['read', 'content:write', 'publish', 'moderate'];

/** An MCP client bound to one caller and to the temp posts dir. */
async function connectMcp(
    username: string,
    role: Role,
    tokenScopes?: TokenScopes
): Promise<Client> {
    const cfg: Config = { ...defaultConfig(), postsDir };
    const server = createMdwebMcpServer({
        user: { username, role },
        getActive: () => cfg,
        setActive: () => undefined,
        ...(tokenScopes ? { tokenScopes } : {})
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'drafts-2119', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}

/** Call a tool and return the raw text plus the parsed payload (when it is JSON). */
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
    let res: any;
    try {
        res = await client.callTool({ name, arguments: args });
    } catch (e) {
        res = { isError: true, content: [{ type: 'text', text: String(e) }] };
    }
    const text = String(res?.content?.[0]?.text ?? '');
    let payload: any = null;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }
    return { res, text, payload, isError: Boolean(res?.isError) };
}

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

/** The audit rows of the post events. */
function postAuditRows(): Record<string, any>[] {
    if (!fs.existsSync(auditFile)) return [];
    return fs
        .readFileSync(auditFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
        .filter((row) => row.event === 'post');
}

/** A post file with the front matter the test needs. */
function writePost(slug: string, frontMatter: string, body = 'body\n') {
    fs.writeFileSync(path.join(postsDir, `${slug}.md`), `---\n${frontMatter}\n---\n${body}`);
}

describe('post drafts, publish and unpublish (Track 2119 U4a)', () => {
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
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-drafts-2119-'));
        postsDir = path.join(tmp, 'posts');
        usersFile = path.join(tmp, 'users.json');
        tokensFile = path.join(tmp, 'tokens.json');
        auditFile = path.join(tmp, 'audit.log');
        fs.mkdirSync(postsDir);
        vi.stubEnv('CONFIG_PATH', path.join(tmp, 'config.json'));
        vi.stubEnv('USERS_PATH', usersFile);
        vi.stubEnv('TOKENS_PATH', tokensFile);
        vi.stubEnv('AUDIT_LOG_PATH', auditFile);
        fs.writeFileSync(
            usersFile,
            JSON.stringify({
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: [
                    { username: 'writer', passwordHash: 'h', role: 'contributor' },
                    { username: 'other', passwordHash: 'h', role: 'contributor' }
                ]
            })
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe('a new post', () => {
        it('is a draft stamped with the caller name', async () => {
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            const { isError, payload } = await callTool(c, 'create_post', {
                slug: 'new-post',
                title: 'T',
                content: 'C'
            });
            expect(isError).toBe(false);
            expect(payload).toMatchObject({ message: 'Post saved', slug: 'new-post' });

            const onDisk = getPost(postsDir, 'new-post');
            expect(onDisk?.status).toBe('draft');
            expect(onDisk?.author).toBe('writer');
        });

        it('ignores an author in the input', async () => {
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(c, 'create_post', {
                slug: 'stamped',
                title: 'T',
                content: 'C',
                author: 'admin'
            });
            expect(getPost(postsDir, 'stamped')?.author).toBe('writer');

            // The REST body is not schema-checked, so the stamp is proved there too.
            const pat = mintToken('writer', 'writer-pat', WRITE_SCOPES).plaintext;
            const res = await request(buildRestApp())
                .post('/api/posts')
                .set('Authorization', `Bearer ${pat}`)
                .send({ slug: 'stamped-rest', title: 'T', content: 'C', author: 'admin' });
            expect(res.status).toBe(200);
            expect(getPost(postsDir, 'stamped-rest')?.author).toBe('writer');
            expect(getPost(postsDir, 'stamped-rest')?.status).toBe('draft');
        });
    });

    describe('saving an existing post', () => {
        it('keeps the author, the status and the other front-matter keys', async () => {
            writePost(
                'kept',
                'title: Kept\nsummary: s\ndate: 2026-01-01\nauthor: writer\nstatus: published\naliases:\n  - old-kept\n'
            );
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            const { isError } = await callTool(c, 'update_post', {
                slug: 'kept',
                title: 'Kept v2',
                content: 'body v2'
            });
            expect(isError).toBe(false);

            const after = getPost(postsDir, 'kept');
            expect(after?.author).toBe('writer');
            expect(after?.status).toBe('published');
            expect(after?.aliases).toEqual(['old-kept']);
            expect(after?.title).toBe('Kept v2');
            expect(after?.content).toContain('body v2');
        });

        it("refuses another writer's post over MCP and over REST", async () => {
            writePost('theirs', 'title: Theirs\ndate: 2026-01-01\nauthor: writer\n');

            const c = await connectMcp('other', 'contributor', WRITE_SCOPES);
            const { isError, text } = await callTool(c, 'update_post', {
                slug: 'theirs',
                title: 'Hijacked',
                content: 'x'
            });
            expect(isError).toBe(true);
            expect(text).toMatch(/Not your post/);
            expect(getPost(postsDir, 'theirs')?.title).toBe('Theirs');

            const pat = mintToken('other', 'other-pat', WRITE_SCOPES).plaintext;
            const res = await request(buildRestApp())
                .post('/api/posts')
                .set('Authorization', `Bearer ${pat}`)
                .send({ slug: 'theirs', title: 'Hijacked', content: 'x' });
            expect(res.status).toBe(403);
            expect(res.body).toEqual({ message: 'Not your post' });
            expect(getPost(postsDir, 'theirs')?.title).toBe('Theirs');
        });

        it('lets an admin with the moderate scope edit another post', async () => {
            writePost('theirs', 'title: Theirs\ndate: 2026-01-01\nauthor: writer\n');
            const c = await connectMcp('admin', 'admin', MODERATE_SCOPES);
            const { isError } = await callTool(c, 'update_post', {
                slug: 'theirs',
                title: 'Moderated',
                content: 'x'
            });
            expect(isError).toBe(false);
            expect(getPost(postsDir, 'theirs')?.title).toBe('Moderated');
        });

        it('refuses an admin token without the moderate scope', async () => {
            writePost('theirs', 'title: Theirs\ndate: 2026-01-01\nauthor: writer\n');
            const c = await connectMcp('admin', 'admin', WRITE_SCOPES);
            const { isError, text } = await callTool(c, 'update_post', {
                slug: 'theirs',
                title: 'Moderated',
                content: 'x'
            });
            expect(isError).toBe(true);
            expect(text).toMatch(/Not your post/);
            expect(getPost(postsDir, 'theirs')?.title).toBe('Theirs');
        });
    });

    describe('publish and unpublish', () => {
        it('publishes the caller own post and stamps publishedAt once', async () => {
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(c, 'create_post', { slug: 'mine', title: 'T', content: 'C' });

            const { isError, payload } = await callTool(c, 'publish_post', { slug: 'mine' });
            expect(isError).toBe(false);
            expect(payload).toMatchObject({ message: 'Post published', slug: 'mine' });

            const published = getPost(postsDir, 'mine');
            expect(published?.status).toBe('published');
            expect(typeof published?.publishedAt).toBe('string');
            expect(String(published?.publishedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

            // Publishing again keeps the first stamp.
            await callTool(c, 'publish_post', { slug: 'mine' });
            expect(getPost(postsDir, 'mine')?.publishedAt).toBe(published?.publishedAt);
        });

        it("refuses to publish another writer's post", async () => {
            writePost('theirs', 'title: Theirs\ndate: 2026-01-01\nauthor: writer\n');
            const c = await connectMcp('other', 'contributor', WRITE_SCOPES);
            const { isError, text } = await callTool(c, 'publish_post', { slug: 'theirs' });
            expect(isError).toBe(true);
            expect(text).toMatch(/Not your post/);
            expect(getPost(postsDir, 'theirs')?.status).toBe('published');
        });

        it('refuses publish_post without the publish scope', async () => {
            const c = await connectMcp('writer', 'contributor', ['read', 'content:write']);
            await callTool(c, 'create_post', { slug: 'mine', title: 'T', content: 'C' });
            const { isError, text } = await callTool(c, 'publish_post', { slug: 'mine' });
            expect(isError).toBe(true);
            expect(text).toMatch(/Token lacks scope publish/);
            expect(getPost(postsDir, 'mine')?.status).toBe('draft');
        });

        it('unpublishes only with the admin role and the moderate scope', async () => {
            writePost('live', 'title: Live\ndate: 2026-01-01\nauthor: writer\nstatus: published\n');

            // A contributor never sees the tool.
            const contributor = await connectMcp('writer', 'contributor', MODERATE_SCOPES);
            const listed = (await contributor.listTools()).tools.map((t) => t.name);
            expect(listed).not.toContain('unpublish_post');

            // An admin without the moderate scope is refused by name.
            const noModerate = await connectMcp('admin', 'admin', WRITE_SCOPES);
            const denied = await callTool(noModerate, 'unpublish_post', { slug: 'live' });
            expect(denied.isError).toBe(true);
            expect(denied.text).toMatch(/Token lacks scope moderate/);
            expect(getPost(postsDir, 'live')?.status).toBe('published');

            // An admin with the moderate scope may unpublish.
            const admin = await connectMcp('admin', 'admin', MODERATE_SCOPES);
            const ok = await callTool(admin, 'unpublish_post', { slug: 'live' });
            expect(ok.isError).toBe(false);
            expect(ok.payload).toMatchObject({ message: 'Post unpublished', slug: 'live' });
            expect(getPost(postsDir, 'live')?.status).toBe('draft');
        });
    });

    describe('a draft is private', () => {
        it('is hidden from the public REST reads and from the meta page', async () => {
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(c, 'create_post', {
                slug: 'hidden',
                title: 'Secret draft title',
                content: 'C'
            });
            // The alias of a draft must not lead a visitor to it either.
            writePost(
                'aliased',
                'title: Aliased\ndate: 2026-01-01\nauthor: writer\nstatus: draft\naliases:\n  - old-aliased\n'
            );

            const app = buildRestApp();
            const list = await request(app).get('/api/posts');
            expect(list.status).toBe(200);
            const slugs = list.body.posts.map((p: any) => p.slug);
            expect(slugs).not.toContain('hidden');
            expect(slugs).not.toContain('aliased');

            const one = await request(app).get('/api/posts/hidden');
            expect(one.status).toBe(404);
            expect(one.body).toEqual({ message: 'Post not found' });

            const alias = await request(app).get('/api/posts/old-aliased');
            expect(alias.status).toBe(404);

            const meta = await request(app).get('/post/hidden');
            expect(meta.status).toBe(200);
            expect(meta.text).not.toContain('Secret draft title');

            // The control: a published post does show its title, so the check
            // above is not vacuous.
            writePost(
                'shown',
                'title: Public title\nsummary: s\ndate: 2026-01-01\nauthor: writer\nstatus: published\n'
            );
            const shownMeta = await request(app).get('/post/shown');
            expect(shownMeta.status).toBe(200);
            expect(shownMeta.text).toContain('Public title');
        });

        it('is visible over MCP to its author and hidden from another read token', async () => {
            const author = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(author, 'create_post', {
                slug: 'private',
                title: 'Private',
                content: 'C'
            });

            const own = await callTool(author, 'list_posts', {});
            expect(own.payload.posts.map((p: any) => p.slug)).toContain('private');

            const other = await connectMcp('other', 'contributor', ['read']);
            const listed = await callTool(other, 'list_posts', {});
            expect(listed.payload.posts.map((p: any) => p.slug)).not.toContain('private');

            const one = await callTool(other, 'get_post', { slug: 'private' });
            expect(one.isError).toBe(true);
            expect(one.text).toMatch(/not found/i);

            // An admin session moderates the drafts of the other authors, but a
            // read-only token never sees a draft that is not its own.
            const admin = await connectMcp('admin', 'admin');
            const adminList = await callTool(admin, 'list_posts', {});
            expect(adminList.payload.posts.map((p: any) => p.slug)).toContain('private');

            const adminRead = await connectMcp('admin', 'admin', ['read']);
            const adminReadList = await callTool(adminRead, 'list_posts', {});
            expect(adminReadList.payload.posts.map((p: any) => p.slug)).not.toContain('private');
        });

        it('lists the published posts of a caller with the status filter', async () => {
            const c = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(c, 'create_post', { slug: 'draft-one', title: 'D', content: 'C' });
            writePost(
                'pub-one',
                'title: P\ndate: 2026-01-01\nauthor: writer\nstatus: published\n'
            );

            const all = await callTool(c, 'list_posts', {});
            expect(all.payload.posts.map((p: any) => p.slug).sort()).toEqual(['draft-one', 'pub-one']);
            expect(all.payload.posts.every((p: any) => typeof p.status === 'string')).toBe(true);

            const drafts = await callTool(c, 'list_posts', { status: 'draft' });
            expect(drafts.payload.posts.map((p: any) => p.slug)).toEqual(['draft-one']);

            const published = await callTool(c, 'list_posts', { status: 'published' });
            expect(published.payload.posts.map((p: any) => p.slug)).toEqual(['pub-one']);
        });
    });

    describe('a post without a status', () => {
        it('is published', async () => {
            writePost('legacy', 'title: Legacy\ndate: 2026-01-01\nauthor: writer\n');
            const c = await connectMcp('writer', 'contributor', ['read']);
            const { payload } = await callTool(c, 'list_posts', {});
            const post = payload.posts.find((p: any) => p.slug === 'legacy');
            expect(post?.status).toBe('published');

            const app = buildRestApp();
            const list = await request(app).get('/api/posts');
            expect(list.body.posts.map((p: any) => p.slug)).toContain('legacy');
            expect((await request(app).get('/api/posts/legacy')).status).toBe(200);
        });
    });

    describe('the audit log', () => {
        it('has a row for every save, publish and unpublish', async () => {
            const writer = await connectMcp('writer', 'contributor', WRITE_SCOPES);
            await callTool(writer, 'create_post', { slug: 'audited', title: 'T', content: 'C' });
            await callTool(writer, 'update_post', { slug: 'audited', title: 'T2', content: 'C2' });
            await callTool(writer, 'publish_post', { slug: 'audited' });
            const admin = await connectMcp('admin', 'admin', MODERATE_SCOPES);
            await callTool(admin, 'unpublish_post', { slug: 'audited' });

            const rows = postAuditRows().filter((r) => r.slug === 'audited');
            expect(rows.map((r) => r.action).sort()).toEqual(['create', 'publish', 'unpublish', 'update']);
            for (const row of rows) {
                expect(row.event).toBe('post');
                expect(typeof row.user).toBe('string');
                expect(row.user).toBeTruthy();
            }
            expect(rows.find((r) => r.action === 'create')?.user).toBe('writer');
            expect(rows.find((r) => r.action === 'unpublish')?.user).toBe('admin');

            // The row names the post, never its content.
            const raw = fs.readFileSync(auditFile, 'utf8');
            expect(raw).not.toContain('C2');
        });

        it('writes a row for a REST save as well', async () => {
            const pat = mintToken('writer', 'writer-pat', WRITE_SCOPES).plaintext;
            const res = await request(buildRestApp())
                .post('/api/posts')
                .set('Authorization', `Bearer ${pat}`)
                .send({ slug: 'rest-audited', title: 'T', content: 'C' });
            expect(res.status).toBe(200);
            const rows = postAuditRows().filter((r) => r.slug === 'rest-audited');
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe('create');
            expect(rows[0].user).toBe('writer');
        });
    });
});
