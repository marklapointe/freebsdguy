/**
 * src/lib/site-meta.ts — Track #1682 A2: first-paint site identity.
 *
 * The server injects <meta name="mdweb-site-name"> and (for a configured,
 * servable logo) <meta name="mdweb-site-logo"> into the built shell — see
 * server/lib/theme-css.ts applyThemeToShell. Navbar and the Footer read them
 * SYNCHRONOUSLY for their initial state, so neither flashes the packaged
 * "MDWeb" default / the text brand until /api/config lands.
 */

export interface SiteMeta {
    siteName: string;
    siteLogo?: string;
}

/**
 * A logo is only ever fetched through /api/getimage, which serves a plain
 * file name with no separators (no '/' or '\'), no leading dot, no '..'
 * segment and no quotes — the exact condition the route itself applies. A
 * siteLogo that fails this gets no meta anywhere: we never point the first
 * paint at a URL the endpoint would only 403 on.
 */
const PLAIN_FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function validSiteLogoName(name: unknown): string | undefined {
    if (typeof name !== 'string') return undefined;
    const t = name.trim();
    if (!t || !PLAIN_FILE_RE.test(t) || t.includes('..')) return undefined;
    return t;
}

/** Site identity from the server-injected metas; packaged default fallback. */
export function initialSiteMeta(): SiteMeta {
    try {
        const name = document.querySelector('meta[name="mdweb-site-name"]')?.getAttribute('content');
        const logo = validSiteLogoName(
            document.querySelector('meta[name="mdweb-site-logo"]')?.getAttribute('content')
        );
        return { siteName: name || 'MDWeb', siteLogo: logo };
    } catch {
        /* no DOM (tests/SSR): keep the packaged default */
        return { siteName: 'MDWeb' };
    }
}
