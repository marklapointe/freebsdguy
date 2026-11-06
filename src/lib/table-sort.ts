/**
 * Optional sortable tables in posts (Track #1682). Progressive enhancement: the
 * markdown renders the table in authored order; this adds a <button> to each
 * header cell that sorts the body rows (asc, then desc) and sets aria-sort.
 *
 * Off by default. Precedence, last wins:
 *  1. site config `tableSort` (boolean, default false)
 *  2. post front matter `tablesort: true|false`
 *  3. an element right before a table with data-mdweb-sort="on" or "off"
 */
import { asFlag } from '../../server/lib/flag';

const BTN = 'mdweb-sort-btn';
const ORIG = 'mdwebRow';

/** Site default, overridden by the post's front matter when it is a valid flag. */
export function resolveTableSort(site: unknown, post: unknown): boolean {
    return asFlag(post) ?? asFlag(site) ?? false;
}

function marker(table: Element): boolean | undefined {
    const box = table.parentElement?.classList.contains('mdweb-table-wrap') ? table.parentElement : table;
    const prev = box.previousElementSibling;
    return prev ? asFlag(prev.getAttribute('data-mdweb-sort')) : undefined;
}

/**
 * Sort key for a cell: data-sort (number or text) wins; else the first number in
 * the text, with K (x1,024) and M (x1,048,576) suffixes, e.g. "128K", "262,144",
 * "1M". Cells with no number (Queued, n/a, Not supported) get null and sort last.
 */
export function sortKey(cell: Element | undefined): number | string | null {
    if (!cell) return null;
    const raw = cell.getAttribute('data-sort') ?? cell.querySelector('[data-sort]')?.getAttribute('data-sort') ?? null;
    if (raw !== null) {
        const n = Number(raw.trim());
        return raw.trim() !== '' && !isNaN(n) ? n : raw.trim().toLowerCase();
    }
    const text = (cell.textContent || '').trim();
    const m = text.match(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*([KkMm](?![a-z]))?/);
    if (m) {
        const n = Number(m[1].replace(/,/g, ''));
        const mult = !m[2] ? 1 : /k/i.test(m[2]) ? 1024 : 1048576;
        return n * mult;
    }
    if (text === '' || /^(queued|running|n\/a|not |when released|-|—)/i.test(text)) return null;
    return text.toLowerCase();
}

function compareKeys(a: number | string | null, b: number | string | null): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'number') return -1;
    if (typeof b === 'number') return 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function strip(table: HTMLTableElement): void {
    table.querySelectorAll<HTMLButtonElement>(`button.${BTN}`).forEach((b) => {
        const th = b.parentElement!;
        th.removeAttribute('aria-sort');
        while (b.firstChild) th.insertBefore(b.firstChild, b);
        b.remove();
    });
    const body = table.tBodies[0];
    if (body) [...body.rows].sort((a, b) => Number(a.dataset[ORIG]) - Number(b.dataset[ORIG])).forEach((r) => body.appendChild(r));
    table.classList.remove('mdweb-sortable');
}

function sortBy(table: HTMLTableElement, th: HTMLElement, i: number): void {
    const body = table.tBodies[0];
    if (!body) return;
    const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    table.querySelectorAll('th[aria-sort]').forEach((h) => h.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', dir);
    const rows = [...body.rows];
    const sign = dir === 'ascending' ? 1 : -1;
    const keys = new Map(rows.map((r) => [r, sortKey(r.cells[i])] as const));
    // In a column that holds numbers, cells without one (Queued, "vendor's limit") go last too.
    if ([...keys.values()].some((k) => typeof k === 'number')) keys.forEach((k, r) => { if (typeof k === 'string') keys.set(r, null); });
    rows.sort((x, y) => {
        const a = keys.get(x)!, b = keys.get(y)!;
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1; // blanks/Queued always last
        return compareKeys(a, b) * sign;
    });
    rows.forEach((r) => body.appendChild(r));
}

export function enhanceSortableTables(root: ParentNode, enabled: boolean): void {
    root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        const on = marker(table) ?? enabled;
        const done = table.classList.contains('mdweb-sortable');
        if (!on) { if (done || table.querySelector(`button.${BTN}`)) strip(table); return; }
        if (done) return;
        const head = table.tHead?.rows[0];
        if (!head || !table.tBodies[0]?.rows.length) return; // nothing to sort: no buttons
        [...(table.tBodies[0]?.rows || [])].forEach((r, i) => { r.dataset[ORIG] = String(i); });
        [...head.cells].forEach((th, i) => {
            const b = (th.ownerDocument || document).createElement('button');
            b.type = 'button';
            b.className = BTN;
            b.setAttribute('aria-label', `Sort by ${(th.textContent || '').trim()}`);
            while (th.firstChild) b.appendChild(th.firstChild);
            th.appendChild(b);
            b.addEventListener('click', () => sortBy(table, th, i));
        });
        table.classList.add('mdweb-sortable');
    });
}

/**
 * Wrap every post table in a scroll box (role=region, focusable) so a wide table scrolls
 * sideways inside the content column while the table keeps its table semantics.
 */
export function wrapTables(root: ParentNode): void {
    root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        if (table.parentElement?.classList.contains('mdweb-table-wrap')) return;
        const doc = table.ownerDocument || document;
        const w = doc.createElement('div');
        w.className = 'mdweb-table-wrap';
        w.setAttribute('role', 'region');
        w.setAttribute('tabindex', '0');
        const head = (table.tHead?.rows[0]?.cells[0]?.textContent || '').trim();
        w.setAttribute('aria-label', head ? `Table: ${head}` : 'Table');
        table.parentNode!.insertBefore(w, table);
        w.appendChild(table);
    });
}
