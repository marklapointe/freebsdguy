/**
 * src/lib/site-meta.ts — Track #1682 A2: first-paint site identity.
 *
 * The server injects <meta name="mdweb-site-name"> and (for a configured,
 * servable logo) <meta name="mdweb-site-logo"> into the built shell — see
 * server/lib/theme-css.ts applyThemeToShell. Navbar and the Footer read them
 * SYNCHRONOUSLY for their initial state, so neither flashes the packaged
 * "MDWeb" default / the text brand until /api/config lands.
 *
 * validSiteLogoName lives in server/lib/site-meta.ts so the packaged
 * server can import it (the port ships server/ + dist/, not src/).
 */

export { validSiteLogoName } from '../../server/lib/site-meta';
import { validSiteLogoName } from '../../server/lib/site-meta';

export interface SiteMeta {
    siteName: string;
    siteLogo?: string;
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
