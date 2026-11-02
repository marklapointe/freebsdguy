/**
 * server/lib/og-meta.ts
 *
 * Server-side Open Graph / Twitter card rendering for the SPA catch-all.
 *
 * The SPA is a single-page React app, so social networks and link previews
 * (Discord, Slack, Twitter, …) only see index.html. This module turns that
 * static shell into a per-request prerender: it resolves the post for a
 * /post/:slug path (or falls back to website metadata for the home route),
 * builds a flat list of <meta>/<link> tags, escapes everything, and injects
 * them into the HTML shell.
 *
 * Everything here is intentionally side-effect free and pure so it can be
 * unit tested without a request / file system.
 */

import type { Post } from './posts.ts';

export interface MetaConfig {
    siteName: string;
    /** Optional secondary tagline shown as the website description. */
    siteTagline?: string;
    /** Default share image used for the home page and as a post fallback. */
    shareImage?: string;
}

export interface MetaArgs {
    config: MetaConfig;
    /** Origin of the request, already resolved (http(s)://host[:port]). */
    origin: string;
    /** Request path, e.g. '/' or '/post/hello-world'. */
    path: string;
    /** Post being viewed, or null for the home page. */
    post: Post | null;
    /** True when the request path resolves to a post. */
    isPost: boolean;
}

/** Ordered list of HTML meta/link tag strings. */
export interface MetaTags {
    title: string;
    meta: string[];
}

// ---------------------------------------------------------------------------
// Escaping / sanitising helpers
// ---------------------------------------------------------------------------

/**
 * HTML-escape a string so it is safe inside a `content="…"` or attribute
 * value. Ampersand is escaped FIRST to avoid double-escaping the output of
 * the later substitutions.
 */
