/**
 * Post table tools (Track #1682, Mark 2026-11-04):
 *  - CSV tables: a markdown link titled "mdweb-csv-table" pointing at a CSV published with
 *    the post is replaced by a table built from that CSV, plus a "Download CSV" link.
 *    Cells are text; a cell that is exactly "[text](http(s)://... or /path)" becomes a link.
 *    Nothing from the CSV is parsed as HTML.
 *  - Badges: declarative only. Mark columns with data-mdweb-badge="ColA,ColB:sort" on the
 *    CSV placeholder <a> or on an element immediately before the table/link. The renderer
 *    wraps each non-plain cell in that column as <span class="mdweb-badge" data-badge="<slug>">;
 *    theme CSS colours the slug. No hardcoded engine/value lists. NA/empty/— stay plain.
 *  - Expand: big tables get an "Expand" button that opens a full-screen dialog holding a
 *    copy of the table, scaled to fit the viewport. Below a readable floor (MIN_SCALE = 0.5)
 *    it stops shrinking and the dialog scrolls instead.
 *    The dialog is modal (page behind it inert), labelled by the table's title, shows an
 *    "Esc to close" hint and a 48px X; closing returns focus to the button (or the post title).
 *  - Pin columns: data-mdweb-pin="Model,Engine,Setup" (same marker pattern as badges) marks
 *    those header/body cells. A "Pin columns" toggle (off by default, localStorage) makes
 *    them position:sticky while scrolling sideways, including in the Expand popup. Generic:
 *    any table with the marker gets the same treatment; no per-table special cases.
 *  The server confines /api/getimage to plain upload files; the URL check here is a hint.
 */
const CSV_TITLE = 'mdweb-csv-table';
const DONE = 'mdwebCsv';
/** Only CSV files published with posts (same origin, images dir) are fetched. */
const CSV_HREF = /^\/api\/getimage\?fileName=[A-Za-z0-9._-]+\.csv$/;
export const LIMITS = { bytes: 1_000_000, rows: 5000, cols: 100, tables: 50 };
export const MIN_SCALE = 0.5;

export type BadgeCol = { name: string; sort?: boolean };

/** Parse "Engine,Limit:sort" into column descriptors. Unknown names are fine (no match = skip). */
export function parseBadgeSpec(spec: string | null | undefined): BadgeCol[] {
    if (!spec) return [];
    return spec.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
        const m = /^(.*?):sort$/i.exec(p);
        return m ? { name: m[1].trim(), sort: true } : { name: p };
    }).filter((c) => c.name);
}

/** Slug for data-badge: lowercase, keep only a-z0-9. Same rule for every value. */
export function badgeSlug(v: string): string {
    return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Sentinels that stay plain text (never a badge). */
export function isPlainBadgeValue(v: string): boolean {
    const t = v.trim();
    return t === '' || t === 'NA' || t === '—' || t === '–' || t === '-';
}

/** Best-effort number for data-sort: 128K/1M/1,024 or a plain integer. */
function sortNumber(v: string): string | undefined {
    const t = v.trim().replace(/,/g, '');
    const km = /^(\d+(?:\.\d+)?)([KkMm])$/.exec(t);
    if (km) {
        const n = parseFloat(km[1]) * (/[Mm]/.test(km[2]) ? 1048576 : 1024);
        return String(Math.round(n));
    }
    if (/^\d+$/.test(t)) return t;
    return undefined;
}

function badgeSpan(v: string, sort?: boolean): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = 'mdweb-badge';
    s.dataset.badge = badgeSlug(v);
    s.textContent = v;
    if (sort) {
        const n = sortNumber(v);
        if (n !== undefined) s.dataset.sort = n;
    }
    return s;
}

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
    else el.textContent = v;
    return el;
}

