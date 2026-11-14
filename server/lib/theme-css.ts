/**
 * server/lib/theme-css.ts — Track #1682 FOUC follow-up.
 *
 * The site theme must be visible on the FIRST paint as a render-blocking
 * <link rel="stylesheet"> placed AFTER the full default bundle stylesheet —
 * never JS that paints ~1 s late, never @import, never a trimmed default.
 * Mark's rule: "The default is the default, and the theme is decoration on
 * top, and the theme may not have everything defined." So the emitted CSS
 * contains ONLY the custom properties the active pack actually defines;
 * every other variable keeps resolving from src/index.css (the default).
 *
 * Everything here is pure (no request/Response) so it is unit-testable.
 */
import crypto from 'crypto';
import { isValidThemeId, loadThemeColorsForMode } from './themes.ts';
import { htmlEscape } from './og-meta.ts';
import { siteAccent } from '../../src/lib/site-accent.ts';

/** Custom-property names we will ever write into a stylesheet. */
const VAR_NAME_RE = /^--[A-Za-z0-9_-]+$/;
/**
 * A declaration value carries structure through ';' and '}' and context
 * through '{', '<', '>' (which also covers '</'). Anything containing them
 * could break out of the rule or the CSS context and is rejected outright.
 */
const HOSTILE_VALUE_RE = /[;{}<>]/;

export interface ThemeCssOptions {
    /** Same pack rendered for light mode (via loadThemeColorsForMode); optional. */
    lightPack?: Record<string, string> | null;
    /** Per-site brand accent (src/lib/site-accent); optional. */
    accent?: { dark: string; light: string } | null;
}

/** Sorted `k:v;k:v` list of the pack's safe custom properties. */
function safeDecls(
    pack: Record<string, string> | null | undefined,
    base?: Record<string, string>
): string {
    const merged: Record<string, string> = {};
    const accept = (k: string, v: unknown): void => {
        if (VAR_NAME_RE.test(k) && typeof v === 'string' && v.trim() && !HOSTILE_VALUE_RE.test(v)) {
            merged[k] = v.trim();
        }
    };
    if (base) for (const [k, v] of Object.entries(base)) accept(k, v);
    // The pack outranks the accent extras on collision (pack wins).
    if (pack && typeof pack === 'object') {
        for (const [k, v] of Object.entries(pack)) accept(k, v);
    }
    return Object.keys(merged)
        .sort()
        .map((k) => `${k}:${merged[k]}`)
        .join(';');
}

/**
 * Build the theme stylesheet for one pack. Deterministic: keys are sorted,
 * so the same input always yields byte-identical CSS. A pack that defines
 * only `--bg` emits only `--bg` — the default stays in charge of everything
 * the theme does not define. Returns '' for nothing safe to emit.
 */
export function themeCss(pack: Record<string, string>, opts: ThemeCssOptions = {}): string {
    const accentVars =
        opts.accent && typeof opts.accent === 'object'
            ? { '--brand-dark': opts.accent.dark, '--brand-light': opts.accent.light }
            : undefined;
    const blocks: string[] = [];
    const root = safeDecls(pack, accentVars);
    if (root) blocks.push(`:root{${root}}`);
    const light = safeDecls(opts.lightPack);
    if (light) blocks.push(`html[data-theme-mode="light"]{${light}}`);
    return blocks.join('\n');
}

