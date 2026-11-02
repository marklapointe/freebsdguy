/**
 * Per-site accent for the editorial default theme. Each site gets a distinct,
 * deterministic accent picked from a curated palette by hashing its name, so two
 * blogs on the same package look like two brands with no config change. Every
 * pair meets WCAG AA on the editorial page backgrounds (tests/pretty-editorial).
 */
export const SITE_ACCENT_BG = { dark: '#0e1116', light: '#fbfaf7' } as const;

export type SiteAccent = { name: string; dark: string; light: string };

export const SITE_ACCENTS: readonly SiteAccent[] = [
    { name: 'crimson', dark: '#f87171', light: '#b91c1c' },
    { name: 'teal', dark: '#2dd4bf', light: '#0f766e' },
    { name: 'indigo', dark: '#a5b4fc', light: '#4338ca' },
    { name: 'amber', dark: '#fbbf24', light: '#92400e' },
    { name: 'violet', dark: '#c4b5fd', light: '#6d28d9' },
    { name: 'sky', dark: '#7dd3fc', light: '#0369a1' },
    { name: 'rose', dark: '#fda4af', light: '#be123c' },
    { name: 'emerald', dark: '#6ee7b7', light: '#047857' }
];

/** FNV-1a over UTF-16 code units: stable across browsers and Node. */
function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export function siteAccent(siteName: string): SiteAccent {
    const key = (siteName || 'MDWeb').trim().toLowerCase();
    return SITE_ACCENTS[fnv1a(key) % SITE_ACCENTS.length];
}

/** Publish the accent as CSS variables the editorial stylesheet reads. */
export function applySiteAccent(siteName: string, root: HTMLElement = document.documentElement): void {
    const a = siteAccent(siteName);
    root.style.setProperty('--brand-dark', a.dark);
    root.style.setProperty('--brand-light', a.light);
    root.setAttribute('data-site-accent', a.name);
}