/** Wrap cells in the named columns as badges. Idempotent. Returns how many cells were wrapped. */
export function decorateBadgeColumns(table: HTMLTableElement, cols: BadgeCol[]): number {
    if (!cols.length) return 0;
    const headRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headRow) return 0;
    // Match headers case-insensitively; first unused column wins on duplicates.
    const headers = [...headRow.cells].map((c) => (c.textContent || '').trim());
    const used = new Set<number>();
    const idxs: { i: number; sort: boolean }[] = [];
    for (const c of cols) {
        const i = headers.findIndex((h, idx) => !used.has(idx) && h.toLowerCase() === c.name.toLowerCase());
        if (i < 0) continue;
        used.add(i);
        idxs.push({ i, sort: !!c.sort });
    }
    if (!idxs.length) return 0;
    let n = 0;
    const bodies = table.tBodies.length ? [...table.tBodies] : [];
    let rows = bodies.length ? bodies.flatMap((b) => [...b.rows]) : [...table.rows];
    rows = rows.filter((r) => r !== headRow);
    for (const tr of rows) {
        for (const { i, sort } of idxs) {
            const td = tr.cells[i];
            if (!td || td.tagName === 'TH' || td.querySelector('.mdweb-badge')) continue;
            if (td.childElementCount > 0) continue; // leave links / rich cells alone (documented)
            const v = (td.textContent || '').trim();
            if (isPlainBadgeValue(v)) continue;
            td.textContent = '';
            td.appendChild(badgeSpan(v, sort));
            n++;
        }
    }
    return n;
}

/** Read a badge spec from an element, walking previous siblings (and the parent's). */
function badgeSpecFrom(el: Element | null): string {
    if (!el) return '';
    const own = el.getAttribute('data-mdweb-badge');
    if (own) return own;
    const walk = (start: Element | null): string => {
        let p: Element | null = start;
        while (p) {
            if (p.hasAttribute('data-mdweb-badge')) return p.getAttribute('data-mdweb-badge') || '';
            // Only skip empty wrappers between the marker and the target.
            if ((p.textContent || '').trim() !== '') break;
            p = p.previousElementSibling;
        }
        return '';
    };
    return walk(el.previousElementSibling) || walk(el.parentElement?.previousElementSibling ?? null);
}

/**
 * Apply data-mdweb-badge markers to tables already in the DOM (markdown tables).
 * A marker on an element badges the next table sibling (same pattern as data-mdweb-sort).
 * Returns how many tables were decorated.
 */
export function applyBadgeColumns(root: ParentNode): number {
    let n = 0;
    root.querySelectorAll<HTMLElement>('[data-mdweb-badge]').forEach((m) => {
        const spec = m.getAttribute('data-mdweb-badge') || '';
        const cols = parseBadgeSpec(spec);
        if (!cols.length) return;
        // Only a table that follows this marker (never an earlier/unrelated one).
        let t: HTMLTableElement | null = null;
        let sib: Element | null = m.nextElementSibling;
        while (sib && !t) {
            if (sib.tagName === 'TABLE') t = sib as HTMLTableElement;
            else if (sib.classList?.contains('mdweb-csv-table') || sib.classList?.contains('mdweb-table-wrap')
                || sib.classList?.contains('mdweb-table-tools')) {
                t = sib.querySelector('table');
            } else if ((sib.textContent || '').trim() === '') {
                // empty wrapper — keep looking
            } else {
                // Hit real content (heading, paragraph) before a table: stop.
                // Still allow an immediate tools/csv box that replaced a link.
                t = sib.querySelector?.('table') ?? null;
                if (!t) break;
            }
            if (!t) sib = sib.nextElementSibling;
        }
        if (!t) return;
        const k = decorateBadgeColumns(t, cols);
        if (k > 0) { n++; t.dataset.mdwebBadge = '1'; }
    });
    return n;
}

