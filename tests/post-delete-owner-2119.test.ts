/**
 * Track #2119 U8: delete_post ownership and draft-only rule.
 *
 * A contributor may delete only their own drafts. An admin may delete any post
 * only when it is their own or when their token holds the moderate scope (or
 * they are unscoped, e.g. JWT/session). Refusals leave the file bytes on disk.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { loadUsers, saveUsers } from '../server/lib/config.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { publishPostAsCaller, unpublishPostAsCaller } from '../server/lib/post-policy.ts';
import { getPost } from '../server/lib/posts.ts';

const postsDir = path.resolve(process.cwd(), 'tests/tmp/posts');

let tmp = '';
let auditFile = '';
let tokensFile = '';
let usersFile = '';
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

function writePost(slug: string, author: string, status: 'draft' | 'published', content = 'body') {
    fs.writeFileSync(
        path.join(postsDir, `${slug}.md`),
        `---\ntitle: T\nauthor: ${author}\nstatus: ${status}\n---\n\n${content}`
    );
    createdSlugs.add(slug);
}

function fileBytes(slug: string): Buffer | null {
    const file = path.join(postsDir, `${slug}.md`);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function fileHash(slug: string): string | null {
    const bytes = fileBytes(slug);
    return bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-delete-'));
    auditFile = path.join(tmp, 'audit.log');
    tokensFile = path.join(tmp, 'tokens.json');
    usersFile = path.join(tmp, 'users.json');
    vi.stubEnv('AUDIT_LOG_PATH', auditFile);
    vi.stubEnv('TOKENS_PATH', tokensFile);
    vi.stubEnv('USERS_PATH', usersFile);
    fs.mkdirSync(postsDir, { recursive: true });

    const users = loadUsers();
    users.users = users.users.filter((u) => u.username !== 'alice' && u.username !== 'bob');
    users.users.push(
        { username: 'alice', passwordHash: 'h', role: 'contributor' },
        { username: 'bob', passwordHash: 'h', role: 'contributor' }
    );
    saveUsers(users);
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

describe('contributor delete ownership (MCP)', () => {
    it('deletes their own draft', async () => {
        writePost('alice-draft', 'alice', 'draft');
        const { plaintext } = mintToken('alice', 'alice-write', ['read', 'content:write']);
        const before = fileHash('alice-draft');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'alice-draft' }));
        expect(res.status).toBe(200);
        expect(fileBytes('alice-draft')).toBeNull();

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.user).toBe('alice');
        expect(row.beforeSha256).toBe(before);
        expect(row.afterSha256).toBeNull();
    });

    it('cannot delete their own published post', async () => {
        writePost('alice-published', 'alice', 'published');
        const { plaintext } = mintToken('alice', 'alice-write', ['read', 'content:write']);
        const before = fileHash('alice-published');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'alice-published' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Not allowed to delete this post/);
        expect(fileHash('alice-published')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toMatch(/published/);
    });

    it('cannot delete another contributor\'s draft, and cannot tell it exists', async () => {
        writePost('bob-draft', 'bob', 'draft');
        const { plaintext } = mintToken('alice', 'alice-write', ['read', 'content:write']);
        const before = fileHash('bob-draft');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'bob-draft' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Post not found/);
        expect(fileHash('bob-draft')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('not_owner');
    });

    it('cannot delete another contributor\'s published post', async () => {
        writePost('bob-published', 'bob', 'published');
        const { plaintext } = mintToken('alice', 'alice-write', ['read', 'content:write']);
        const before = fileHash('bob-published');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'bob-published' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Not allowed to delete this post/);
        expect(fileHash('bob-published')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });
});

describe('contributor delete ownership (REST)', () => {
    it('deletes their own draft', async () => {
        writePost('alice-draft-rest', 'alice', 'draft');
        const { plaintext } = mintToken('alice', 'alice-rest', ['read', 'content:write']);
        const before = fileHash('alice-draft-rest');

        const res = await request(app)
            .delete('/api/posts/alice-draft-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(200);
        expect(fileBytes('alice-draft-rest')).toBeNull();

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.user).toBe('alice');
        expect(row.beforeSha256).toBe(before);
    });

    it('cannot delete their own published post', async () => {
        writePost('alice-published-rest', 'alice', 'published');
        const { plaintext } = mintToken('alice', 'alice-rest', ['read', 'content:write']);
        const before = fileHash('alice-published-rest');

        const res = await request(app)
            .delete('/api/posts/alice-published-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Not allowed to delete this post');
        expect(fileHash('alice-published-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });

    it('cannot delete another contributor\'s draft, and cannot tell it exists', async () => {
        writePost('bob-draft-rest', 'bob', 'draft');
        const { plaintext } = mintToken('alice', 'alice-rest', ['read', 'content:write']);
        const before = fileHash('bob-draft-rest');

        const res = await request(app)
            .delete('/api/posts/bob-draft-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Post not found');
        expect(fileHash('bob-draft-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('not_owner');
    });

    it('cannot delete another contributor\'s published post', async () => {
        writePost('bob-published-rest', 'bob', 'published');
        const { plaintext } = mintToken('alice', 'alice-rest', ['read', 'content:write']);
        const before = fileHash('bob-published-rest');

        const res = await request(app)
            .delete('/api/posts/bob-published-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Not allowed to delete this post');
        expect(fileHash('bob-published-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });
});

describe('admin delete ownership (MCP)', () => {
    it('cannot delete another\'s post without moderate scope', async () => {
        writePost('bob-admin-draft', 'bob', 'draft');
        const { plaintext } = mintToken('admin', 'admin-no-mod', ['read', 'content:write']);
        const before = fileHash('bob-admin-draft');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'bob-admin-draft' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Not allowed to delete this post/);
        expect(fileHash('bob-admin-draft')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });

    it('can delete another\'s post with moderate scope', async () => {
        writePost('bob-admin-published', 'bob', 'published');
        const { plaintext } = mintToken('admin', 'admin-mod', ['read', 'content:write', 'moderate']);
        const before = fileHash('bob-admin-published');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'bob-admin-published' }));
        expect(res.status).toBe(200);
        expect(fileBytes('bob-admin-published')).toBeNull();

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.user).toBe('admin');
        expect(row.beforeSha256).toBe(before);
        expect(row.afterSha256).toBeNull();
    });
});

describe('admin delete ownership (REST)', () => {
    it('cannot delete another\'s post without moderate scope', async () => {
        writePost('bob-admin-rest', 'bob', 'draft');
        const { plaintext } = mintToken('admin', 'admin-rest-no-mod', ['read', 'content:write']);
        const before = fileHash('bob-admin-rest');

        const res = await request(app)
            .delete('/api/posts/bob-admin-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Not allowed to delete this post');
        expect(fileHash('bob-admin-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });

    it('can delete another\'s post with moderate scope', async () => {
        writePost('bob-admin-rest-pub', 'bob', 'published');
        const { plaintext } = mintToken('admin', 'admin-rest-mod', ['read', 'content:write', 'moderate']);
        const before = fileHash('bob-admin-rest-pub');

        const res = await request(app)
            .delete('/api/posts/bob-admin-rest-pub')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(200);
        expect(fileBytes('bob-admin-rest-pub')).toBeNull();

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.beforeSha256).toBe(before);
    });
});

describe('delete refusal for missing or broken posts', () => {
    it('returns 404 for a missing post (REST)', async () => {
        const { plaintext } = mintToken('alice', 'missing-rest', ['read', 'content:write']);
        const res = await request(app)
            .delete('/api/posts/no-such-post')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Post not found');

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toMatch(/not_found/);
    });

    it('returns not found for a missing post (MCP)', async () => {
        const { plaintext } = mintToken('alice', 'missing-mcp', ['read', 'content:write']);
        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'no-such-post' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Post not found/);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });

    it('never deletes a post whose front matter does not parse', async () => {
        const slug = 'broken-post';
        fs.writeFileSync(path.join(postsDir, `${slug}.md`), '---\nthis is not valid yaml: [\n---\n\nbody');
        createdSlugs.add(slug);
        const before = fileHash(slug);
        const { plaintext } = mintToken('alice', 'broken-mcp', ['read', 'content:write']);

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug }));
        expect(res.status).toBe(200);
        expect(fileHash(slug)).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });
});

describe('a once-published draft belongs to moderation, not to its author (fix 2)', () => {
    const admin = { username: 'admin', role: 'admin' };

    /** Publish then unpublish as an admin: the post is a draft again and keeps publishedAt. */
    function publishThenUnpublish(slug: string): void {
        const published = publishPostAsCaller(postsDir, slug, admin);
        expect(published.ok).toBe(true);
        const unpublished = unpublishPostAsCaller(postsDir, slug, admin);
        expect(unpublished.ok).toBe(true);
        const post = getPost(postsDir, slug);
        expect(post?.status).toBe('draft');
        // The unpublish keeps publishedAt: that stamp is what rollback needs.
        expect(post?.publishedAt).toBeTruthy();
    }

    it('refuses the author\'s MCP delete_post and leaves the bytes alone', async () => {
        writePost('alice-unpublished-mcp', 'alice', 'draft', 'kept for rollback');
        publishThenUnpublish('alice-unpublished-mcp');
        const { plaintext } = mintToken('alice', 'alice-unpub-mcp', ['read', 'content:write']);
        const before = fileHash('alice-unpublished-mcp');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'alice-unpublished-mcp' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Not allowed to delete this post/);
        expect(fileHash('alice-unpublished-mcp')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('was_published');
        expect(row.beforeSha256).toBe(before);
        expect(row.afterSha256).toBe(before);
    });

    it('refuses the author\'s REST DELETE and leaves the bytes alone', async () => {
        writePost('alice-unpublished-rest', 'alice', 'draft', 'kept for rollback');
        publishThenUnpublish('alice-unpublished-rest');
        const { plaintext } = mintToken('alice', 'alice-unpub-rest', ['read', 'content:write']);
        const before = fileHash('alice-unpublished-rest');

        const res = await request(app)
            .delete('/api/posts/alice-unpublished-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Not allowed to delete this post');
        expect(fileHash('alice-unpublished-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('was_published');
    });

    it('still deletes an own draft that was never published', async () => {
        writePost('alice-never-published', 'alice', 'draft');
        expect(getPost(postsDir, 'alice-never-published')?.publishedAt).toBeUndefined();
        const { plaintext } = mintToken('alice', 'alice-never-pub', ['read', 'content:write']);

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'alice-never-published' }));
        expect(res.status).toBe(200);
        expect(fileBytes('alice-never-published')).toBeNull();

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBeUndefined();
        expect(row.reason).toBeUndefined();
    });
});

