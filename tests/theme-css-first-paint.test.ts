/**
 * Track #1682 FOUC follow-up — the theme must be a render-blocking stylesheet
 * on the FIRST HTML, linked after the full default bundle CSS (never JS that
 * paints ~1 s late, never @import, never a trimmed default).
 *
 * Covers: server/lib/theme-css.ts (pure), GET /theme.css, and the SPA shell
 * injection in server/register-routes.ts. Mark's rule: "the default is the
 * default, and the theme is decoration on top, and the theme may not have
 * everything defined" — so a partial pack emits ONLY the vars it defines.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
    themeCss,
    themeCssHash,
    themeCssForSite,
    applyThemeToShell
} from '../server/lib/theme-css';
import { siteAccent } from '../src/lib/site-accent';

// Navbar imports the api module; mock it so no fetch happens (the point of
// this test is the SYNCHRONOUS first render from the server-injected meta).
vi.mock('../src/lib/api', () => ({
    api: { get: () => new Promise(() => {}), post: () => new Promise(() => {}) },
    getPublicConfig: () => new Promise(() => {}),
    invalidatePublicConfig: () => {},
    applyTheme: () => Promise.resolve(null),
    getEffectiveThemeMode: (m?: string) => (m === 'light' ? 'light' : 'dark'),
    getMdEditorTheme: () => 'dark',
    setAuthModeCache: () => {},
    toggleThemeMode: () => Promise.resolve('dark'),
    siteConfig: {
        load: () => new Promise(() => {}),
        refresh: () => new Promise(() => {}),
        get: () => null,
        subscribe: () => () => {}
    }
}));
import { Navbar } from '../src/components/Navbar';

// ---------------------------------------------------------------------------
// themeCss(): pure builder
// ---------------------------------------------------------------------------
describe('themeCss()', () => {
    it('emits ONLY the --* keys the pack defines (partial pack -> defaults keep applying)', () => {
        const css = themeCss({ '--bg': '#123456' });
        // Exactly one declaration: nothing may be added for keys the pack omits.
        expect(css).toBe(':root{--bg:#123456}');
        expect(css).not.toContain('--text');
        expect(css).not.toContain('--primary');
        expect(css).not.toContain('--accent');
    });

    it('ignores non-variable keys and non-string values', () => {
        const css = themeCss({
            color: 'red',
            mdEditorTheme: 'dark',
            '--ok': '#fff',
            '--num': 42 as unknown as string
        });
        expect(css).toBe(':root{--ok:#fff}');
    });

    it('is deterministic: same input byte-identical, insertion order irrelevant', () => {
        const a = themeCss({ '--c': '#ccc', '--a': '1px', '--b': '2px' });
        const b = themeCss({ '--b': '2px', '--a': '1px', '--c': '#ccc' });
        expect(a).toBe(b);
        expect(a).toBe(':root{--a:1px;--b:2px;--c:#ccc}');
        const opts = { lightPack: { '--z': '0', '--y': '1' }, accent: { dark: '#111111', light: '#eeeeee' } };
        expect(themeCss({ '--b': '2px', '--a': '1px' }, opts)).toBe(
            themeCss({ '--a': '1px', '--b': '2px' }, opts)
        );
    });

    it('rejects hostile values (; { } < > and </) and hostile keys', () => {
        const hostile = [
            'red;background:url(http://x)',
            '}body{display:none',
            '{oops',
            '<script>alert(1)</script>',
            '</style><script>alert(1)</script>'
        ];
        for (const v of hostile) {
            const css = themeCss({ '--x': v });
            expect(css).toBe('');
        }
        // A key that is not a custom property never reaches the output.
        expect(themeCss({ '-weird-': '1px', '--': '1px' } as Record<string, string>)).toBe('');
    });

    it('light pack -> html[data-theme-mode="light"] override block', () => {
        const css = themeCss({ '--bg': '#000000' }, { lightPack: { '--bg': '#ffffff' } });
        expect(css).toBe(':root{--bg:#000000}\nhtml[data-theme-mode="light"]{--bg:#ffffff}');
    });

    it('accent contributes --brand-dark/--brand-light; the pack may override them', () => {
        const css = themeCss({}, { accent: { dark: '#111111', light: '#eeeeee' } });
        expect(css).toBe(':root{--brand-dark:#111111;--brand-light:#eeeeee}');
        const overridden = themeCss({ '--brand-dark': '#123456' }, { accent: { dark: '#111111', light: '#eeeeee' } });
        expect(overridden).toBe(':root{--brand-dark:#123456;--brand-light:#eeeeee}');
    });

    it('empty pack -> empty stylesheet (never a fallback palette)', () => {
        expect(themeCss({})).toBe('');
    });
});

describe('themeCssHash()', () => {
    it('is 8 lowercase hex chars and stable', () => {
        expect(themeCssHash(':root{--bg:#000}')).toMatch(/^[0-9a-f]{8}$/);
        expect(themeCssHash('a')).toBe(themeCssHash('a'));
        expect(themeCssHash('a')).not.toBe(themeCssHash('b'));
    });
});

describe('themeCssForSite()', () => {
    it('missing pack -> empty CSS, not the old hardcoded fallback palette', () => {
        const css = themeCssForSite('', 'no-such-pack-xyz', 'Any Site');
        expect(css).toBe('');
    });

    it('resolves the shipped dark pack with a light override and brand vars', () => {
        const css = themeCssForSite('', 'dark', 'The FreeBSD Guy');
        expect(css).toContain(':root{');
        expect(css).toContain('--bg:#0e1116');
        expect(css).toContain('html[data-theme-mode="light"]{');
        expect(css).toContain(`--brand-dark:${siteAccent('The FreeBSD Guy').dark}`);
    });
});

// ---------------------------------------------------------------------------
// applyThemeToShell(): pure HTML transform
// ---------------------------------------------------------------------------
const VITE_SHELL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Blog</title>
  <script src="/theme-boot.js"></script>
  <style id="mdweb-critical">html{color-scheme:dark}</style>
  <script type="module" crossorigin src="/assets/index-DEADBEEF.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-DEADBEEF.css">
</head>
<body class="bg-[var(--bg)] text-[var(--text)]">
<div id="root"></div>
</body>
</html>`;

describe('applyThemeToShell()', () => {
    const cfg = { siteName: 'Escape & Co <b>', currentTheme: 'dark', appearance: { themeMode: 'light' } };

    it('links /theme.css?v=<hash> IMMEDIATELY after the default bundle css link, inside <head>', () => {
        const out = applyThemeToShell(VITE_SHELL, '', cfg);
        expect(out).toMatch(
            /<link[^>]*\/assets\/index-[A-Za-z0-9]+\.css[^>]*>\s*<link rel="stylesheet" href="\/theme\.css\?v=[0-9a-f]{8}">/
        );
        const head = out.slice(out.indexOf('<head>'), out.indexOf('</head>'));
        expect(head).toContain('/theme.css?v=');
        expect(head.indexOf('/theme.css')).toBeGreaterThan(head.indexOf('/assets/index-DEADBEEF.css'));
    });

    it('no @import; default link is kept verbatim', () => {
        const out = applyThemeToShell(VITE_SHELL, '', cfg);
        expect(out).not.toContain('@import');
        expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/index-DEADBEEF.css">');
    });

    it('sets data-theme / data-theme-mode / data-site-accent and class="editorial" on <html> for dark|light packs', () => {
        const out = applyThemeToShell(VITE_SHELL, '', cfg);
        const tag = (/<html[^>]*>/i.exec(out) as RegExpExecArray)[0];
        expect(tag).toContain('data-theme="dark"');
        expect(tag).toContain('data-theme-mode="light"');
        expect(tag).toContain(`data-site-accent="${siteAccent(cfg.siteName).name}"`);
        expect(tag).toMatch(/class="[^"]*\beditorial\b[^"]*"/);
        // existing attrs survive
        expect(tag).toContain('lang="en"');
    });

    it('retro packs get NO editorial class, and an existing class list is preserved', () => {
        const out = applyThemeToShell(VITE_SHELL, '', { ...cfg, currentTheme: 'matrix' });
        const tag = (/<html[^>]*>/i.exec(out) as RegExpExecArray)[0];
        expect(tag).toContain('data-theme="matrix"');
        expect(tag).not.toContain('editorial');
        const shell2 = VITE_SHELL.replace('<html lang="en">', '<html lang="en" class="foo">');
        const out2 = applyThemeToShell(shell2, '', cfg);
        const tag2 = (/<html[^>]*>/i.exec(out2) as RegExpExecArray)[0];
        expect(tag2).toMatch(/class="foo editorial"/);
    });

    it('adds <meta name="mdweb-site-name"> with the escaped site name', () => {
        const out = applyThemeToShell(VITE_SHELL, '', cfg);
        expect(out).toContain('<meta name="mdweb-site-name" content="Escape &amp; Co &lt;b&gt;">');
    });

    it('is idempotent (never two theme links)', () => {
        const once = applyThemeToShell(VITE_SHELL, '', cfg);
        const twice = applyThemeToShell(once, '', cfg);
        expect((twice.match(/\/theme\.css/g) || []).length).toBe(1);
    });

    it('falls back to inserting before </head> when no default bundle link exists', () => {
        const shell = VITE_SHELL.replace(
            /\s*<link rel="stylesheet"[^>]*\/assets\/index-DEADBEEF\.css">/,
            ''
        );
        const out = applyThemeToShell(shell, '', cfg);
        const head = out.slice(out.indexOf('<head>'), out.indexOf('</head>'));
        expect(head).toContain('/theme.css?v=');
    });
});

// ---------------------------------------------------------------------------
// Navbar: synchronous site name from the server meta (no "MDWeb" flash)
// ---------------------------------------------------------------------------
describe('Navbar initial site name (no flash)', () => {
    afterEach(() => {
        cleanup();
        document
            .querySelectorAll('meta[name="mdweb-site-name"]')
            .forEach((m) => m.remove());
    });

    it('renders the server-injected site name on the first render', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'mdweb-site-name');
        meta.setAttribute('content', 'Real Site Name');
        document.head.appendChild(meta);
        const { container } = render(
            React.createElement(MemoryRouter, null, React.createElement(Navbar, { user: null, setUser: () => {} }))
        );
        // Synchronous: the correct name must be there BEFORE any config fetch resolves.
        expect(container.textContent).toContain('Real Site Name');
        expect(container.textContent).not.toContain('MDWeb');
    });

    it('falls back to MDWeb when the meta is absent (current behaviour)', () => {
        const { container } = render(
            React.createElement(MemoryRouter, null, React.createElement(Navbar, { user: null, setUser: () => {} }))
        );
        expect(container.textContent).toContain('MDWeb');
    });
});

// ---------------------------------------------------------------------------
// Integration: the real Express app — shell route + GET /theme.css
// ---------------------------------------------------------------------------
describe('server integration', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const distDir = path.join(repoRoot, 'dist');
    const indexPath = path.join(distDir, 'index.html');
    const SITE = 'Escape & Co <b>';
    let tmpConfig: string;
    let savedConfigDir: string | undefined;
    let savedIndex: string | null = null;
    let createdDist = false;
    let app: any;

    beforeAll(async () => {
        savedConfigDir = process.env.CONFIG_DIR;
        tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-themecss-'));
        fs.mkdirSync(path.join(tmpConfig, 'posts'), { recursive: true });
        const themesDir = path.join(tmpConfig, 'themes');
        fs.mkdirSync(themesDir, { recursive: true });
        // Our own complete dark editorial-ish pack: the seeder never overwrites
        // an existing file, so these exact values reach /theme.css.
        fs.writeFileSync(
            path.join(themesDir, 'dark.json'),
            JSON.stringify({
                '--primary': '#f2f4f7',
                '--secondary': '#161b22',
                '--accent': '#a5b4fc',
                '--text': '#eeeeee',
                '--bg': '#000000',
                '--border': '#262c36',
                '--hover': '#1c222b',
                '--site-name-color': '#f2f4f7',
                'mdEditorTheme': 'dark'
            })
        );
        fs.writeFileSync(
            path.join(tmpConfig, 'config.json'),
            JSON.stringify({
                postsDir: './posts',
                themeDir: './themes',
                currentTheme: 'dark',
                siteName: SITE,
                appearance: { themeMode: 'light', crtEffects: false, textGlow: false }
            })
        );
        // Fake the BUILT shell (module script before the stylesheet, like vite).
        createdDist = !fs.existsSync(distDir);
        savedIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(indexPath, VITE_SHELL);

        process.env.CONFIG_DIR = tmpConfig;
        ({ app } = await import('../server/index.ts'));
    });

    afterAll(() => {
        if (savedConfigDir !== undefined) process.env.CONFIG_DIR = savedConfigDir;
        try {
            if (createdDist) fs.rmSync(distDir, { recursive: true, force: true });
            else if (savedIndex !== null) fs.writeFileSync(indexPath, savedIndex);
        } catch { /* ignore */ }
        try { fs.rmSync(tmpConfig, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('GET / serves the theme link after the default css and the server-side theme attrs', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        const html = res.text;
        expect(html).toMatch(
            /<link[^>]*\/assets\/index-DEADBEEF\.css[^>]*>\s*<link rel="stylesheet" href="\/theme\.css\?v=[0-9a-f]{8}">/
        );
        const headStart = html.indexOf('<head>');
        const headEnd = html.indexOf('</head>');
        expect(headStart).toBeGreaterThan(-1);
        const linkIdx = html.indexOf('/theme.css');
        expect(linkIdx).toBeGreaterThan(headStart);
        expect(linkIdx).toBeLessThan(headEnd);
        expect(html).not.toMatch(/@import/);
        // No inline <script> may survive the CSP (script-src 'self'): every script has src.
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
        const tag = (/<html[^>]*>/i.exec(html) as RegExpExecArray)[0];
        expect(tag).toContain('data-theme="dark"');
        expect(tag).toContain('data-theme-mode="light"');
        expect(tag).toContain(`data-site-accent="${siteAccent(SITE).name}"`);
        expect(tag).toMatch(/class="[^"]*\beditorial\b[^"]*"/);
        expect(html).toContain('<meta name="mdweb-site-name" content="Escape &amp; Co &lt;b&gt;">');
    });

    it('GET /theme.css: text/css, no-cache + ETag without v; immutable with a matching v', async () => {
        const res = await request(app).get('/theme.css');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/css');
        expect(res.headers['content-type']).toContain('charset=utf-8');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['etag']).toMatch(/^"[0-9a-f]{8}"$/);
        expect(res.text).toContain(':root{');
        expect(res.text).toContain('--bg:#000000');
        expect(res.text).toContain('--text:#eeeeee');
        expect(res.text).toContain('html[data-theme-mode="light"]{');
        expect(res.text).toContain(`--brand-dark:${siteAccent(SITE).dark}`);

        const v = String(res.headers['etag']).replace(/"/g, '');
        const hit = await request(app).get(`/theme.css?v=${v}`);
        expect(hit.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(hit.text).toBe(res.text);

        const miss = await request(app).get('/theme.css?v=deadbeef');
        expect(miss.headers['cache-control']).toBe('no-cache');
        expect(miss.headers['etag']).toBe(res.headers['etag']);
    });

    it('the ?v= in the served shell matches the current /theme.css hash (immutable hits)', async () => {
        const shell = await request(app).get('/');
        const m = /\/theme\.css\?v=([0-9a-f]{8})/.exec(shell.text);
        expect(m).not.toBeNull();
        const hit = await request(app).get(`/theme.css?v=${m![1]}`);
        expect(hit.headers['cache-control']).toContain('immutable');
    });

    it('missing pack -> /theme.css serves an EMPTY stylesheet (default shows unchanged)', async () => {
        const tmpConfig2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-themecss-2-'));
        fs.mkdirSync(path.join(tmpConfig2, 'posts'), { recursive: true });
        fs.mkdirSync(path.join(tmpConfig2, 'themes'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpConfig2, 'config.json'),
            JSON.stringify({
                postsDir: './posts',
                themeDir: './themes',
                currentTheme: 'no-such-pack-xyz',
                siteName: 'NoPack Site'
            })
        );
        process.env.CONFIG_DIR = tmpConfig2;
        try {
            vi.resetModules();
            const mod = await import('../server/index.ts');
            const res = await request(mod.app).get('/theme.css');
            expect(res.status).toBe(200);
            expect(res.text).toBe('');
            expect(res.headers['content-type']).toContain('text/css');
        } finally {
            process.env.CONFIG_DIR = tmpConfig;
            fs.rmSync(tmpConfig2, { recursive: true, force: true });
        }
    });
});