let uid = 0;
export function tableFromCsv(rows: string[][], label?: string, badgeCols: BadgeCol[] = []): HTMLTableElement {
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
    if (badgeCols.length) decorateBadgeColumns(t, badgeCols);
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
        const badgeCols = parseBadgeSpec(badgeSpecFrom(a));
        const table = tableFromCsv(rows, label, badgeCols);
        const pinNames = parsePinSpec(pinSpecFrom(a));
        if (pinNames.length) decoratePinColumns(table, pinNames);
        box.appendChild(table);
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
    const pinsOn = pinWrap(table).classList.contains('mdweb-pins-on');
    if (pinsOn) stage.classList.add('mdweb-pins-on');
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
    fit();
    if (pinsOn) {
        // Measure after the dialog is in the document and fit() has run.
        requestAnimationFrame(() => syncPinLeftOffsets(copy));
    }
    x.focus();
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


/* ---- Optional pin columns (Track #1682) ---- */

const PIN_LS = 'mdweb-pin:';

/** Parse "Model,Engine,Setup" into column names. */
export function parsePinSpec(spec: string | null | undefined): string[] {
    if (!spec) return [];
    return spec.split(',').map((p) => p.trim()).filter(Boolean);
}

function pinSpecFrom(el: Element | null): string {
    if (!el) return '';
    const own = el.getAttribute('data-mdweb-pin');
    if (own) return own;
    const walk = (start: Element | null): string => {
        let p: Element | null = start;
        while (p) {
            if (p.hasAttribute('data-mdweb-pin')) return p.getAttribute('data-mdweb-pin') || '';
            if ((p.textContent || '').trim() !== '') break;
            p = p.previousElementSibling;
        }
        return '';
    };
    return walk(el.previousElementSibling) || walk(el.parentElement?.previousElementSibling ?? null);
}

/** Stable localStorage key for a table's pin preference. */
export function pinStorageKey(table: HTMLTableElement): string {
    const head = table.tHead?.rows[0] ?? table.rows[0];
    const headers = head ? [...head.cells].map((c) => (c.textContent || '').trim()).join('|') : '';
    const title = tableTitle(table, 0);
    return PIN_LS + title + '::' + headers;
}

export function isPinEnabled(key: string): boolean {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function setPinEnabled(key: string, on: boolean): void {
    try {
        if (on) localStorage.setItem(key, '1');
        else localStorage.removeItem(key);
    } catch { /* ignore quota / private mode */ }
}

/** Mark matching th/td with data-mdweb-pin. Idempotent. Returns cells newly marked. */
export function decoratePinColumns(table: HTMLTableElement, names: string[]): number {
    if (!names.length) return 0;
    const headRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headRow) return 0;
    if (table.dataset.mdwebPinReady === '1' && headRow.querySelector('th[data-mdweb-pin],td[data-mdweb-pin]')) return 0;
    const headers = [...headRow.cells].map((c) => (c.textContent || '').trim());
    const used = new Set<number>();
    const idxs: number[] = [];
    for (const name of names) {
        const i = headers.findIndex((h, idx) => !used.has(idx) && h.toLowerCase() === name.toLowerCase());
        if (i < 0) continue;
        used.add(i);
        idxs.push(i);
    }
    if (!idxs.length) return 0;
    let n = 0;
    const mark = (cell: HTMLTableCellElement | undefined, i: number) => {
        if (!cell || cell.hasAttribute('data-mdweb-pin')) return;
        cell.setAttribute('data-mdweb-pin', '');
        cell.dataset.mdwebPinI = String(i);
        n++;
    };
    for (const i of idxs) mark(headRow.cells[i], i);
    const bodies = table.tBodies.length ? [...table.tBodies] : [];
    let rows = bodies.length ? bodies.flatMap((b) => [...b.rows]) : [...table.rows];
    rows = rows.filter((r) => r !== headRow);
    for (const tr of rows) for (const i of idxs) mark(tr.cells[i], i);
    table.dataset.mdwebPinReady = '1';
    return n;
}

/** Apply data-mdweb-pin markers to the next table sibling. Returns tables decorated. */
export function applyPinColumns(root: ParentNode): number {
    let n = 0;
    root.querySelectorAll<HTMLElement>('[data-mdweb-pin]').forEach((m) => {
        // Skip cells already marked as pin targets
        if (m.tagName === 'TH' || m.tagName === 'TD') return;
        m.setAttribute('hidden', '');
        const names = parsePinSpec(m.getAttribute('data-mdweb-pin'));
        if (!names.length) return;
        let t: HTMLTableElement | null = null;
        let sib: Element | null = m.nextElementSibling;
        while (sib && !t) {
            if (sib.tagName === 'TABLE') t = sib as HTMLTableElement;
            else if (sib.classList?.contains('mdweb-csv-table') || sib.classList?.contains('mdweb-table-wrap')
                || sib.classList?.contains('mdweb-table-tools')) {
                t = sib.querySelector('table');
            } else if ((sib.textContent || '').trim() === '') {
                // keep looking
            } else {
                t = sib.querySelector?.('table') ?? null;
                if (!t) break;
            }
            if (!t) sib = sib.nextElementSibling;
        }
        if (!t) return;
        if (decoratePinColumns(t, names) > 0) n++;
    });
    return n;
}

/** Set --mdweb-pin-left on pinned cells from preceding pinned column widths. */
export function syncPinLeftOffsets(table: HTMLTableElement): void {
    const headRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headRow) return;
    const n = headRow.cells.length;
    // Column width = max across header + body (table column sizing).
    const widths: number[] = Array.from({ length: n }, () => 0);
    for (const tr of table.rows) {
        for (let i = 0; i < n; i++) {
            const c = tr.cells[i];
            if (!c) continue;
            widths[i] = Math.max(widths[i], c.getBoundingClientRect().width || c.offsetWidth || 0);
        }
    }
    const pinnedIdx: number[] = [];
    [...headRow.cells].forEach((c, i) => { if (c.hasAttribute('data-mdweb-pin')) pinnedIdx.push(i); });
    // Sticky left = sum of widths of pinned columns to the left (leading contiguous pins).
    const lefts = new Map<number, number>();
    let left = 0;
    for (const i of pinnedIdx) {
        lefts.set(i, left);
        left += widths[i];
    }
    const apply = (cell: HTMLTableCellElement | undefined, i: number) => {
        if (!cell) return;
        const L = lefts.get(i);
        if (L === undefined) return;
        cell.style.setProperty('--mdweb-pin-left', `${L}px`);
    };
    for (const i of pinnedIdx) apply(headRow.cells[i], i);
    const bodies = table.tBodies.length ? [...table.tBodies] : [];
    let rows = bodies.length ? bodies.flatMap((b) => [...b.rows]) : [...table.rows];
    rows = rows.filter((r) => r !== headRow);
    for (const tr of rows) for (const i of pinnedIdx) apply(tr.cells[i], i);
}

