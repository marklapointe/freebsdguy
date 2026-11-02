/**
 * Track #1682 slice 1 — server-side link previews.
 *
 * Part 1: pure unit tests for server/lib/og-meta.ts
 * Part 2: integration test over the real Express SPA catch-all.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    htmlEscape,
    stripMarkdownish,
    truncate,
    resolveShareUrl,
    buildMetaTags,
    injectMeta,
    type MetaArgs
} from '../server/lib/og-meta';
import type { Post } from '../server/lib/posts';

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>OLD SITE TITLE</title>
</head>
<body>
    <div id="root"></div>
</body>
</html>`;

const DISCORD_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

const makeArgs = (over: Partial<MetaArgs>): MetaArgs => ({
    config: { siteName: 'The FreeBSD Guy', siteTagline: 'A blog', shareImage: '/img/cover.png' },
    origin: 'http://localhost:3000',
    path: '/',
    post: null,
    isPost: false,
    ...over
});

// ---------------------------------------------------------------------------
describe('og-meta: htmlEscape', () => {
    it('escapes &, <, >, ", and \'', () => {
        expect(htmlEscape('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
    });

    it('leaves safe text untouched', () => {
        expect(htmlEscape('Plain Title 123')).toBe('Plain Title 123');
    });

    it('a title containing <script> is escaped, never raw', () => {
        const escaped = htmlEscape('<script>alert(1)</script> "quotes" & \'apostrophe\'');
        expect(escaped).not.toContain('<script>');
        expect(escaped).toContain('&lt;script&gt;');
        expect(escaped).toContain('&quot;quotes&quot;');
    });
});

describe('og-meta: stripMarkdownish / truncate', () => {
    it('strips markdown markers and collapses whitespace/newlines', () => {
        expect(stripMarkdownish('Hello **bold** and `code` link [x](http://e)\nsecond line')).toBe(
            'Hello bold and code link x second line'
        );
    });

    it('truncates to the max length', () => {
        expect(truncate('abcdefghijklmnop', 5)).toBe('abcde');
    });

    it('makes a share URL absolute when relative', () => {
        expect(resolveShareUrl('/img/cover.png', 'http://host')).toBe('http://host/img/cover.png');
        expect(resolveShareUrl('img/cover.png', 'http://host/')).toBe('http://host/img/cover.png');
        expect(resolveShareUrl('https://cdn.test/x.png', 'http://host')).toBe('https://cdn.test/x.png');
    });
});

describe('og-meta: review hardening (Track #1682 slice 1)', () => {
    it('drops protocol-relative, data: and non-http post images', () => {
        for (const bad of ['//evil.example/x.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://h/x.png']) {
            const post = { slug: 'p', title: 'T', summary: 'S', date: '2026-01-01', image: bad } as unknown as Post;
            const joined = buildMetaTags(makeArgs({ path: '/post/p', isPost: true, post })).meta.join('\n');
            expect(joined).not.toContain('evil.example');
            expect(joined).not.toContain('data:');
            expect(joined).not.toContain('javascript:');
            expect(joined).not.toContain('ftp:');
            expect(joined).toContain('og:image" content="http://localhost:3000/img/cover.png"');
        }
    });

    it('falls back to the site tagline when a post has no summary', () => {
        const post = { slug: 'p', title: 'T', summary: '', date: '2026-01-01' } as unknown as Post;
        const joined = buildMetaTags(makeArgs({ path: '/post/p', isPost: true, post })).meta.join('\n');
        expect(joined).toContain('og:description" content="A blog"');
    });
});

describe('og-meta: buildMetaTags', () => {
    it('builds website meta for the home route', () => {
        const { title, meta } = buildMetaTags(
            makeArgs({ path: '/', isPost: false, post: null })
        );
        expect(title).toBe('The FreeBSD Guy');
        const joined = meta.join('\n');
        expect(joined).toContain('<meta property="og:site_name" content="The FreeBSD Guy">');
        expect(joined).toContain('<meta property="og:type" content="website">');
        expect(joined).toContain('og:description" content="A blog"');
        expect(joined).toContain('<meta property="og:url" content="http://localhost:3000/">');
        expect(joined).toContain('<meta property="og:image" content="http://localhost:3000/img/cover.png">');
        expect(joined).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(joined).toContain('<link rel="canonical" href="http://localhost:3000/">');
    });

    it('builds article meta for a known post', () => {
        const post = {
            slug: 'hello-world',
            title: 'Hello World',
            summary: 'A great post',
            date: '2026-10-01',
            image: '/img/hello.png'
        } as unknown as Post;
        const { title, meta } = buildMetaTags(
            makeArgs({ path: '/post/hello-world', isPost: true, post })
        );
        expect(title).toBe('Hello World');
        const joined = meta.join('\n');
        expect(joined).toContain('<meta property="og:type" content="article">');
        expect(joined).toContain('<meta property="og:title" content="Hello World">');
        expect(joined).toContain('og:description" content="A great post"');
        expect(joined).toContain('<meta property="article:published_time" content="2026-10-01">');
        expect(joined).toContain('<meta property="og:image" content="http://localhost:3000/img/hello.png">');
        expect(joined).toContain('<meta name="twitter:image" content="http://localhost:3000/img/hello.png">');
        expect(joined).toContain('<meta property="og:url" content="http://localhost:3000/post/hello-world">');
    });

    it('escapes a malicious title and summary', () => {
        const post = {
            slug: 'x',
            title: '<script>alert(1)</script>',
            summary: 'a "quoted" & <b>bold</b> summary',
            date: '2026-10-01'
        } as unknown as Post;
        const { meta } = buildMetaTags(
            makeArgs({ path: '/post/x', isPost: true, post })
        );
        const joined = meta.join('\n');
        expect(joined).not.toContain('og:title" content="<script>');
        expect(joined).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(joined).toContain('og:description" content="a &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt; summary"');
    });

    it('falls back to the site share image when a post has no image', () => {
        const post = {
            slug: 'nimg',
            title: 'T',
            summary: 's',
            date: '2026-10-01'
        } as unknown as Post;
        const { meta } = buildMetaTags(
            makeArgs({ path: '/post/nimg', isPost: true, post })
        );
        const joined = meta.join('\n');
        expect(joined).toContain('<meta property="og:image" content="http://localhost:3000/img/cover.png">');
    });
});

describe('og-meta: injectMeta', () => {
    it('injects meta into <head> and replaces the <title>', () => {
        const out = injectMeta(INDEX_HTML, {
            title: 'Injected Title',
            meta: ['<meta property="og:type" content="website">']
        });
        expect(out).toContain('<head>\n    <meta charset="utf-8" />\n    <title>Injected Title</title>');
        expect(out).toContain('<meta property="og:type" content="website">');
        expect(out).not.toContain('OLD SITE TITLE');
    });

    it('adds a <head> when the document has none', () => {
        const out = injectMeta('<html><body>hi</body></html>', {
            title: 'T',
            meta: ['<meta name="x" content="y">']
        });
        expect(out).toContain('<head>');
        expect(out).toContain('<meta name="x" content="y">');
    });
});

// ---------------------------------------------------------------------------
// Integration: the real Express SPA catch-all injects per-request meta.
// ---------------------------------------------------------------------------
describe('og-meta integration (SPA catch-all)', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const distDir = path.join(repoRoot, 'dist');
    const indexPath = path.join(distDir, 'index.html');
    let tmpConfig: string;
    let tmpPosts: string;
    let savedConfigDir: string | undefined;
    let app: any;
    let createdDist = false;
    let savedIndex: string | null = null;

    beforeAll(async () => {
        savedConfigDir = process.env.CONFIG_DIR;
        tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-ogmeta-cfg-'));
        tmpPosts = path.join(tmpConfig, 'posts');
        fs.mkdirSync(tmpPosts, { recursive: true });
        fs.mkdirSync(path.join(tmpConfig, 'themes'), { recursive: true });
        // Minimal theme file so theme lookups do not blow up.
        fs.writeFileSync(
            path.join(tmpConfig, 'themes', 'dark.json'),
            JSON.stringify({ '--bg': '#111827', '--text': '#f3f4f6', '--primary': '#3b82f6', '--secondary': '#1f2937', '--accent': '#3a297a' })
        );
        fs.writeFileSync(
            path.join(tmpConfig, 'config.json'),
            JSON.stringify({
                postsDir: './posts',
                themeDir: './themes',
                currentTheme: 'dark',
                siteName: 'The FreeBSD Guy',
                siteTagline: 'A personal blog',
                shareImage: '/img/cover.png',
                siteUrl: '',
                appearance: { themeMode: 'dark' },
                security: {},
                service: { port: 5173 }
            })
        );
        // dist must exist BEFORE the app registers routes.
        // Never destroy a real build: remember what was there and put it back.
        createdDist = !fs.existsSync(distDir);
        savedIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(indexPath, INDEX_HTML);

        process.env.CONFIG_DIR = tmpConfig;
        ({ app } = await import('../server/index.ts'));
    });

    afterEach(() => {
        try { fs.rmSync(path.join(tmpPosts, 'hello-world.md'), { force: true }); } catch { /* ignore */ }
    });

    afterAll(() => {
        if (savedConfigDir !== undefined) process.env.CONFIG_DIR = savedConfigDir;
        try {
            if (createdDist) fs.rmSync(distDir, { recursive: true, force: true });
            else if (savedIndex !== null) fs.writeFileSync(indexPath, savedIndex);
        } catch { /* ignore */ }
        try { fs.rmSync(tmpConfig, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('injects article meta for /post/:slug and reflects a summary edit (no cache)', async () => {
        const postPath = path.join(tmpPosts, 'hello-world.md');
        const write = (summary: string, extra = '') =>
            fs.writeFileSync(postPath, `---\ntitle: Hello World\nsummary: ${summary}\ndate: '2026-10-01'\n${extra}---\nBody`);

        write('"First & <post> post *text*"', 'image: /img/cover.png\n');

        const res = await request(app).get('/post/hello-world').set('User-Agent', DISCORD_UA);
        expect(res.status).toBe(200);
        const body = res.text;
        expect(body).not.toContain('OLD SITE TITLE');
        expect(body).toContain('<meta property="og:type" content="article">');
        expect(body).toContain('<meta property="og:title" content="Hello World">');
        // summary was markdown-stripped and HTML-escaped
        expect(body).toContain('og:description" content="First &amp; &lt;post&gt; post text"');
        expect(body).toContain('<meta property="article:published_time" content="2026-10-01">');
        expect(body).toMatch(/<meta property="og:image" content="http:\/\/[^"]+\/img\/cover\.png">/);
        expect(body).toMatch(/<meta property="og:url" content="http:\/\/[^"]+\/post\/hello-world">/);
        expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(body).toContain('<title>Hello World</title>');

        // Edit the summary on disk; next fetch must change (no caching).
        const before = res.text;
        write('New updated summary text');
        const res2 = await request(app).get('/post/hello-world').set('User-Agent', DISCORD_UA);
        expect(res2.text).toContain('og:description" content="New updated summary text"');
        expect(before).not.toContain('New updated summary text');
    });

    it('unknown slug still serves index.html with website tags, 200', async () => {
        const forged = await request(app).get('/post/hello-world').set('User-Agent', DISCORD_UA).set('X-Forwarded-Host', 'evil.example');
        expect(forged.text).not.toContain('evil.example');
        const res = await request(app).get('/post/does-not-exist-xyz').set('User-Agent', DISCORD_UA);
        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta property="og:type" content="website">');
        expect(res.text).toContain('<meta property="og:title" content="The FreeBSD Guy">');
    });

    it('review fix: HTML varies by Host, so the shell is never cached (no-store, Vary: Host)', async () => {
        const res = await request(app).get('/').set('User-Agent', DISCORD_UA);
        expect(res.headers['cache-control']).toMatch(/no-store/);
        expect(String(res.headers['vary'] || '')).toMatch(/host/i);
    });

    it('GET / serves website meta (og:type website, description = siteTagline)', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta property="og:type" content="website">');
        expect(res.text).toContain('<meta property="og:title" content="The FreeBSD Guy">');
        expect(res.text).toContain('og:description" content="A personal blog"');
        expect(res.text).toContain('<title>The FreeBSD Guy</title>');
    });
});
describe('og-meta: description length', () => {
    it('caps og:description at 200 characters', () => {
        const post = { slug: 'x', title: 'X', summary: 'a'.repeat(500), date: '2026-10-01' } as unknown as Post;
        const { meta } = buildMetaTags(makeArgs({ path: '/post/x', isPost: true, post }));
        const d = meta.find(m => m.includes('og:description'))!;
        expect(d).toContain('content="' + 'a'.repeat(200) + '"');
    });
});

describe('og-meta: truncate by code point', () => {
    it('never splits a surrogate pair', () => {
        expect(truncate('ab😀cd', 3)).toBe('ab😀');
    });
});

describe('og-meta: review fix — card type follows the image', () => {
    it('uses summary card with no image, and twitter:image on home when og:image exists', () => {
        const none = buildMetaTags(makeArgs({ path: '/', isPost: false, post: null, config: { siteName: 'X', siteTagline: 't', shareImage: '' } as any })).meta.join('\n');
        expect(none).toContain('<meta name="twitter:card" content="summary">');
        expect(none).not.toContain('og:image');
        const withImg = buildMetaTags(makeArgs({ path: '/', isPost: false, post: null })).meta.join('\n');
        expect(withImg).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(withImg).toContain('<meta name="twitter:image" content="http://localhost:3000/img/cover.png">');
    });
});
