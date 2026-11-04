/** Track #1682: post badges exist and every colour pair has >= 4.5:1 contrast. */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
const css = fs.readFileSync('src/index.css', 'utf8');
const lum = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
describe('mdweb badges', () => {
    it('links inside table cells stay inline (no line break after a link)', () => {
        expect(css).toMatch(/\.article-body td a, \.article-body th a \{ display: inline !important; \}/);
    });
    const rules = [...css.matchAll(/\.mdweb-badge\[data-badge="([\w-]+)"\]\s*\{\s*background:\s*(#[0-9a-f]{6});\s*color:\s*(#[0-9a-f]{6});/gi)];
    it('has engine and context-size variants', () => {
        const names = rules.map((r) => r[1]);
        expect(names.sort()).toEqual(['ctx-128k', 'ctx-1m', 'ctx-256k', 'ctx-32k', 'ctx-512k', 'ctx-64k', 'llamacpp', 'sglang', 'vllm']);
    });
    it('every variant has at least 4.5:1 contrast', () => {
        expect(rules.length).toBe(9);
        for (const r of rules) expect(ratio(r[2], r[3]), r[1]).toBeGreaterThanOrEqual(4.5);
    });
});