function pinHost(table: HTMLTableElement): HTMLElement {
    const box = (table.parentElement?.classList.contains('mdweb-table-wrap') ? table.parentElement : table) as HTMLElement;
    return (box.parentElement?.classList.contains('mdweb-csv-table') ? box.parentElement : box) as HTMLElement;
}

function pinWrap(table: HTMLTableElement): HTMLElement {
    return (table.parentElement?.classList.contains('mdweb-table-wrap')
        ? table.parentElement
        : table) as HTMLElement;
}

function ensureToolsBar(host: HTMLElement): HTMLElement {
    let bar = host.previousElementSibling as HTMLElement | null;
    if (!bar || !bar.classList.contains('mdweb-table-tools')) {
        bar = document.createElement('div');
        bar.className = 'mdweb-table-tools';
        host.before(bar);
    }
    return bar;
}

const pinObservers = new WeakMap<HTMLTableElement, ResizeObserver>();
function applyPinState(table: HTMLTableElement, on: boolean): void {
    const wrap = pinWrap(table);
    wrap.classList.toggle('mdweb-pins-on', on);
    const prev = pinObservers.get(table);
    if (prev) { prev.disconnect(); pinObservers.delete(table); }
    if (on) {
        syncPinLeftOffsets(table);
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => syncPinLeftOffsets(table));
            ro.observe(wrap);
            pinObservers.set(table, ro);
        }
    }
}

/** Add a Pin columns toggle above every table that has pin columns (once). */
export function addPinToggles(root: ParentNode): void {
    root.querySelectorAll<HTMLTableElement>('table').forEach((t) => {
        if (t.closest('.mdweb-table-popup') || t.dataset.mdwebPinToggle) return;
        if (t.dataset.mdwebPinReady !== '1' && !t.querySelector('th[data-mdweb-pin],td[data-mdweb-pin]')) return;
        t.dataset.mdwebPinToggle = '1';
        const host = pinHost(t);
        const bar = ensureToolsBar(host);
        if (bar.querySelector('button.mdweb-table-pin')) return;
        const key = pinStorageKey(t);
        const on = isPinEnabled(key);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mdweb-table-pin';
        b.textContent = 'Pin columns';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        const pinNames = [...(t.tHead?.rows[0]?.cells || [])]
            .filter((c) => c.hasAttribute('data-mdweb-pin'))
            .map((c) => (c.textContent || '').trim())
            .filter(Boolean);
        const title = tableTitle(t, 0) || 'this table';
        const id = `mdweb-pin-table-${++uid}`;
        if (!t.id) t.id = id;
        b.setAttribute('aria-controls', t.id);
        b.setAttribute('aria-label', `Pin columns for ${title}`);
        applyPinState(t, on);
        b.addEventListener('click', () => {
            const next = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', next ? 'true' : 'false');
            setPinEnabled(key, next);
            applyPinState(t, next);
        });
        // Prefer pin next to Expand: after Expand if present, else prepend.
        const expand = bar.querySelector('button.mdweb-table-expand');
        if (expand) expand.after(b);
        else bar.prepend(b);
        if (pinNames.length) {
            const desc = document.createElement('span');
            desc.id = `${id}-desc`;
            desc.className = 'sr-only';
            desc.textContent = `Keeps ${pinNames.join(', ')} visible while scrolling sideways.`;
            b.after(desc);
            b.setAttribute('aria-describedby', desc.id);
        }
    });
}
