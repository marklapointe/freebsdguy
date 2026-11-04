/**
 * Track #1682 (Mark, 2026-11-03): sortable post tables are OPTIONAL.
 * Site config `tableSort` (default off) -> post front matter `tablesort` overrides
 * -> an element right before a table with data-mdweb-sort="on|off" overrides both.
 * Progressive enhancement: without JS the table renders in authored order.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enhanceSortableTables, resolveTableSort, wrapTables } from '../src/lib/table-sort';
import { asFlag } from '../server/lib/flag';
import { sanitizeConfig } from '../server/lib/config.ts';
import { PublicConfigBuilder } from '../server/lib/public-config.ts';

const table = (rows: string[][]) =>
    `<table><thead><tr><th>Name</th><th>Size</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
let root: HTMLElement;
beforeEach(() => { root = document.createElement('div'); document.body.innerHTML = ''; document.body.appendChild(root); });
const col = (i: number) => [...root.querySelectorAll('tbody tr')].map((tr) => tr.children[i].textContent);

describe('resolveTableSort', () => {
    it('defaults off; front matter overrides the site setting', () => {
        expect(resolveTableSort(undefined, undefined)).toBe(false);
        expect(resolveTableSort(true, undefined)).toBe(true);
        expect(resolveTableSort(true, false)).toBe(false);
        expect(resolveTableSort(false, true)).toBe(true);
        expect(resolveTableSort(false, 'true')).toBe(true);
        expect(resolveTableSort(true, 'off')).toBe(false);
        expect(resolveTableSort(false, 'banana')).toBe(false);
    });
});

describe('enhanceSortableTables', () => {
    it('does nothing when off and no table opts in', () => {
        root.innerHTML = table([['b', '2'], ['a', '1']]);
        enhanceSortableTables(root, false);
        expect(root.querySelector('th button')).toBeNull();
        expect(col(0)).toEqual(['b', 'a']);
    });
    it('adds header buttons and sorts asc then desc, numbers numerically', () => {
        root.innerHTML = table([['b', '10'], ['a', '9'], ['c', '100']]);
        enhanceSortableTables(root, true);
        const b = root.querySelectorAll<HTMLButtonElement>('th button');
        expect(b.length).toBe(2);
        b[1].click();
        expect(col(1)).toEqual(['9', '10', '100']);
        expect(b[1].closest('th')!.getAttribute('aria-sort')).toBe('ascending');
        b[1].click();
        expect(col(1)).toEqual(['100', '10', '9']);
        expect(b[1].closest('th')!.getAttribute('aria-sort')).toBe('descending');
        b[0].click();
        expect(col(0)).toEqual(['a', 'b', 'c']);
        expect(b[1].closest('th')!.hasAttribute('aria-sort')).toBe(false);
    });
    it('per-table marker opts a table in when the post is off, or out when on', () => {
        root.innerHTML = `<p data-mdweb-sort="on"></p>${table([['b', '1']])}<p data-mdweb-sort="off"></p>${table([['a', '1']])}`;
        enhanceSortableTables(root, false);
        const t = root.querySelectorAll('table');
        expect(t[0].querySelector('th button')).not.toBeNull();
        expect(t[1].querySelector('th button')).toBeNull();
        root.innerHTML = `<p data-mdweb-sort="off"></p>${table([['b', '1']])}${table([['a', '1']])}`;
        enhanceSortableTables(root, true);
        const u = root.querySelectorAll('table');
        expect(u[0].querySelector('th button')).toBeNull();
        expect(u[1].querySelector('th button')).not.toBeNull();
    });
    it('is idempotent and removes buttons when turned off', () => {
        root.innerHTML = table([['b', '1']]);
        enhanceSortableTables(root, true);
        enhanceSortableTables(root, true);
        expect(root.querySelectorAll('th button').length).toBe(2);
        enhanceSortableTables(root, false);
        expect(root.querySelectorAll('th button').length).toBe(0);
        expect(root.querySelector('th')!.textContent).toBe('Name');
    });
});

describe('token-count sorting', () => {
    it('parses 128K, 262,144 and 1M as numbers and puts Queued / Not supported last both ways', () => {
        root.innerHTML = table([['a', '1M'], ['b', 'Queued'], ['c', '128K'], ['d', '262,144'], ['e', "vendor's own limit"], ['f', '5 at 128K']]);
        enhanceSortableTables(root, true);
        const b = root.querySelectorAll<HTMLButtonElement>('th button')[1];
        b.click();
        expect(col(0).slice(0, 4)).toEqual(['f', 'c', 'd', 'a']);
        expect(col(0).slice(4).sort()).toEqual(['b', 'e']);
        b.click();
        expect(col(0).slice(0, 4)).toEqual(['a', 'd', 'c', 'f']);
        expect(col(0).slice(4).sort()).toEqual(['b', 'e']);
    });
    it('a data-sort attribute on the cell or inside it wins', () => {
        root.innerHTML = `<table><thead><tr><th>N</th><th>V</th></tr></thead><tbody><tr><td>x</td><td data-sort="3">big</td></tr><tr><td>y</td><td><span data-sort="1"></span>huge</td></tr></tbody></table>`;
        enhanceSortableTables(root, true);
        root.querySelectorAll<HTMLButtonElement>('th button')[1].click();
        expect(col(0)).toEqual(['y', 'x']);
    });
});

describe('review fixes', () => {
    it('asFlag accepts 1/0 numbers and rejects junk', () => {
        expect(asFlag(1)).toBe(true); expect(asFlag(0)).toBe(false); expect(asFlag('YES')).toBe(true); expect(asFlag(2)).toBeUndefined();
    });
    it('uses the first number anywhere in a cell', () => {
        root.innerHTML = table([['a', 'max 1M'], ['b', 'limit: 128K'], ['c', 'Queued']]);
        enhanceSortableTables(root, true);
        root.querySelectorAll<HTMLButtonElement>('th button')[1].click();
        expect(col(0)).toEqual(['b', 'a', 'c']);
    });
    it('turning sorting off restores the authored order', () => {
        root.innerHTML = table([['b', '2'], ['a', '1'], ['c', '3']]);
        enhanceSortableTables(root, true);
        root.querySelectorAll<HTMLButtonElement>('th button')[0].click();
        expect(col(0)).toEqual(['a', 'b', 'c']);
        enhanceSortableTables(root, false);
        expect(col(0)).toEqual(['b', 'a', 'c']);
    });
    it('buttons have a "Sort by" name', () => {
        root.innerHTML = '<table><thead><tr><th>Size</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
        enhanceSortableTables(root, true);
        const b = root.querySelector('th button') as HTMLButtonElement;
        expect(b.getAttribute('aria-label')).toBe('Sort by Size');
    });
    it('wrapTables puts each table in one focusable scroll region; markers still apply', () => {
        root.innerHTML = `<p data-mdweb-sort="off"></p>${table([['a', '1']])}`;
        wrapTables(root); wrapTables(root);
        const w = root.querySelectorAll('.mdweb-table-wrap');
        expect(w.length).toBe(1);
        expect(w[0].getAttribute('role')).toBe('region');
        expect(w[0].getAttribute('tabindex')).toBe('0');
        expect(w[0].getAttribute('aria-label')).toBe('Table: Name');
        enhanceSortableTables(root, true);
        expect(root.querySelector('th button')).toBeNull();
    });
});

describe('config: tableSort', () => {
    it('defaults off and is exposed in public config', () => {
        const { config } = sanitizeConfig({});
        expect(!!config.tableSort).toBe(false);
        expect(PublicConfigBuilder.from(config).build().tableSort).toBe(false);
        const on = sanitizeConfig({ tableSort: true }).config;
        expect(PublicConfigBuilder.from(on).build().tableSort).toBe(true);
        expect(sanitizeConfig({ tableSort: 'on' }).config.tableSort).toBe(true);
        const bad = sanitizeConfig({ tableSort: 'maybe' });
        expect(bad.config.tableSort).toBeUndefined();
        expect(bad.warnings.some((w) => /tableSort/.test(w))).toBe(true);
    });
    it('adds no sort buttons to a table with no body rows', () => {
        const d = document.createElement('div');
        d.innerHTML = '<table><thead><tr><th>A</th></tr></thead></table>';
        enhanceSortableTables(d, true);
        expect(d.querySelector('button')).toBeNull();
    });
});