describe('delete does not leak the existence of another author\'s draft (fix 2)', () => {
    it('answers like a missing post over MCP and audits not_owner', async () => {
        writePost('bob-hidden-draft', 'bob', 'draft');
        const { plaintext } = mintToken('alice', 'alice-probe-mcp', ['read', 'content:write']);
        const before = fileHash('bob-hidden-draft');

        const res = await mcpCall(plaintext, toolCall('delete_post', { slug: 'bob-hidden-draft' }));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/Post not found/);
        expect(JSON.stringify(res.body)).not.toMatch(/Not allowed to delete this post/);
        expect(fileHash('bob-hidden-draft')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('not_owner');
    });

    it('answers 404 like a missing post over REST and audits not_owner', async () => {
        writePost('bob-hidden-draft-rest', 'bob', 'draft');
        const { plaintext } = mintToken('alice', 'alice-probe-rest', ['read', 'content:write']);
        const before = fileHash('bob-hidden-draft-rest');

        const res = await request(app)
            .delete('/api/posts/bob-hidden-draft-rest')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Post not found');
        expect(fileHash('bob-hidden-draft-rest')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
        expect(row.reason).toBe('not_owner');
    });

    it('still answers 403 for another author\'s published post (visible, not deletable)', async () => {
        writePost('bob-visible-published', 'bob', 'published');
        const { plaintext } = mintToken('alice', 'alice-visible-pub', ['read', 'content:write']);
        const before = fileHash('bob-visible-published');

        const res = await request(app)
            .delete('/api/posts/bob-visible-published')
            .set('Authorization', `Bearer ${plaintext}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Not allowed to delete this post');
        expect(fileHash('bob-visible-published')).toBe(before);

        const row = auditRows().find((r) => r.event === 'post' && r.action === 'delete');
        expect(row).toBeTruthy();
        expect(row.outcome).toBe('denied');
    });
});
