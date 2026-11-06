/**
 * Track #1682 (Mark 2026-11-04 11:38 PM CT): CSV/markdown table badges are declarative.
 * A column is marked via data-mdweb-badge (comma-separated header names; optional :sort).
 * The renderer slugs the cell text into data-badge; theme CSS colours the slug.
 * No hardcoded engine/value lists in the renderer. NA/empty stay plain.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseBadgeSpec, badgeSlug, isPlainBadgeValue, decorateBadgeColumns,
    tableFromCsv, renderCsvTables, applyBadgeColumns,
} from '../src/lib/table-tools';

let root: HTMLElement;
beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

describe('declarative badge columns (abstract)', () => {
    it('parses a badge column spec without knowing any engine names', () => {
        expect(parseBadgeSpec('Engine,Status:sort')).toEqual([
            { name: 'Engine' },
            { name: 'Status', sort: true },
        ]);
        expect(parseBadgeSpec('  Foo , Bar :sort , ')).toEqual([
            { name: 'Foo' },
            { name: 'Bar', sort: true },
        ]);
    });

    it('slugs any cell value the same way (no special-case map)', () => {
        expect(badgeSlug('vLLM')).toBe('vllm');
        expect(badgeSlug('llama.cpp')).toBe('llamacpp');
        expect(badgeSlug('TensorFold')).toBe('tensorfold');
        expect(badgeSlug('TandemLLM')).toBe('tandemllm');
        expect(badgeSlug('Ollama')).toBe('ollama');
        expect(badgeSlug('128K')).toBe('128k');
        expect(badgeSlug('1M')).toBe('1m');
    });

    it('treats NA and empty as plain (not badges)', () => {
        expect(isPlainBadgeValue('NA')).toBe(true);
        expect(isPlainBadgeValue('')).toBe(true);
        expect(isPlainBadgeValue('—')).toBe(true);
        expect(isPlainBadgeValue('vLLM')).toBe(false);
    });

    it('does not badge any cell when no column is marked', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=t.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => 'Engine\nvLLM\nSGLang\nOllama\n');
        expect(root.querySelectorAll('.mdweb-badge').length).toBe(0);
    });

    it('badges every non-plain cell in a marked column, including unknown values', async () => {
        root.innerHTML = '<p data-mdweb-badge="Engine"></p><p><a href="/api/getimage?fileName=t.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => 'Model,Engine\nA,vLLM\nB,Ollama\nC,BrandNewEngine\nD,NA\n');
        const badges = [...root.querySelectorAll('.mdweb-badge')].map((s) => [
            (s as HTMLElement).dataset.badge, s.textContent,
        ]);
        expect(badges).toEqual([
            ['vllm', 'vLLM'],
            ['ollama', 'Ollama'],
            ['brandnewengine', 'BrandNewEngine'],
        ]);
        // NA stayed plain text in its cell
        const engineCells = [...root.querySelectorAll('tbody td:nth-child(2)')].map((c) => c.textContent);
        expect(engineCells).toContain('NA');
        expect(root.querySelector('[data-badge="na"]')).toBeNull();
    });

    it('reads data-mdweb-badge from the CSV placeholder link itself', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=t.csv" title="mdweb-csv-table" data-mdweb-badge="Engine">T</a></p>';
        await renderCsvTables(root, async () => 'Engine\nTensorFold\n');
        expect(root.querySelector('.mdweb-badge')!.getAttribute('data-badge')).toBe('tensorfold');
    });

    it('adds data-sort from a :sort column without hardcoding the header name', () => {
        const t = tableFromCsv(
            [['Limit'], ['128K'], ['131072']],
            'L',
            parseBadgeSpec('Limit:sort'),
        );
        const spans = [...t.querySelectorAll('.mdweb-badge')] as HTMLElement[];
        expect(spans.map((s) => [s.dataset.badge, s.dataset.sort, s.textContent])).toEqual([
            ['128k', '131072', '128K'],
            ['131072', '131072', '131072'],
        ]);
    });

    it('applyBadgeColumns badges a markdown table from a preceding marker', () => {
        root.innerHTML = `<p data-mdweb-badge="Engine"></p>
          <table><thead><tr><th>Model</th><th>Engine</th></tr></thead>
          <tbody><tr><td>A</td><td>SGLang</td></tr><tr><td>B</td><td>NA</td></tr></tbody></table>`;
        expect(applyBadgeColumns(root)).toBe(1);
        expect(root.querySelector('.mdweb-badge')!.getAttribute('data-badge')).toBe('sglang');
        expect(root.querySelectorAll('.mdweb-badge').length).toBe(1);
    });

    it('source has no hardcoded engine value map', async () => {
        const src = await import('fs').then((fs) => fs.readFileSync('src/lib/table-tools.ts', 'utf8'));
        expect(src).not.toMatch(/new Map\s*<\s*string\s*,\s*string\s*>\s*\(\s*\[\s*\[\s*['"]vLLM['"]/);
        expect(src).not.toMatch(/ENGINE\s*=/);
    });
});

    it('does not turn a header cell into a badge when the table has no thead', () => {
        const t = document.createElement('table');
        t.innerHTML = '<tr><th>Engine</th></tr><tr><td>vLLM</td></tr>';
        root.appendChild(t);
        const n = decorateBadgeColumns(t, parseBadgeSpec('Engine'));
        expect(n).toBe(1);
        expect(t.querySelector('th .mdweb-badge')).toBeNull();
        expect(t.querySelector('td .mdweb-badge')!.getAttribute('data-badge')).toBe('vllm');
    });

    it('does not badge an earlier CSV table from a later marker', async () => {
        root.innerHTML = `
          <p data-mdweb-badge="Engine"></p>
          <p><a href="/api/getimage?fileName=a.csv" title="mdweb-csv-table">A</a></p>
          <p data-mdweb-badge="Status"></p>
          <p><a href="/api/getimage?fileName=b.csv" title="mdweb-csv-table">B</a></p>`;
        let n = 0;
        await renderCsvTables(root, async (url) => {
            n++;
            return n === 1 ? 'Engine\nvLLM\n' : 'Status\nDone\n';
        });
        const tables = [...root.querySelectorAll('table')];
        expect(tables.length).toBe(2);
        expect(tables[0].querySelector('[data-badge="vllm"]')).not.toBeNull();
        expect(tables[0].querySelector('[data-badge="done"]')).toBeNull();
        expect(tables[1].querySelector('[data-badge="done"]')).not.toBeNull();
    });

