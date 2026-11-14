/**
 * Per-site accent for the editorial default theme. Pure helpers live in
 * server/lib/site-accent.ts so the packaged server can import them
 * (the port ships server/ + dist/, not src/).
 */
export {
    SITE_ACCENT_BG,
    SITE_ACCENTS,
    siteAccent
} from '../../server/lib/site-accent';
export type { SiteAccent } from '../../server/lib/site-accent';

import { siteAccent } from '../../server/lib/site-accent';

/** Publish the accent as CSS variables the editorial stylesheet reads. */
export function applySiteAccent(siteName: string, root: HTMLElement = document.documentElement): void {
    const a = siteAccent(siteName);
    root.style.setProperty('--brand-dark', a.dark);
    root.style.setProperty('--brand-light', a.light);
    root.setAttribute('data-site-accent', a.name);
}
