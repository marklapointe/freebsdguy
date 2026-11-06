/**
 * Track #1682 (Mark, 2026-11-04 1:29 PM CT): post tables can render from a CSV published
 * with the post, carry a "Download CSV" link, and big tables get an "Expand" button
 * that opens a full-screen popup scaled to fit; below the 0.5 floor it scrolls instead.
 * Esc or the X closes it. Works on phones (same code path; fit uses the viewport).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseCsv, fitScale, renderCsvTables, addTableTools, isBigTable, closeTablePopup, MIN_SCALE, LIMITS } from '../src/lib/table-tools';

let root: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; document.body.style.overflow = ''; root = document.createElement('div'); document.body.appendChild(root); });

describe('parseCsv', () => {
    it('reads quoted fields, embedded commas, quotes and newlines', () => {
        expect(parseCsv('a,b\n"x, y","say ""hi"""\n"l1\nl2",3\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['l1\nl2', '3']]);
    });
    it('handles CRLF and a missing final newline', () => {
        expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    });
});

describe('fitScale', () => {
    it('shrinks a table that is wider than the screen', () => { expect(fitScale(2000, 500, 1000, 800)).toBeCloseTo(0.5); });
    it('shrinks by the tighter of width and height', () => { expect(fitScale(500, 1600, 1000, 800)).toBeCloseTo(0.5); });
    it('grows a small table, but at most 2x', () => { expect(fitScale(100, 100, 1000, 800)).toBe(2); });
    it('never returns zero or NaN for empty sizes', () => { expect(fitScale(0, 0, 1000, 800)).toBe(1); });
    it('never shrinks below the legibility floor', () => { expect(fitScale(100000, 100, 400, 800)).toBe(MIN_SCALE); });
});

describe('renderCsvTables', () => {
    it('replaces a CSV placeholder link with a table and a Download CSV link', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=t.csv" title="mdweb-csv-table">Results</a></p>';
        const fetcher = vi.fn(async () => 'Model,Engine\n[Ornith](https://example.org/o),vLLM\n');
        await renderCsvTables(root, fetcher);
        const t = root.querySelector('table')!;
        expect(t).not.toBeNull();
        expect([...t.querySelectorAll('th')].map((x) => x.textContent)).toEqual(['Model', 'Engine']);
        const a = t.querySelector('td a') as HTMLAnchorElement;
        expect(a.textContent).toBe('Ornith');
        expect(a.getAttribute('href')).toBe('https://example.org/o');
        const dl = root.querySelector('a.mdweb-csv-download') as HTMLAnchorElement;
        expect(dl.textContent).toBe('Download CSV: Results');
        expect(dl.getAttribute('href')).toBe('/api/getimage?fileName=t.csv');
        expect(dl.hasAttribute('download')).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('never turns a javascript: link into an anchor and never injects HTML', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=x.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => 'A\n[x](javascript:alert(1))\n<img src=x onerror=alert(1)>\n[y](//evil.example/p)\n');
        expect(root.querySelector('td a')).toBeNull();
        expect(root.querySelector('img')).toBeNull();
        expect(root.querySelectorAll('td')[1].textContent).toBe('<img src=x onerror=alert(1)>');
    });
    it('is idempotent: a second pass does not fetch or render again', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=x.csv" title="mdweb-csv-table">T</a></p>';
        const f = vi.fn(async () => 'A\n1\n');
        await renderCsvTables(root, f); await renderCsvTables(root, f);
        expect(f).toHaveBeenCalledTimes(1);
        expect(root.querySelectorAll('table').length).toBe(1);
    });
    it('shows an error message (no link to the failing file) when the CSV cannot be fetched', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=x.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => { throw new Error('500'); });
        expect(root.querySelector('table')).toBeNull();
        expect(root.querySelector('.mdweb-csv-error')!.textContent).toBe('The table "T" could not be loaded. Reload the page to try again.');
        expect(root.querySelector('a')).toBeNull();
    });
    it('only fetches CSVs published with the post (same origin, images dir)', async () => {
        root.innerHTML = '<p><a href="https://evil.example/x.csv" title="mdweb-csv-table">T</a></p><p><a href="/api/admin?x.csv" title="mdweb-csv-table">U</a></p>';
        const f = vi.fn(async () => 'A\n1\n');
        expect(await renderCsvTables(root, f)).toBe(0);
        expect(f).not.toHaveBeenCalled();
        expect(root.querySelector('a')!.getAttribute('title')).toBe('mdweb-csv-table');
    });
    it('refuses oversized CSVs and caps rows and columns', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=a.csv" title="mdweb-csv-table">A</a></p><p><a href="/api/getimage?fileName=b.csv" title="mdweb-csv-table">B</a></p>';
        let call = 0;
        await renderCsvTables(root, async () => (call++ === 0 ? 'é'.repeat(LIMITS.bytes / 2 + 1) : [Array(LIMITS.cols + 5).fill('h').join(','), ...Array(LIMITS.rows + 50).fill('1')].join('\n')));
        const tables = root.querySelectorAll('table');
        expect(tables.length).toBe(1);
        expect(tables[0].rows.length).toBe(LIMITS.rows + 1);
        expect(tables[0].rows[0].cells.length).toBe(LIMITS.cols);
        expect(root.querySelector('.mdweb-csv-note')!.textContent).toMatch(/first/);
        expect(tables[0].querySelector('th')!.getAttribute('scope')).toBe('col');
    });
    it('does not badge cells unless a column is marked (no hardcoded value list)', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=x.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => 'A\nconstructor\nvLLM\n');
        expect(root.querySelectorAll('.mdweb-badge').length).toBe(0);
    });
});

const big = (cols: number, rows: number) => `<div class="mdweb-table-wrap"><table><thead><tr>${'<th>h</th>'.repeat(cols)}</tr></thead><tbody>${`<tr>${'<td>1</td>'.repeat(cols)}</tr>`.repeat(rows)}</tbody></table></div>`;

describe('Expand popup', () => {
    it('only big tables get an Expand button', () => {
        root.innerHTML = big(2, 2) + big(8, 3);
        addTableTools(root);
        const btns = root.querySelectorAll('button.mdweb-table-expand');
        expect(btns.length).toBe(1);
        expect(btns[0].getAttribute('aria-label')).toBe('Expand table: Table 1, full screen');
        expect(isBigTable(root.querySelectorAll('table')[0])).toBe(false);
        expect(isBigTable(root.querySelectorAll('table')[1])).toBe(true);
    });
    it('is idempotent', () => {
        root.innerHTML = big(8, 3);
        addTableTools(root); addTableTools(root);
        expect(root.querySelectorAll('button.mdweb-table-expand').length).toBe(1);
    });
    it('opens a full-screen dialog with a copy of the table, closes with Esc and restores focus', () => {
        root.innerHTML = big(8, 3);
        addTableTools(root);
        const b = root.querySelector('button.mdweb-table-expand') as HTMLButtonElement;
        b.focus(); b.click();
        const d = document.querySelector('.mdweb-table-popup') as HTMLElement;
        expect(d).not.toBeNull();
        expect(d.getAttribute('role')).toBe('dialog');
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(d.querySelector('table')).not.toBeNull();
        expect(document.body.style.overflow).toBe('hidden');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.mdweb-table-popup')).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(document.activeElement).toBe(b);
    });
    it('Tab cycles focus between the X and links inside the table', () => {
        root.innerHTML = big(8, 3).replace('<td>1</td>', '<td><a href="/p">p</a></td>');
        addTableTools(root);
        (root.querySelector('button.mdweb-table-expand') as HTMLButtonElement).click();
        const d = document.querySelector('.mdweb-table-popup')!;
        expect(document.activeElement).toBe(d.querySelector('.mdweb-table-close'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        expect(document.activeElement).toBe(d.querySelector('td a'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        expect(document.activeElement).toBe(d.querySelector('.mdweb-table-close'));
        closeTablePopup();
        expect(document.querySelector('.mdweb-table-popup')).toBeNull();
    });
    it('closes with the X button', () => {
        root.innerHTML = big(8, 3);
        addTableTools(root);
        (root.querySelector('button.mdweb-table-expand') as HTMLButtonElement).click();
        const x = document.querySelector('.mdweb-table-popup button.mdweb-table-close') as HTMLButtonElement;
        expect(x.getAttribute('aria-label')).toBe('Close');
        x.click();
        expect(document.querySelector('.mdweb-table-popup')).toBeNull();
    });
});
