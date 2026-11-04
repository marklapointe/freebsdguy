/**
 * Post table tools (Track #1682, Mark 2026-11-04):
 *  - CSV tables: a markdown link titled "mdweb-csv-table" pointing at a CSV published with
 *    the post is replaced by a table built from that CSV, plus a "Download CSV" link.
 *    Cells are text; a cell that is exactly "[text](http(s)://... or /path)" becomes a link.
 *    Nothing from the CSV is parsed as HTML.
 *  - Expand: big tables get an "Expand" button that opens a full-screen dialog holding a
 *    copy of the table, scaled to fit the viewport. Below a readable floor (MIN_SCALE = 0.5)
 *    it stops shrinking and the dialog scrolls instead.
 *    The dialog is modal (page behind it inert), labelled by the table's title, shows an
 *    "Esc to close" hint and a 48px X; closing returns focus to the button (or the post title).
 *  The server confines /api/getimage to plain upload files; the URL check here is a hint.
 */
const CSV_TITLE = 'mdweb-csv-table';
const DONE = 'mdwebCsv';
const ENGINE = new Map<string, string>([['vLLM', 'vllm'], ['SGLang', 'sglang'], ['llama.cpp', 'llamacpp']]);
/** Only CSV files published with posts (same origin, images dir) are fetched. */
const CSV_HREF = /^\/api\/getimage\?fileName=[A-Za-z0-9._-]+\.csv$/;
export const LIMITS = { bytes: 1_000_000, rows: 5000, cols: 100, tables: 50 };
export const MIN_SCALE = 0.5;

/** RFC 4180 CSV: quoted fields, "" escapes, embedded commas and newlines, CRLF. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false; let started = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
            else f += c;
        } else if (c === '"') { q = true; started = true; }
        else if (c === ',') { row.push(f); f = ''; started = true; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(f); rows.push(row); row = []; f = ''; started = false;
        } else { f += c; started = true; }
    }
    if (started || f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
}

/** Scale that makes a w x h box fit a vw x vh area; grows small tables up to 2x and never
 *  shrinks below MIN_SCALE (the caller lets the dialog scroll then). */
export function fitScale(w: number, h: number, vw: number, vh: number): number {
    if (!(w > 0) || !(h > 0)) return 1;
    return Math.max(MIN_SCALE, Math.min(vw / w, vh / h, 2));
}

const LINK = /^\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s()]*)\)$/;
function cell(tag: 'th' | 'td', v: string): HTMLElement {
    const el = document.createElement(tag);
    if (tag === 'th') el.setAttribute('scope', 'col');
    const m = LINK.exec(v);
    if (m) { const a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]; el.appendChild(a); }
    else if (tag === 'td' && ENGINE.has(v)) {
        const s = document.createElement('span'); s.className = 'mdweb-badge'; s.dataset.badge = ENGINE.get(v)!; s.textContent = v; el.appendChild(s);
    } else el.textContent = v;
    return el;
}

let uid = 0;
export function tableFromCsv(rows: string[][], label?: string): HTMLTableElement {
    const t = document.createElement('table');
    if (label) {
        const c = t.createCaption(); c.id = `mdweb-csv-cap-${++uid}`; c.textContent = label;
        t.setAttribute('aria-labelledby', c.id);
    }
    const [head, ...body] = rows;
    const th = t.createTHead().insertRow();
    (head || []).forEach((h) => th.appendChild(cell('th', h)));
    const tb = t.createTBody();
    body.forEach((r) => { const tr = tb.insertRow(); r.forEach((v) => tr.appendChild(cell('td', v))); });
    return t;
}

type Fetcher = (url: string) => Promise<string>;
const defaultFetch: Fetcher = async (url) => {
    // Same origin only: a redirect anywhere else is an error, not a follow.
    const r = await fetch(url, { credentials: 'same-origin', redirect: 'error' });
    if (!r.ok) { await r.body?.cancel(); throw new Error(String(r.status)); }
    if (Number(r.headers.get('content-length') || 0) > LIMITS.bytes) { await r.body?.cancel(); throw new Error('too large'); }
    if (!r.body) return r.text();
    // Stop reading as soon as the byte limit is passed, even without a Content-Length.
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > LIMITS.bytes) { await reader.cancel(); throw new Error('too large'); }
        parts.push(value);
    }
    const all = new Uint8Array(n); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return new TextDecoder().decode(all);
};
const byteLength = (t: string) => new TextEncoder().encode(t).length;