/** Short stable content hash used for the cache-busting ?v= and the ETag. */
export function themeCssHash(css: string): string {
    return crypto.createHash('sha256').update(css, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Theme CSS for a site: the active pack's dark palette as `:root`, its derived
 * light palette under `html[data-theme-mode="light"]` (attribute selector:
 * higher specificity, so it wins in light mode), plus the brand accent vars.
 * If the pack cannot be loaded, returns '' — the served stylesheet is EMPTY
 * and the default shows unchanged (never the old hardcoded fallback palette).
 */
export function themeCssForSite(themeDir: string, packId: string, siteName: string): string {
    const id = isValidThemeId(String(packId)) ? String(packId) : 'dark';
    const dark = loadThemeColorsForMode(themeDir, id, 'dark');
    if (!dark) return '';
    const light = loadThemeColorsForMode(themeDir, id, 'light');
    return themeCss(dark, { lightPack: light, accent: siteAccent(siteName || 'MDWeb') });
}

/** Subset of the site config the shell needs. */
export interface ShellThemeConfig {
    siteName?: string;
    currentTheme?: string;
    appearance?: { themeMode?: string | null } | null;
}

/** Replace or add attributes on the <html> start tag, preserving the rest. */
function setHtmlTagAttrs(html: string, dataAttrs: Record<string, string>, addClasses: string[]): string {
    const m = /<html\b[^>]*>/i.exec(html);
    if (!m) return html;
    let tag = m[0];
    let classes: string[] = [];
    const cm = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (cm) {
        classes = String(cm[1] ?? cm[2] ?? '').split(/\s+/).filter(Boolean);
        tag = tag.replace(cm[0], '');
    }
    for (const name of Object.keys(dataAttrs)) {
        tag = tag.replace(new RegExp(`\\s${name}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'i'), '');
    }
    for (const c of addClasses) if (c && !classes.includes(c)) classes.push(c);
    if (classes.length) tag = tag.replace(/>$/, ` class="${htmlEscape(classes.join(' '))}">`);
    for (const [name, value] of Object.entries(dataAttrs)) {
        tag = tag.replace(/>$/, ` ${name}="${htmlEscape(value)}">`);
    }
    return html.replace(m[0], tag);
}

/**
 * Make a built Vite shell theme-aware for the first paint:
 *  - <meta name="mdweb-site-name"> so the Navbar renders the real name
 *    synchronously (no "MDWeb" flash until /api/config lands);
 *  - <link rel="stylesheet" href="/theme.css?v=HASH"> IMMEDIATELY after the
 *    default bundle's <link rel="stylesheet" href="/assets/index-*.css"> —
 *    default first, theme second, both render-blocking, nothing reordered;
 *  - data-theme / data-theme-mode / data-site-accent and class="editorial"
 *    (same rule as paintTheme: dark|light packs are editorial) on <html>.
 * Falls back to just before </head> when no bundle css link exists (e.g. a
 * shell without CSS), and never duplicates the theme link.
 */
export function applyThemeToShell(html: string, themeDir: string, cfg: ShellThemeConfig): string {
    let out = typeof html === 'string' ? html : '';
    const siteName = String(cfg.siteName || 'MDWeb');
    const pack = isValidThemeId(String(cfg.currentTheme || '')) ? String(cfg.currentTheme) : 'dark';
    const mode = cfg.appearance?.themeMode === 'light' ? 'light' : 'dark';
    const accent = siteAccent(siteName);
    const css = themeCssForSite(themeDir, pack, siteName);
    const version = themeCssHash(css);
    const link = `<link rel="stylesheet" href="/theme.css?v=${version}">`;

    out = setHtmlTagAttrs(
        out,
        { 'data-theme': pack, 'data-theme-mode': mode, 'data-site-accent': accent.name },
        pack === 'dark' || pack === 'light' ? ['editorial'] : []
    );

    const metaName = '<meta name="mdweb-site-name"';
    if (!out.includes(metaName)) {
        const meta = `<meta name="mdweb-site-name" content="${htmlEscape(siteName)}">`;
        out = out.replace(/<head\b[^>]*>/i, (t) => `${t}\n${meta}`);
    }

    if (!/href=["']\/theme\.css/.test(out)) {
        // rel= may come before or after href= in the built link tag; lookaheads cover both.
        const defaultLinkRe =
            /<link\b(?=[^>]*rel=["']stylesheet["'])(?=[^>]*href=["'][^"']*\/assets\/index-[^"']+\.css["'])[^>]*>/i;
        if (defaultLinkRe.test(out)) {
            out = out.replace(defaultLinkRe, (t) => `${t}\n${link}`);
        } else if (/<\/head>/i.test(out)) {
            out = out.replace(/<\/head>/i, () => `${link}\n</head>`);
        }
    }
    return out;
}
