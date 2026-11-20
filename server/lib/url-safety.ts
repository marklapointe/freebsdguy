/**
 * URL canonicalization and scheme checks, shared by the server (write-time post
 * content rules) and the browser (render-time sanitizer), so both use the exact
 * same entity table, invisible-character stripping and data-image allow-list.
 *
 * Pure TypeScript: no Node builtins, so Vite, the browser and jsdom can import it.
 */

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]*$/;

const NAMED_ENTITIES: Record<string, string> = {
    colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', amp: '&', quot: '"',
    apos: "'", lt: '<', gt: '>', sol: '/', num: '#', semi: ';', comma: ',', period: '.',
    excl: '!', quest: '?', equals: '=', plus: '+', percnt: '%', lsqb: '[', rsqb: ']',
    lbrack: '[', rbrack: ']', bsol: '\\', nbsp: ' '
};

function decodeEntities(input: string): string {
    return input
        .replace(/&#x([0-9a-f]{1,8});?/gi, (m, h) => fromCode(parseInt(h, 16), m))
        .replace(/&#([0-9]{1,10});?/g, (m, d) => fromCode(parseInt(d, 10), m))
        .replace(/&([a-z][a-z0-9]*);?/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function fromCode(code: number, fallback: string): string {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
    try {
        return String.fromCodePoint(code);
    } catch {
        return fallback;
    }
}

function percentDecode(input: string): string {
    try {
        return decodeURIComponent(input);
    } catch {
        return input.replace(/%([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    }
}

/** Drop backslashes, whitespace, control and invisible characters (a browser ignores them in a scheme). */
function stripInvisible(v: string): string {
    let out = '';
    for (const ch of v) {
        const c = ch.codePointAt(0) as number;
        const drop =
            c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0x5c || c === 0x1680 ||
            (c >= 0x2000 && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0x202f ||
            c === 0x205f || c === 0x3000 || c === 0xfeff;
        if (!drop) out += ch;
    }
    return out;
}

/**
 * Reduce a URL to the form a browser would act on: entities and percent
 * escapes decoded (repeatedly, so double encoding is caught), backslashes,
 * whitespace and control characters removed.
 */
export function normalizeUrl(raw: string): string {
    let v = raw;
    for (let i = 0; i < 4; i++) {
        const next = percentDecode(decodeEntities(v));
        if (next === v) break;
        v = next;
    }
    return stripInvisible(v).toLowerCase();
}

/** Whether a URL may not be used in a link (or, with `image`, an image source). */
export function isDangerousUrl(raw: string, image = false): boolean {
    const url = normalizeUrl(raw);
    const m = /^([a-z][a-z0-9+.-]*):/.exec(url);
    if (!m) return false; // relative path, fragment, query: same origin
    if (ALLOWED_SCHEMES.has(m[1])) return false;
    if (image && m[1] === 'data' && SAFE_DATA_IMAGE.test(url)) return false;
    return true;
}

/** Whether a URL may be used in a link (or, with `image`, an image source). */
export function isSafeUrl(raw: string, image = false): boolean {
    return !isDangerousUrl(raw, image);
}