/** Replace each CSV placeholder link with its table and a Download CSV link.
 *  Returns how many tables were rendered. */
export async function renderCsvTables(root: ParentNode, fetcher: Fetcher = defaultFetch): Promise<number> {
    const links = [...root.querySelectorAll<HTMLAnchorElement>(`a[title="${CSV_TITLE}"]`)]
        .filter((a) => !a.dataset[DONE]).slice(0, LIMITS.tables);
    let done = 0;
    for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (!CSV_HREF.test(href)) { a.dataset[DONE] = 'refused'; continue; }   // left as an ordinary link
        a.dataset[DONE] = 'loading';
        a.removeAttribute('title');
        const label = a.textContent || 'table';
        a.setAttribute('aria-live', 'polite');
        a.textContent = `Loading ${label}…`;
        let rows: string[][]; let cut = false;
        try {
            const text = await fetcher(href);
            if (byteLength(text) > LIMITS.bytes) throw new Error('too large');
            const all = parseCsv(text);
            cut = all.length > LIMITS.rows + 1 || all.some((r) => r.length > LIMITS.cols);
            rows = all.slice(0, LIMITS.rows + 1).map((r) => r.slice(0, LIMITS.cols));
        } catch (e) {
            // No link back to the file that just failed: say what went wrong instead.
            const msg = document.createElement('span');   // block via CSS; valid inside or outside a <p>
            msg.className = 'mdweb-csv-error'; msg.setAttribute('role', 'alert'); msg.dataset[DONE] = 'failed';
            const why = (e as Error)?.message;
            msg.textContent = why === '404'
                ? `The table "${label}" could not be found. Ask the author to publish its CSV again.`
                : why === '403' || why === '400'
                    ? `The link for the table "${label}" is not valid. Ask the author to publish it again.`
                    : why === 'too large'
                        ? `The table "${label}" is too large to show here (over ${LIMITS.bytes / 1_000_000} MB). Ask the author for a smaller CSV.`
                        : `The table "${label}" could not be loaded. Reload the page to try again.`;
            const host = a.parentElement && a.parentElement.tagName === 'P' && a.parentElement.childNodes.length === 1 ? a.parentElement : a;
            host.replaceWith(msg);
            continue;
        }
        const box = document.createElement('div'); box.className = 'mdweb-csv-table';
        const dl = document.createElement('a');
        dl.className = 'mdweb-csv-download'; dl.href = href; dl.textContent = `Download CSV: ${label}`;
        dl.setAttribute('download', href.split('fileName=')[1]);
        box.appendChild(tableFromCsv(rows, label));
        if (cut) {
            const n = document.createElement('p'); n.className = 'mdweb-csv-note';
            n.textContent = `Showing the first ${LIMITS.rows} rows and ${LIMITS.cols} columns. Download the CSV for all of it.`;
            box.appendChild(n);
        }
        const bar = document.createElement('div'); bar.className = 'mdweb-table-tools'; bar.appendChild(dl);
        const host = a.parentElement && a.parentElement.tagName === 'P' && a.parentElement.childNodes.length === 1 ? a.parentElement : a;
        host.replaceWith(bar, box);
        done++;
    }
    return done;
}

let openClose: (() => void) | null = null;
/** Close the popup if one is open (called when the post unmounts). */
export function closeTablePopup(): void { if (openClose) openClose(); }

export function isBigTable(t: HTMLTableElement): boolean {
    let cols = 0;
    for (const r of t.rows) { let n = 0; for (const c of r.cells) n += Math.max(1, c.colSpan || 1); cols = Math.max(cols, n); }
    return cols >= 6 || t.rows.length >= 12;
}