export function htmlEscape(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Strip Markdown-ish markup (bold/italic/code fences, link and image
 * syntax) and collapse whitespace (including newlines) into single spaces.
 * Angle brackets and quotes are preserved: callers HTML-escape afterwards.
 */
export function stripMarkdownish(text: unknown): string {
    let s = String(text ?? '');
    // Images ![alt](url) and links [text](url) -> keep the visible text only.
    s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Emphasis / code fences.
    s = s.replace(/(\*\*|__|\*|_|`)/g, '');
    // Collapse runs of whitespace (including \n) into a single space.
    s = s.replace(/\s+/g, ' ');
    return s.trim();
}

/** Trim to `max` characters, adding no ellipsis (callers build descriptions). */
export function truncate(text: unknown, max: number): string {
    const s = String(text ?? '');
    const cps = [...s]; // code points: never split an emoji or surrogate pair
    return cps.length > max ? cps.slice(0, max).join('') : s;
}

/**
 * Turn a possibly-relative URL into an absolute one for the given origin.
 * Absolute URLs (http(s)://, //host, data:) are returned untouched.
 */
export function resolveShareUrl(url: string, origin: string): string {
    if (!url) return url;
    // Absolute / protocol-relative / data: — already safe to ship verbatim.
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return url;

    if (!origin) {
        return url.startsWith('/') ? url : `/${url}`;
    }
    const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ---------------------------------------------------------------------------
// Meta tag builder
// ---------------------------------------------------------------------------

const TWITTER_CARD = 'summary_large_image';

function descriptionContent(post: Post | null, isPost: boolean, config: MetaConfig): string {
    const source = (isPost && post && post.summary) || config.siteTagline || '';
    return htmlEscape(truncate(stripMarkdownish(source), 200));
}

function imageContent(args: MetaArgs): string {
    const isPost = args.isPost && !!args.post;
    const rawImage = isPost
        ? (args.post!.image as string | undefined) || args.config.shareImage
        : args.config.shareImage;
    // Post front matter is author-controlled: only http(s) absolute or site-relative paths.
    const safe = (u: unknown): string =>
        typeof u === 'string' && (/^https?:\/\/[^/]/i.test(u) || (/^\/(?!\/)/.test(u)) || /^[A-Za-z0-9._-][^:]*$/.test(u)) ? u : '';
    const chosen = safe(rawImage) || safe(args.config.shareImage);
    return chosen ? htmlEscape(resolveShareUrl(chosen, args.origin)) : '';
}

/**
 * Build the per-request meta tag set. Returns the display title plus a flat
 * array of HTML `<meta>`/`<link>` strings (already escaped).
 */
export function buildMetaTags(args: MetaArgs): MetaTags {
    const { config } = args;
    const isPost = args.isPost && !!args.post;
    const post = args.post;

    const ogUrl = resolveShareUrl(args.path || '/', args.origin);
    const contentImage = imageContent(args);

    // A page must always have a title to display in previews.
    const title = isPost ? (post?.title || ogUrl) : config.siteName || ogUrl;

    const tags: string[] = [];
    tags.push(`<meta property="og:site_name" content="${htmlEscape(config.siteName || '')}">`);
    tags.push(`<meta property="og:url" content="${htmlEscape(ogUrl)}">`);

    if (isPost) {
        const postTitle = htmlEscape(post!.title || '');
        tags.push('<meta property="og:type" content="article">');
        tags.push(`<meta property="og:title" content="${postTitle}">`);
        tags.push(`<meta property="og:description" content="${descriptionContent(post, true, config)}">`);
        if (post?.date) {
            tags.push(`<meta property="article:published_time" content="${htmlEscape(post.date)}">`);
        }
        if (contentImage) {
            tags.push(`<meta property="og:image" content="${contentImage}">`);
            tags.push(`<meta name="twitter:image" content="${contentImage}">`);
        }
    } else {
        tags.push('<meta property="og:type" content="website">');
        tags.push(`<meta property="og:title" content="${htmlEscape(title)}">`);
        tags.push(`<meta property="og:description" content="${descriptionContent(post, false, config)}">`);
        if (contentImage) {
            tags.push(`<meta property="og:image" content="${contentImage}">`);
            tags.push(`<meta name="twitter:image" content="${contentImage}">`);
        }
    }

    // No image: a large-image card would render empty, so fall back to "summary".
    tags.push(`<meta name="twitter:card" content="${contentImage ? TWITTER_CARD : 'summary'}">`);
    tags.push(`<meta name="twitter:title" content="${htmlEscape(isPost ? post!.title || '' : title)}">`);
    tags.push(`<meta name="twitter:description" content="${descriptionContent(post, isPost, config)}">`);
    tags.push(`<meta name="description" content="${descriptionContent(post, isPost, config)}">`);
    tags.push(`<link rel="canonical" href="${htmlEscape(ogUrl)}">`);

    return { title: htmlEscape(title), meta: tags };
}

// ---------------------------------------------------------------------------
// Injection into the SPA shell
// ---------------------------------------------------------------------------

/**
 * Inject a meta tag set into an HTML shell: replace the <title>, append the
 * meta/link tags inside <head>, and — if the document has no <head> at all —
 * synthesise one. The title (and everything already in `meta`) is assumed to
 * be HTML-escaped, so we only need to swap the text content of <title>.
 */
export function injectMeta(html: string, tags: MetaTags): string {
    const { title, meta } = tags;
    const body = typeof html === 'string' ? html : '';
    const metaHtml = meta.join('\n');

    // 1) Replace the <title>…</title> text.
    let out = body.replace(
        /<title[^>]*>[\s\S]*?<\/title>/i,
        () => `<title>${title}</title>`
    );

    // 2) Make sure there is a <title> element (defensive: some shells omit it).
    if (!/<title[^>]*>[\s\S]*<\/title>/i.test(out)) {
        out = out.replace(/<(?:head|body|html[^>]*)>/i, (m) => `${m}\n<title>${title}</title>`);
    }

    // 3) Insert meta tags into <head>.
    if (/<head[\s>]/i.test(out)) {
        out = out.replace(/<\/head>/i, () => `${metaHtml}\n</head>`);
    } else {
        // No <head>: synthesise one right before <body> (or the document top).
        out = out.replace(
            /<body([\s>])/i,
            (_m, c) => `<head>\n${metaHtml}\n</head>\n<body${c}`
        );
        if (!/<body[\s>]/i.test(out)) {
            out = `<head>\n${metaHtml}\n</head>\n${out}`;
        }
    }

    return out;
}