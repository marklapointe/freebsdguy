/**
 * Write-time content rules for a post (P0 D1/D2).
 *
 * A post is Markdown written by an authenticated author, but it is rendered to
 * every reader, so what is stored must not carry script. The renderer is
 * hardened as well (raw HTML off, client sanitizer, CSP); this is the first
 * line: a post that carries
 *   - a dangerous URL scheme (javascript:, vbscript:, data: other than a small
 *     image), however it is written (case, entities, control characters,
 *     percent-encoding), in a Markdown link or image, a reference definition,
 *     an autolink or an HTML URL attribute, or
 *   - a dangerous raw HTML tag (script, iframe, object, embed, base, form,
 *     meta), an event-handler attribute (on*=) or srcdoc
 * is refused. Fenced code blocks and inline code are examples, not markup, and
 * are skipped.
 */

import { isDangerousUrl } from './url-safety.ts';

export type ContentCheck = { ok: true } | { ok: false; error: string };

export const CONTENT_REFUSED = 'Post content refused';

const BANNED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base', 'form', 'meta']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster']);

/** Replace fenced code blocks and inline code spans with blanks. */
function stripCode(text: string): string {
    const out: string[] = [];
    let fence: { ch: string; len: number } | null = null;
    for (const line of text.split(/\r\n|\r|\n/)) {
        // Opening: column 0 only (an indented fence is list content and must not mask what follows).
        // Closing: up to 3 leading spaces, as CommonMark allows.
        const m = /^(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
            if (c && c[1][0] === fence.ch && c[1].length >= fence.len) fence = null;
            out.push('');
            continue;
        }
        if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
            fence = { ch: m[1][0], len: m[1].length };
            out.push('');
            continue;
        }
        out.push(line);
    }
    // A code span cannot cross a paragraph boundary (CommonMark), so each block
    // between blank lines is scanned on its own, matching the exact backtick run.
    return out
        .join('\n')
        .split(/\n[ \t]*\n/)
        .map(stripInlineCode)
        .join('\n\n');
}

/** Backtick runs of a paragraph indexed once: run length -> ascending start offsets, with a forward-only cursor. */
class BacktickRuns {
    private readonly byLen = new Map<number, { starts: number[]; p: number }>();

    constructor(block: string) {
        for (let i = block.indexOf('`'); i >= 0; ) {
            let j = i;
            while (block[j] === '`') j++;
            const e = this.byLen.get(j - i);
            if (e) e.starts.push(i);
            else this.byLen.set(j - i, { starts: [i], p: 0 });
            i = block.indexOf('`', j);
        }
    }

    /** Start of the next run of exactly `len` backticks at or after `from`, or -1. `from` must not decrease between calls. */
    next(from: number, len: number): number {
        const e = this.byLen.get(len);
        if (!e) return -1;
        while (e.p < e.starts.length && e.starts[e.p] < from) e.p++;
        return e.p < e.starts.length ? e.starts[e.p] : -1;
    }
}

/** Index just past the `>` that closes the tag starting at `start`, quotes respected, or -1 (unclosed, or another `<` first). */
function tagEnd(block: string, start: number): number {
    let quote = '';
    for (let i = start + 1; i < block.length; i++) {
        const c = block[i];
        if (quote) {
            if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '<') return -1; // a new tag starts first: the opening `<` was literal text
        else if (c === '>') return i + 1;
    }
    return -1;
}

/**
 * Blank the inline code spans of one paragraph, left to right, in CommonMark
 * precedence: a backslash-escaped backtick is literal; an HTML tag that starts
 * before a backtick is read to its closing `>` first (a backtick inside an
 * attribute value does not open a span); otherwise a run of N backticks opens a
 * span that closes only at a run of exactly N in the same paragraph.
 */
