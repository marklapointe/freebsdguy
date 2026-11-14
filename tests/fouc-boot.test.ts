/**
 * FOUC fix (Track #1682, Mark 2026-11-05) + follow-up: theme must not flash the
 * unstyled original on first paint. Critical CSS stays, but the boot script is
 * a same-origin CLASSIC script (public/theme-boot.js) — the inline <script> was
 * dead under CSP script-src 'self'. Transitions stay off until the full theme
 * pack paints; hashed static assets get a long cache.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { clearBootingClass, CRITICAL_CSS, bootThemeSnippet, headBootHtml } from '../src/lib/theme-boot';
import { injectMeta } from '../server/lib/og-meta';

describe('theme boot (FOUC)', () => {
    it('ships critical CSS defaults for dark and light', () => {
        expect(CRITICAL_CSS).toMatch(/color-scheme:\s*dark/);
        expect(CRITICAL_CSS).toMatch(/#0e1116/);
        expect(CRITICAL_CSS).toMatch(/data-theme-mode=["']light["']/);
        expect(CRITICAL_CSS).toMatch(/#fbfaf7/);
        expect(CRITICAL_CSS).toMatch(/mdweb-booting/);
        expect(CRITICAL_CSS).toMatch(/transition:\s*none/);
    });

    it('boot script body reads localStorage themeMode and sets data-theme-mode before paint', () => {
        expect(bootThemeSnippet()).toMatch(/localStorage\.getItem\(['"]themeMode['"]\)/);
        expect(bootThemeSnippet()).toMatch(/data-theme-mode/);
        expect(bootThemeSnippet()).toMatch(/mdweb-booting/);
        expect(bootThemeSnippet()).not.toMatch(/setProperty\(['"]--bg['"]/);
    });

    it('index.html ships the critical style + a same-origin classic boot script (no inline script)', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
        expect(html).toContain(`<style id="mdweb-critical">${CRITICAL_CSS}</style>`);
        // CSP is script-src 'self': an inline <script> NEVER runs, so the boot
        // script must be external and classic (no async/defer).
        expect(html).toContain('<script src="/theme-boot.js"></script>');
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
        // Head order: boot script first, then the critical style; both before <body>.
        const scriptIdx = html.indexOf('<script src="/theme-boot.js">');
        const styleIdx = html.indexOf('id="mdweb-critical"');
        expect(scriptIdx).toBeGreaterThan(-1);
        expect(scriptIdx).toBeLessThan(styleIdx);
        expect(styleIdx).toBeLessThan(html.indexOf('<body'));
    });

    it('public/theme-boot.js is exactly bootThemeSnippet() (single source of truth)', () => {
        const js = fs.readFileSync(path.join(process.cwd(), 'public', 'theme-boot.js'), 'utf8').trim();
        expect(js).toBe(bootThemeSnippet().trim());
    });

    it('headBootHtml stays in sync with index.html', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
        expect(headBootHtml()).toContain(CRITICAL_CSS);
        expect(headBootHtml()).toContain('<script src="/theme-boot.js"></script>');
        expect(headBootHtml()).not.toMatch(/<script>/);
        expect(html).toContain(headBootHtml());
    });

    it('injectMeta keeps critical style and can inject pack-critical vars', () => {
        const shell = `<!doctype html><html><head>
<title>Blog</title>
<style id="mdweb-critical">html{background:#0e1116}</style>
</head><body><div id="root"></div></body></html>`;
        const out = injectMeta(shell, {
            title: 'T',
            meta: ['<meta property="og:title" content="T" />'],
            criticalVars: { '--bg': '#111418', '--text': '#eee' },
        });
        expect(out).toMatch(/id="mdweb-critical"/);
        expect(out).toMatch(/--bg:\s*#111418/);
        expect(out).toMatch(/og:title/);
    });

    it('clearBootingClass removes mdweb-booting after theme paint', async () => {
        document.documentElement.classList.add('mdweb-booting');
        clearBootingClass();
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        expect(document.documentElement.classList.contains('mdweb-booting')).toBe(false);
    });
});

describe('static asset cache headers', () => {
    it('register-routes sets long-cache for hashed assets', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'server/register-routes.ts'), 'utf8');
        expect(src).toMatch(/max-age=31536000/);
        expect(src).toMatch(/immutable/);
        expect(src).toMatch(/setHeaders/);
    });
});