/** Title for a table: its caption, else the nearest heading before it, else "Table N". */
export function tableTitle(t: HTMLTableElement, n: number): string {
    const cap = t.caption?.textContent?.trim();
    if (cap) return cap;
    const scope = t.closest('.article-body, article, main') || document;
    const hs = [...scope.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
        .filter((h) => h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
    const h = hs[hs.length - 1]?.textContent?.trim();
    return h || `Table ${n}`;
}

function openPopup(table: HTMLTableElement, opener: HTMLElement, title: string): void {
    closeTablePopup();
    const d = document.createElement('div');
    d.className = 'mdweb-table-popup'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    const head = document.createElement('div'); head.className = 'mdweb-table-popup-head';
    const h = document.createElement('h2'); h.className = 'mdweb-table-popup-title'; h.id = `mdweb-popup-title-${++uid}`; h.textContent = title;
    d.setAttribute('aria-labelledby', h.id);
    const hint = document.createElement('span'); hint.className = 'mdweb-table-hint'; hint.textContent = 'Esc to close';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'mdweb-table-close'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    head.append(h, hint, x);
    const stage = document.createElement('div'); stage.className = 'mdweb-table-stage';
    const copy = table.cloneNode(true) as HTMLTableElement;
    copy.querySelectorAll('button.mdweb-sort-btn').forEach((b) => b.replaceWith(...b.childNodes));
    copy.querySelector('caption')?.remove(); copy.removeAttribute('aria-labelledby');
    stage.appendChild(copy); d.append(head, stage);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Modal: everything else on the page leaves the tab order and the accessibility tree.
    const bg = [...document.body.children].filter((el) => !el.hasAttribute('inert')) as HTMLElement[];
    bg.forEach((el) => el.setAttribute('inert', ''));
    document.body.appendChild(d);
    const fit = () => {
        copy.style.transform = '';
        const w = copy.scrollWidth, h = copy.scrollHeight;
        // Available area = the popup's own content box below its header (no duplicated CSS numbers).
        const cs = getComputedStyle(d);
        const px = (v: string) => parseFloat(v) || 0;
        const aw = Math.max(1, (d.clientWidth || window.innerWidth) - px(cs.paddingLeft) - px(cs.paddingRight));
        const ah = Math.max(1, (d.clientHeight || window.innerHeight) - px(cs.paddingTop) - px(cs.paddingBottom) - head.offsetHeight);
        const s = fitScale(w, h, aw, ah);
        copy.style.transformOrigin = 'top left';
        copy.style.transform = `scale(${s})`;
        stage.style.width = `${Math.ceil(w * s)}px`; stage.style.height = `${Math.ceil(h * s)}px`;
        // At the legibility floor a very large table may still overflow: let it scroll then.
        d.classList.toggle('mdweb-table-popup--scroll', w * s > aw || h * s > ah);
    };
    const close = () => {
        openClose = null;
        d.remove(); document.body.style.overflow = prevOverflow;
        bg.forEach((el) => el.removeAttribute('inert'));
        document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit);
        if (opener.isConnected) opener.focus();
        else {
            const t = document.querySelector<HTMLElement>('.article-title') ?? document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
            if (t) { if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus(); }
        }
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') {
            // Keep focus inside the dialog, cycling through the close button and any links in the table.
            const f = [x, ...d.querySelectorAll<HTMLElement>('a[href]')];
            const i = f.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
            e.preventDefault(); f[next].focus();
        }
    };
    x.addEventListener('click', close);
    d.addEventListener('click', (e) => { if (e.target === d) close(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    openClose = close;
    fit(); x.focus();
}

/** Add an Expand button above every big table (once). */
export function addTableTools(root: ParentNode): void {
    let n = root.querySelectorAll('button.mdweb-table-expand').length;
    const seen = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('button.mdweb-table-expand').forEach((b) => { const k = b.dataset.title || ''; seen.set(k, (seen.get(k) || 0) + 1); });
    root.querySelectorAll<HTMLTableElement>('table').forEach((t) => {
        if (t.closest('.mdweb-table-popup') || t.dataset.mdwebTools || !isBigTable(t)) return;
        t.dataset.mdwebTools = '1';
        const box = (t.parentElement?.classList.contains('mdweb-table-wrap') ? t.parentElement : t) as HTMLElement;
        const host = box.parentElement?.classList.contains('mdweb-csv-table') ? box.parentElement : box;
        let bar = host.previousElementSibling as HTMLElement | null;
        if (!bar || !bar.classList.contains('mdweb-table-tools')) {
            bar = document.createElement('div'); bar.className = 'mdweb-table-tools'; host.before(bar);
        }
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mdweb-table-expand'; b.textContent = 'Expand';
        const base = tableTitle(t, ++n);
        const k = (seen.get(base) || 0) + 1; seen.set(base, k);
        const title = k > 1 ? `${base} (${k})` : base;   // several tables under one heading stay distinct
        b.dataset.title = base;
        b.setAttribute('aria-label', `Expand table: ${title}, full screen`);
        b.addEventListener('click', () => openPopup(t, b, title));
        bar.prepend(b);
    });
}
