/**
 * P0 C1: a symlink under the posts, images or themes tree must never be read,
 * written or deleted through; the target outside the tree stays untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { configPath } from '../server/lib/config.ts';
import { isSafeExistingPath } from '../server/lib/safe-path.ts';
import { selectThemeProblem } from '../server/lib/themes.ts';
import { getPost, getPosts, findPostByAlias, savePost, writeFileNoFollow, UnsafePostPathError } from '../server/lib/posts.ts';
import {
    savePostAsCaller,
    publishPostAsCaller,
    unpublishPostAsCaller,
    deletePostAsCaller
} from '../server/lib/post-policy.ts';

const postsDir = path.resolve(process.cwd(), 'tests/tmp/posts');
const imagesDir = path.join(postsDir, 'images');
const themesDir = path.resolve(process.cwd(), 'tests/tmp/themes');
const CANARY = 'CANARY-OUTSIDE-ROOT-do-not-touch';
const admin = { username: 'admin', role: 'admin' } as const;

let tmp = '';
let outside = '';
let pat = '';
const planted: string[] = [];

function plant(link: string, target: string) {
    fs.rmSync(link, { force: true });
    fs.symlinkSync(target, link);
    planted.push(link);
}

function mcp(name: string, args: Record<string, unknown>) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('MCP-Protocol-Version', '2025-06-18')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-c1-'));
    outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, `---\ntitle: x\naliases: [evil-alias]\n---\n${CANARY}\n`);
    vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
    vi.stubEnv('AUDIT_LOG_PATH', path.join(tmp, 'audit.log'));
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(themesDir, { recursive: true });
    pat = mintToken('admin', 'c1', 'write').plaintext;
    resetRateLimits();
    plant(path.join(postsDir, 'symlink-evil.md'), '/etc/passwd');
    plant(path.join(postsDir, 'symlink-out.md'), outside);
});

afterEach(() => {
    vi.unstubAllEnvs();
    for (const p of planted) fs.rmSync(p, { force: true });
    planted.length = 0;
    fs.rmSync(tmp, { recursive: true, force: true });
    resetRateLimits();
});

describe('isSafeExistingPath', () => {
    it('accepts a regular file and a not-yet-existing file, rejects symlinks and symlinked dirs', () => {
        const base = path.join(tmp, 'base');
        fs.mkdirSync(base);
        fs.writeFileSync(path.join(base, 'ok.md'), 'x');
        expect(isSafeExistingPath(base, path.join(base, 'ok.md'))).toBe(true);
        expect(isSafeExistingPath(base, path.join(base, 'new.md'))).toBe(true);
        fs.symlinkSync(outside, path.join(base, 'out.md'));
        expect(isSafeExistingPath(base, path.join(base, 'out.md'))).toBe(false);
        fs.symlinkSync(path.join(base, 'ok.md'), path.join(base, 'inside.md'));
        expect(isSafeExistingPath(base, path.join(base, 'inside.md'))).toBe(false);
        fs.symlinkSync(tmp, path.join(base, 'dir'));
        expect(isSafeExistingPath(base, path.join(base, 'dir', 'outside.md'))).toBe(false);
        expect(isSafeExistingPath(base, path.join(base, '..', 'outside.md'))).toBe(false);
    });
});

describe('isSafeExistingPath fails closed', () => {
    it('returns false when realpath(baseDir) fails with EACCES, true for ENOENT', () => {
        const base = path.join(tmp, 'base2');
        fs.mkdirSync(base);
        const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
        });
        try {
            expect(isSafeExistingPath(base, path.join(base, 'a.md'))).toBe(false);
        } finally {
            spy.mockRestore();
        }
        expect(isSafeExistingPath(path.join(tmp, 'missing-base'), path.join(tmp, 'missing-base', 'a.md'))).toBe(true);
    });
});

describe('posts library', () => {
    it('getPost returns null, getPosts and findPostByAlias skip symlinks', () => {
        expect(getPost(postsDir, 'symlink-evil')).toBeNull();
        expect(getPost(postsDir, 'symlink-out')).toBeNull();
        const slugs = getPosts(postsDir).map((p) => p.slug);
        expect(slugs).not.toContain('symlink-evil');
        expect(slugs).not.toContain('symlink-out');
        expect(findPostByAlias(postsDir, 'evil-alias')).toBeNull();
    });

    it('writes and deletes refuse and leave the target untouched', () => {
        const before = fs.readFileSync(outside, 'utf8');
        expect(() => savePost(postsDir, { slug: 'symlink-out', content: 'pwned' })).toThrow();
        expect(savePostAsCaller(postsDir, { slug: 'symlink-out', content: 'pwned' }, admin).ok).toBe(false);
        expect(publishPostAsCaller(postsDir, 'symlink-out', admin).ok).toBe(false);
        expect(unpublishPostAsCaller(postsDir, 'symlink-out', admin).ok).toBe(false);
        expect(deletePostAsCaller(postsDir, 'symlink-out', admin).ok).toBe(false);
        expect(fs.readFileSync(outside, 'utf8')).toBe(before);
        expect(fs.lstatSync(path.join(postsDir, 'symlink-out.md')).isSymbolicLink()).toBe(true);
    });
});

describe('writeFileNoFollow fails closed without O_NOFOLLOW', () => {
    it('throws UnsafePostPathError and writes nothing, through a link or not', () => {
        const before = fs.readFileSync(outside, 'utf8');
        const fresh = path.join(postsDir, 'nofollow-fresh.md');
        try {
            // fs.constants is frozen, so pass `{ noFollow: undefined }` as the missing O_NOFOLLOW.
            expect(() => writeFileNoFollow(fresh, 'x', { noFollow: undefined })).toThrow(UnsafePostPathError);
            expect(fs.existsSync(fresh)).toBe(false);
            expect(() =>
                writeFileNoFollow(path.join(postsDir, 'symlink-out.md'), 'pwned', { noFollow: undefined })
            ).toThrow(UnsafePostPathError);
        } finally {
            fs.rmSync(fresh, { force: true });
        }
        expect(fs.readFileSync(outside, 'utf8')).toBe(before);
        expect(fs.lstatSync(path.join(postsDir, 'symlink-out.md')).isSymbolicLink()).toBe(true);
    });
});

describe('MCP', () => {
    it('get_post, list_posts and delete_post do not leak or follow the symlink', async () => {
        const got = await mcp('get_post', { slug: 'symlink-evil' });
        expect(JSON.stringify(got.body)).not.toMatch(/root:/);
        expect(JSON.stringify(got.body)).toMatch(/not found/i);
        const gotOut = await mcp('get_post', { slug: 'symlink-out' });
        expect(JSON.stringify(gotOut.body)).not.toContain(CANARY);

        const list = await mcp('list_posts', {});
        expect(JSON.stringify(list.body)).not.toMatch(/symlink-evil|symlink-out/);

        const del = await mcp('delete_post', { slug: 'symlink-out' });
        expect(JSON.stringify(del.body)).toMatch(/isError":true|"isError":\s*true/);
        expect(fs.existsSync(outside)).toBe(true);
        expect(fs.lstatSync(path.join(postsDir, 'symlink-out.md')).isSymbolicLink()).toBe(true);
    });

    it('create_post, update_post, publish_post, unpublish_post refuse', async () => {
        const before = fs.readFileSync(outside, 'utf8');
        for (const [name, args] of [
            ['create_post', { slug: 'symlink-out', title: 't', content: 'pwned' }],
            ['update_post', { slug: 'symlink-out', title: 't', content: 'pwned' }],
            ['publish_post', { slug: 'symlink-out' }],
            ['unpublish_post', { slug: 'symlink-out' }]
        ] as const) {
            const res = await mcp(name, args as Record<string, unknown>);
            expect(res.body.result?.isError, name).toBe(true);
        }
        expect(fs.readFileSync(outside, 'utf8')).toBe(before);
    });

    it('delete_image refuses a symlinked image', async () => {
        plant(path.join(imagesDir, 'evil.png'), outside);
        const res = await mcp('delete_image', { filename: 'evil.png' });
        expect(res.body.result?.isError).toBe(true);
        expect(fs.lstatSync(path.join(imagesDir, 'evil.png')).isSymbolicLink()).toBe(true);
        expect(fs.existsSync(outside)).toBe(true);
    });

    it('save_theme and set_theme refuse a symlinked theme file', async () => {
        plant(path.join(themesDir, 'evil-theme.json'), outside);
        const before = fs.readFileSync(outside, 'utf8');
        const save = await mcp('save_theme', { name: 'evil-theme', colors: { bg: '#000000' } });
        expect(save.body.result?.isError).toBe(true);
        expect(fs.readFileSync(outside, 'utf8')).toBe(before);
        const set = await mcp('set_theme', { themeId: 'evil-theme' });
        expect(set.body.result?.isError).toBe(true);
    });
});

describe('config routes refuse a symlinked theme file', () => {
    // The test environment's own config file: themes resolve next to it (tests/tmp/themes).
    const cfgFile = configPath();

    it('MCP update_config { currentTheme } and POST /api/admin/config { currentTheme } leave config.json identical', async () => {
        plant(path.join(themesDir, 'evil-theme.json'), '/etc/passwd');
        const before = fs.readFileSync(cfgFile);
        const m = await mcp('update_config', { patch: { currentTheme: 'evil-theme' } });
        expect(m.body.result?.isError).toBe(true);
        expect(JSON.stringify(m.body)).toContain('Invalid theme path');
        expect(fs.readFileSync(cfgFile).equals(before)).toBe(true);
        const r = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ currentTheme: 'evil-theme' });
        expect(r.status).toBe(400);
        expect(fs.readFileSync(cfgFile).equals(before)).toBe(true);
    });
});

describe('custom themeDir: one shared check for set_theme, update_config and REST', () => {
    it('all three paths refuse a symlinked theme file, and selectThemeProblem agrees', async () => {
        const originalThemeDir = JSON.parse(fs.readFileSync(configPath(), 'utf8')).themeDir as string;
        const cfgFile = path.join(tmp, 'config.json');
        const customThemes = path.join(tmp, 'my-themes');
        fs.mkdirSync(customThemes, { recursive: true });
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({ postsDir: postsDir, themeDir: customThemes, currentTheme: 'dark', siteName: 'Seed' })
        );
        vi.stubEnv('CONFIG_PATH', cfgFile);
        fs.symlinkSync(outside, path.join(customThemes, 'evil-theme.json'));
        // Point the active (in-memory) config at the custom themeDir through the REST route.
        const point = (themeDir: string) =>
            request(app).post('/api/admin/config').set('Authorization', `Bearer ${pat}`).send({ themeDir });
        expect((await point(customThemes)).status).toBe(200);
        try {
            const before = fs.readFileSync(cfgFile);
            expect(selectThemeProblem(tmp, { themeDir: customThemes }, 'evil-theme')).toBe('Invalid theme path');
            expect(selectThemeProblem(tmp, { themeDir: customThemes }, '../x')).toBe('Invalid theme id');

            const set = await mcp('set_theme', { themeId: 'evil-theme' });
            expect(set.body.result?.isError, JSON.stringify(set.body)).toBe(true);
            expect(JSON.stringify(set.body)).toContain('Invalid theme path');
            const upd = await mcp('update_config', { patch: { currentTheme: 'evil-theme' } });
            expect(upd.body.result?.isError, JSON.stringify(upd.body)).toBe(true);
            expect(JSON.stringify(upd.body)).toContain('Invalid theme path');
            const rest = await request(app)
                .post('/api/admin/config')
                .set('Authorization', `Bearer ${pat}`)
                .send({ currentTheme: 'evil-theme' });
            expect(rest.status).toBe(400);
            expect(JSON.stringify(rest.body)).toContain('Invalid theme path');
            expect(fs.readFileSync(cfgFile).equals(before)).toBe(true);
        } finally {
            await point(originalThemeDir);
        }
    });
});

describe('update_config checks the theme against the on-disk themeDir', () => {
    it('refuses a symlinked theme in the disk themeDir when it differs from the active one', async () => {
        const cfgFile = path.join(tmp, 'config.json');
        const diskThemes = path.join(tmp, 'disk-themes');
        fs.mkdirSync(diskThemes, { recursive: true });
        fs.symlinkSync('/etc/passwd', path.join(diskThemes, 'evil-theme.json'));
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({ postsDir, themeDir: diskThemes, currentTheme: 'dark', siteName: 'Seed' })
        );
        vi.stubEnv('CONFIG_PATH', cfgFile);
        const before = fs.readFileSync(cfgFile);
        const upd = await mcp('update_config', { patch: { currentTheme: 'evil-theme' } });
        expect(upd.body.result?.isError, JSON.stringify(upd.body)).toBe(true);
        expect(JSON.stringify(upd.body)).toContain('Invalid theme path');
        expect(fs.readFileSync(cfgFile).equals(before)).toBe(true);
    });
});

describe('POST /api/admin/config theme check uses the post-merge themeDir', () => {
    it('themeDir + currentTheme in one request is checked against the new themeDir', async () => {
        const cfgFile = path.join(tmp, 'config.json');
        const customDir = path.join(tmp, 'new-themes');
        fs.mkdirSync(customDir, { recursive: true });
        fs.symlinkSync(outside, path.join(customDir, 'evil-theme.json'));
        fs.writeFileSync(cfgFile, JSON.stringify({ postsDir, currentTheme: 'dark', siteName: 'Seed' }));
        vi.stubEnv('CONFIG_PATH', cfgFile);
        const before = fs.readFileSync(cfgFile);
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ themeDir: customDir, currentTheme: 'evil-theme' });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(fs.readFileSync(cfgFile).equals(before)).toBe(true);
    });

    it('currentTheme: null is not an Invalid theme id error', async () => {
        const cfgFile = path.join(tmp, 'config.json');
        fs.writeFileSync(cfgFile, JSON.stringify({ postsDir, currentTheme: 'dark', siteName: 'Seed' }));
        vi.stubEnv('CONFIG_PATH', cfgFile);
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ currentTheme: null });
        expect(JSON.stringify(res.body)).not.toContain('Invalid theme id');
        expect(res.status).not.toBe(400);
    });
});

describe('REST', () => {
    it('GET /api/posts/:slug and GET /api/posts do not leak', async () => {
        const one = await request(app).get('/api/posts/symlink-evil');
        expect(one.status).toBe(404);
        expect(JSON.stringify(one.body)).not.toMatch(/root:/);
        const out = await request(app).get('/api/posts/symlink-out');
        expect(out.status).toBe(404);
        expect(JSON.stringify(out.body)).not.toContain(CANARY);
        const alias = await request(app).get('/api/posts/evil-alias');
        expect(alias.status).toBe(404);
        const list = await request(app).get('/api/posts');
        expect(JSON.stringify(list.body)).not.toMatch(/symlink-evil|symlink-out/);
    });

    it('POST and DELETE refuse without touching the target', async () => {
        const before = fs.readFileSync(outside, 'utf8');
        const post = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${pat}`)
            .send({ slug: 'symlink-out', title: 't', content: 'pwned' });
        expect(post.status).toBeGreaterThanOrEqual(400);
        const del = await request(app)
            .delete('/api/posts/symlink-out')
            .set('Authorization', `Bearer ${pat}`);
        expect(del.status).toBeGreaterThanOrEqual(400);
        expect(fs.readFileSync(outside, 'utf8')).toBe(before);
        expect(fs.lstatSync(path.join(postsDir, 'symlink-out.md')).isSymbolicLink()).toBe(true);
    });

    it('/api/images/:filename does not serve a symlinked image', async () => {
        plant(path.join(imagesDir, 'evil2.png'), outside);
        const res = await request(app).get('/api/images/evil2.png');
        expect(res.status).toBe(404);
    });
});
