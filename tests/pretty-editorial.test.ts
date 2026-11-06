/**
 * Editorial default theme (Track #1682 "pretty" pass): typography, measure,
 * code/blockquote/table styling, per-site accent and theme upgrade delivery.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { contrastRatio, ensureRuntimeThemeCatalog } from '../server/lib/themes';
import { siteAccent, SITE_ACCENT_BG } from '../src/lib/site-accent';

/** dark/light.json byte-for-byte as shipped in 1.1.0_3/1.1.0_4. */
const SHIPPED_1_1_0_4: Record<string, string> = {"dark": "{\n  \"--primary\": \"#3b82f6\",\n  \"--secondary\": \"#1f2937\",\n  \"--accent\": \"#a78bfa\",\n  \"--text\": \"#f3f4f6\",\n  \"--bg\": \"#111827\",\n  \"--border\": \"#374151\",\n  \"--hover\": \"#1f2937\",\n  \"--site-name-color\": \"#60a5fa\",\n  \"mdEditorTheme\": \"dark\"\n}\n", "light": "{\n  \"--primary\": \"#2563eb\",\n  \"--secondary\": \"#f3f4f6\",\n  \"--accent\": \"#b91c1c\",\n  \"--text\": \"#111827\",\n  \"--bg\": \"#ffffff\",\n  \"--border\": \"#e5e7eb\",\n  \"--hover\": \"#f3f4f6\",\n  \"--site-name-color\": \"#2563eb\",\n  \"mdEditorTheme\": \"light\"\n}\n"};

let css = '';
beforeAll(() => { css = fs.readFileSync(path.resolve('src/index.css'), 'utf8'); });
const rule = (sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
};

describe('editorial typography', () => {
    it('body is a readable sans with generous line-height; headings are a serif', () => {
        const body = rule('.editorial body');
        expect(body).toMatch(/font-family:[^;]*(system-ui|sans-serif)/);
        expect(body).not.toMatch(/monospace/);
        expect(body).toMatch(/line-height:\s*1\.(6|65|7|75)/);
        expect(rule('.editorial .article-title, .editorial .card-title')).toMatch(/font-family:[^;]*serif/);
    });
    it('article body measure is between 65 and 75ch', () => {
        const m = rule('.editorial .article-body').match(/max-width:\s*(\d+)ch/);
        expect(m).toBeTruthy();
        expect(Number(m![1])).toBeGreaterThanOrEqual(65);
        expect(Number(m![1])).toBeLessThanOrEqual(75);
    });
    it('code blocks are a dark monospace panel that scrolls inside itself', () => {
        const pre = rule('.editorial .article-body pre');
        expect(pre).toMatch(/overflow-x:\s*auto/);
        expect(pre).toMatch(/background(-color)?:\s*#0[0-9a-f]{5}/i);
        expect(rule('.editorial .article-body code')).toMatch(/font-family:[^;]*monospace/);
    });
    it('blockquotes, tables and images are styled', () => {
        expect(rule('.editorial .article-body blockquote')).toMatch(/border-(left|inline-start)/);
        expect(rule('.editorial .article-body table')).toMatch(/overflow-x:\s*auto/);
        expect(rule('.editorial .article-body img')).toMatch(/border-radius/);
    });
    it('editorial scope applies to the shipped default packs only', () => {
        expect(css).toMatch(/html\[data-theme="dark"\]/);
        expect(css).toMatch(/html\[data-theme="light"\]/);
    });
});

describe('per-site accent', () => {
    it('is deterministic and different for the two blogs', () => {
        expect(siteAccent('REVYNET')).toEqual(siteAccent('REVYNET'));
        expect(siteAccent('REVYNET').dark).not.toBe(siteAccent('The FreeBSD Guy').dark);
    });
    it('meets WCAG AA on the dark and light page backgrounds for any name', () => {
        for (const name of ['REVYNET', 'The FreeBSD Guy', 'MDWeb', 'x', 'Another Site 123']) {
            const a = siteAccent(name);
            expect(contrastRatio(a.dark, SITE_ACCENT_BG.dark), name).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(a.light, SITE_ACCENT_BG.light), name).toBeGreaterThanOrEqual(4.5);
        }
    });
});

describe('theme upgrade delivers the editorial palette', () => {
    it('refreshes an unmodified 1.1.0_4 dark.json/light.json', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-pretty-'));
        for (const id of ['dark', 'light']) {
            fs.writeFileSync(path.join(dir, `${id}.json`), SHIPPED_1_1_0_4[id]);
        }
        const r = ensureRuntimeThemeCatalog(dir);
        expect(r.refreshed).toEqual(expect.arrayContaining(['dark', 'light']));
        expect(fs.readFileSync(path.join(dir, 'dark.json'), 'utf8')).toBe(fs.readFileSync('server/themes/dark.json', 'utf8'));
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('muted text contrast per mode', () => {
    it('muted text meets AA on both page backgrounds', () => {
        const pick = (sel: string) => (rule(sel).match(/--muted:\s*(#[0-9a-f]{6})/i) || [])[1];
        const dark = pick('html[data-theme][data-theme-mode="dark"]');
        const light = pick('html[data-theme][data-theme-mode="light"]');
        expect(dark && light).toBeTruthy();
        expect(contrastRatio(dark!, SITE_ACCENT_BG.dark)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(light!, SITE_ACCENT_BG.light)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('review fixes: code header and narrow header', () => {
    it('code block header sets a light foreground on its dark panel', () => {
        expect(rule('.editorial .article-body .md-editor-code .md-editor-code-head')).toMatch(/color:\s*#c9d1d9/i);
    });
    it('site title truncates rather than overflowing on phones', () => {
        expect(css).toMatch(/\.editorial \.site-brand\s*\{[^}]*min-width:\s*0/);
        expect(css).toMatch(/text-overflow:\s*ellipsis/);
    });
    it('every palette accent meets AA in both modes', async () => {
        const { SITE_ACCENTS } = await import('../src/lib/site-accent');
        for (const a of SITE_ACCENTS) {
            expect(contrastRatio(a.dark, SITE_ACCENT_BG.dark), a.name).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(a.light, SITE_ACCENT_BG.light), a.name).toBeGreaterThanOrEqual(4.5);
        }
    });
});

describe('header brand alignment', () => {
    it('brand stays left-aligned when it grows to fill the header', () => {
        expect(css).toMatch(/\.editorial \.site-header nav a\.site-brand\s*\{[^}]*justify-content:\s*flex-start/);
    });
});
