/**
 * Render-time hardening for Markdown output (P0 D1).
 *
 * The server refuses dangerous content at write time and the CSP blocks inline
 * script, but neither may be the only defence: a post that reached disk by
 * another route (an edit on the host, an older version) must not run in a
 * reader's browser even without a CSP. So the HTML that markdown-it produces
 * goes through this allow-list before it reaches the DOM.
 *
 * The HTML is parsed with DOMParser into an inert document (no script runs, no
 * resource loads), walked, and serialised again:
 *   - an element that is not on the allow-list is dropped with its children for
 *     script-like elements (script, style, iframe, object, embed, form, base,
 *     meta, link, template, ...) and unwrapped (children kept) otherwise;
 *   - an attribute that is not on the allow-list is dropped, so every on*
 *     handler and srcdoc goes;
 *   - href/src/xlink:href/poster/action survive only with an http, https,
 *     mailto, relative or fragment URL (an image src may also be a small
 *     data:image);
 *   - style survives without url(), expression(), @import or behavior.
 * Task-list checkboxes (<input type="checkbox" checked disabled>) are kept; any
 * other <input> is dropped. URL checks come from server/lib/url-safety.ts, the
 * same module the write-time filter uses.
 * highlight.js (span.hljs-*), KaTeX (span/math/svg) and the Mermaid
 * placeholder (div/p with classes) use only what is on the list.
 */

import { isSafeUrl, normalizeUrl } from '../../server/lib/url-safety';

export { isSafeUrl };

const DROP_WITH_CHILDREN = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form',
    'base', 'meta', 'link', 'template', 'noscript', 'title', 'head', 'textarea', 'select',
    'option', 'button', 'audio', 'video', 'source', 'track', 'canvas', 'dialog',
    'foreignobject', 'animate', 'set', 'animatetransform', 'animatemotion', 'image',
    'math-script'
]);

const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd',
    'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'mark', 'ol', 'p', 'pre', 'q',
    's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'wbr', 'article', 'aside',
    'header', 'footer', 'nav', 'main', 'center', 'font', 'big', 'tt', 'strike',
    // KaTeX MathML
    'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msup', 'msub',
    'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr',
    'mtd', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'annotation',
    // KaTeX and editor icons (inline SVG)
    'svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'use',
    'defs', 'lineargradient', 'stop', 'clippath', 'text', 'tspan'
]);

const ALLOWED_ATTRS = new Set([
    'class', 'id', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'align', 'valign',
    'lang', 'dir', 'role', 'open', 'start', 'reversed', 'type', 'scope', 'headers', 'span',
    'href', 'src', 'target', 'rel', 'style', 'loading', 'decoding', 'srcset', 'sizes',
    'cellspacing', 'cellpadding', 'border', 'color', 'face', 'size', 'checked', 'disabled',
    // SVG / MathML presentation
    'viewbox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'preserveaspectratio', 'focusable', 'd',
    'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity',
    'transform', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'dx',
    'dy', 'offset', 'stop-color', 'clip-path', 'text-anchor', 'mathvariant', 'mathsize',
    'displaystyle', 'scriptlevel', 'columnalign', 'rowspacing', 'columnspacing', 'fence',
    'separator', 'stretchy', 'symmetric', 'lspace', 'rspace', 'accent', 'accentunder',
    'linethickness', 'encoding', 'notation', 'minsize', 'maxsize', 'largeop', 'movablelimits',
    'depth', 'voffset', 'data-line', 'data-language', 'data-id', 'data-index'
]);

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'poster', 'action', 'formaction']);

function canonicalUrl(raw: string): string {
    return normalizeUrl(raw);
}

function isSafeStyle(value: string): boolean {
    // A CSS escape (\75rl(...)) can spell a blocked token past the checks below: refuse any backslash.
    if (value.includes('\\')) return false;
    const v = canonicalUrl(value).replace(/\/\*[\s\S]*?\*\//g, '');
    return !/(url\(|expression\(|@import|behavior|-moz-binding|javascript:)/.test(v);
}

function cleanElement(el: Element): void {
    for (const child of Array.from(el.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'input') {
            // Only a task-list checkbox survives, with type, checked and disabled alone.
            if ((child.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
                child.remove();
                continue;
            }
            for (const attr of Array.from(child.attributes)) {
                if (!['type', 'checked', 'disabled'].includes(attr.name.toLowerCase())) {
                    child.removeAttribute(attr.name);
                }
            }
            continue;
        }
        if (DROP_WITH_CHILDREN.has(tag)) {
            child.remove();
            continue;
        }
        cleanElement(child);
        if (!ALLOWED_TAGS.has(tag)) {
            // Unknown element: keep its (already cleaned) children, lose the element.
            child.replaceWith(...Array.from(child.childNodes));
            continue;
        }
        for (const attr of Array.from(child.attributes)) {
            const name = attr.name.toLowerCase();
            const keep =
                (ALLOWED_ATTRS.has(name) || name.startsWith('aria-')) &&
                !name.startsWith('on') &&
                name !== 'srcdoc';
            if (!keep) {
                child.removeAttribute(attr.name);
                continue;
            }
            if (URL_ATTRS.has(name)) {
                const image = name === 'src' || name === 'poster';
                const onlyFragment = tag === 'use';
                const value = attr.value;
                const ok = onlyFragment ? canonicalUrl(value).startsWith('#') : isSafeUrl(value, image);
                if (!ok) child.removeAttribute(attr.name);
            } else if (name === 'srcset') {
                const bad = attr.value.split(',').some((part) => !isSafeUrl(part.trim().split(/\s+/)[0] || '', true));
                if (bad) child.removeAttribute(attr.name);
            } else if (name === 'style' && !isSafeStyle(attr.value)) {
                child.removeAttribute(attr.name);
            }
        }
        if (tag === 'a' && child.getAttribute('target') === '_blank') {
            child.setAttribute('rel', 'noopener noreferrer');
        }
    }
}

/**
 * Sanitize rendered Markdown HTML. Safe to call in the browser and in jsdom.
 * Without a DOM (no DOMParser) it fails closed: every tag is escaped.
 */
export function sanitizeMarkdownHtml(html: string): string {
    if (typeof DOMParser === 'undefined') {
        return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    cleanElement(doc.body);
    return doc.body.innerHTML;
}
