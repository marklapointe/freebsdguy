/**
 * server/lib/site-meta.ts — Track #1682. Pure site-identity helpers the
 * packaged server can import (the port ships server/ + dist/, not src/).
 *
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