function stripInlineCode(block: string): string {
    let out = '';
    let i = 0;
    let runs: BacktickRuns | null = null;
    while (i < block.length) {
        const c = block[i];
        if (c === '\\') {
            out += block.slice(i, i + 2);
            i += 2;
        } else if (c === '<' && /^(?:[a-zA-Z]|\/[a-zA-Z])/.test(block.slice(i + 1, i + 3))) {
            const end = tagEnd(block, i);
            if (end < 0) {
                // No closing `>`: this `<` is literal text, so a code span after it still strips.
                out += c;
                i++;
            } else {
                out += block.slice(i, end);
                i = end;
            }
        } else if (c === '`') {
            let j = i;
            while (block[j] === '`') j++;
            const len = j - i;
            const close = (runs ??= new BacktickRuns(block)).next(j, len);
            if (close < 0) {
                out += block.slice(i, j);
                i = j;
            } else {
                out += ' ';
                i = close + len;
            }
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

interface Attr {
    name: string;
    value: string;
}

/** Parse the raw HTML tags of a text: a small tolerant tokenizer, no DOM. */
function* htmlTags(text: string): Generator<{ name: string; attrs: Attr[] }> {
    const re = /<\s*([a-zA-Z][^\s/>]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        let i = m.index + m[0].length;
        const attrs: Attr[] = [];
        while (i < text.length) {
            while (i < text.length && /[\s/]/.test(text[i])) i++;
            if (i >= text.length || text[i] === '>') break;
            if (text[i] === '<') break; // a new tag starts: this one was unclosed, scan the next from here
            let j = i;
            while (j < text.length && !/[\s=>/]/.test(text[j])) j++;
            const name = text.slice(i, j).toLowerCase();
            i = j;
            while (i < text.length && /\s/.test(text[i])) i++;
            let value = '';
            if (text[i] === '=') {
                i++;
                while (i < text.length && /\s/.test(text[i])) i++;
                const q = text[i];
                if (q === '"' || q === "'") {
                    const end = text.indexOf(q, i + 1);
                    value = text.slice(i + 1, end < 0 ? text.length : end);
                    i = end < 0 ? text.length : end + 1;
                } else {
                    let k = i;
                    while (k < text.length && !/[\s>]/.test(text[k])) k++;
                    value = text.slice(i, k);
                    i = k;
                }
            }
            if (name) attrs.push({ name, value });
        }
        yield { name: m[1].toLowerCase(), attrs };
        re.lastIndex = Math.max(re.lastIndex, i);
    }
}

const REF_START = /^[ \t>\-+*\d.)]*\[/;
const BLANK_LINE = /^[ \t]*$/;
const MAX_LABEL = 999; // the CommonMark label limit

/**
 * True when a link reference definition (`[label]: destination`) has a dangerous
 * destination. Strictly O(n): each line is walked once as part of a label and at
 * most once more as a possible start. A label opens at `[` after an optional
 * quote/list prefix, may span lines (never a blank one), honours `\` escapes and
 * ends at the first `]`, which must be followed by `:`. The destination is on the
 * same line or the next. A failed label resumes at the line where it failed, so
 * lines it consumed are not re-scanned and a definition after it is still found.
 */
function hasDangerousRefDef(text: string): boolean {
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; ) {
        const start = REF_START.exec(lines[li]);
        if (!start) {
            li++;
            continue;
        }
        let l = li;
        let c = start[0].length;
        let len = 0;
        let closed = false;
        scan: for (;;) {
            const line = lines[l];
            while (c < line.length) {
                const ch = line[c];
                if (ch === '\\') {
                    if (c + 1 >= line.length) break scan;
                    c += 2;
                    len += 2;
                } else if (ch === ']') {
                    closed = line[c + 1] === ':';
                    break scan;
                } else {
                    c++;
                    len++;
                }
                if (len > MAX_LABEL) break scan;
            }
            l++;
            if (l >= lines.length || BLANK_LINE.test(lines[l])) break;
            c = 0;
            len++;
        }
        if (!closed) {
            li = l > li ? l : li + 1;
            continue;
        }
        let line = lines[l];
        let p = c + 2;
        while (line[p] === ' ' || line[p] === '\t') p++;
        if (p >= line.length && l + 1 < lines.length) {
            line = lines[l + 1];
            p = 0;
            while (line[p] === ' ' || line[p] === '\t') p++;
        }
        const rest = line.slice(p);
        let dest = '';
        if (rest[0] === '<') {
            const gt = rest.indexOf('>');
            if (gt >= 0) dest = rest.slice(0, gt + 1);
        }
        if (!dest) dest = /^\S+/.exec(rest)?.[0] ?? '';
        if (dest && isDangerousUrl(dest.replace(/^<|>$/g, ''))) return true;
        li = l + 1;
    }
    return false;
}

function scanText(raw: string): string | null {
    const text = stripCode(raw);

    for (const tag of htmlTags(text)) {
        const bare = tag.name.replace(/^\/+/, '');
        if (BANNED_TAGS.has(bare)) return `raw <${bare}> is not allowed`;
        for (const a of tag.attrs) {
            if (/^on/.test(a.name)) return `event handler attribute ${a.name} is not allowed`;
            if (a.name === 'srcdoc') return 'srcdoc is not allowed';
            if (a.name === 'srcset') {
                for (const part of a.value.split(',')) {
                    if (isDangerousUrl(part.trim().split(/\s+/)[0] || '', true)) return 'URL scheme in srcset is not allowed';
                }
            }
            if (URL_ATTRS.has(a.name) && isDangerousUrl(a.value, a.name === 'src' || a.name === 'poster')) {
                return `URL scheme in ${a.name} is not allowed`;
            }
        }
    }

    // Autolinks: <scheme:...>
    for (const m of text.matchAll(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*)>/g)) {
        if (isDangerousUrl(m[1])) return 'URL scheme in autolink is not allowed';
    }

    // Reference definitions: [id]: url (also in a blockquote or list, and with the
    // destination on the next line). One linear pass, no regex over the label.
    if (hasDangerousRefDef(text)) return 'URL scheme in link reference is not allowed';

    // Inline links and images: ](destination ...). The scheme sits at the start of the
    // destination, so only a bounded window of it is read, and it ends at the next `](` (which is checked on its own): the scan stays linear.
    const matchOpen = matchingBrackets(text);
    for (let at = text.indexOf(']('); at >= 0; at = text.indexOf('](', at + 2)) {
        let i = at + 2;
        while (i < text.length && /\s/.test(text[i])) i++;
        let dest: string;
        if (text[i] === '<') {
            let j = i + 1;
            while (j < text.length && j - i <= MAX_DEST && text[j] !== '>' && !(text[j] === ']' && text[j + 1] === '(')) j++;
            dest = text.slice(i + 1, j);
        } else {
            let depth = 0;
            let j = i;
            while (j < text.length && j - i < MAX_DEST && !/\s/.test(text[j]) && !(text[j] === ']' && text[j + 1] === '(')) {
                if (text[j] === '(') depth++;
                else if (text[j] === ')') {
                    if (depth === 0) break;
                    depth--;
                }
                j++;
            }
            dest = text.slice(i, j);
        }
        const open = matchOpen.get(at);
        const image = open !== undefined && open > 0 && text[open - 1] === '!';
        if (isDangerousUrl(dest, image)) {
            return image ? 'URL scheme in image source is not allowed' : 'URL scheme in link is not allowed';
        }
    }
    return null;
}

const MAX_DEST = 2048;
export const MAX_FIELD_LENGTH = 1024 * 1024;

/** One linear pass: for each `]` that is followed by `(`, the index of its matching `[` (bracket-balanced). */
function matchingBrackets(text: string): Map<number, number> {
    const stack: number[] = [];
    const out = new Map<number, number>();
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '[') stack.push(i);
        else if (c === ']') {
            const open = stack.pop();
            if (open !== undefined && text[i + 1] === '(') out.set(i, open);
        }
    }
    return out;
}

/**
 * Check the text fields of a post. The error names the kind of problem and
 * never echoes the offending text.
 */
export function validatePostContent(input: {
    content?: unknown;
    title?: unknown;
    summary?: unknown;
}): ContentCheck {
    for (const [field, value] of [
        ['content', input.content],
        ['summary', input.summary],
        ['title', input.title]
    ] as const) {
        if (typeof value !== 'string' || !value) continue;
        if (value.length > MAX_FIELD_LENGTH) return { ok: false, error: `${CONTENT_REFUSED}: Post content is too large (${field})` };
        const problem = scanText(value);
        if (problem) return { ok: false, error: `${CONTENT_REFUSED}: ${problem} (${field})` };
    }
    return { ok: true };
}
