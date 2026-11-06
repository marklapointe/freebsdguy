/** Track #1682: post badges exist and every colour pair has >= 4.5:1 contrast.
 *  Colours are theme-only; the renderer never hardcodes a value list. */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
const css = fs.readFileSync('src/index.css', 'utf8');
const lum = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
describe('mdweb badges', () => {
    it('links inside table cells stay inline (no line break after a link)', () => {
        expect(css).toMatch(/\.article-body td a, \.article-body th a \{ display: inline !important; \}/);
    });
    const expected = [
        'vllm', 'sglang', 'llamacpp', 'tensorfold', 'tandemllm', 'ollama',
        '32k', '64k', '128k', '256k', '512k', '1m',
        'ctx-32k', 'ctx-64k', 'ctx-128k', 'ctx-256k', 'ctx-512k', 'ctx-1m',
    ];
    const pairs = [...css.matchAll(/\.mdweb-badge\[data-badge="([\w-]+)"\][^{]*\{\s*background:\s*(#[0-9a-f]{6});\s*color:\s*(#[0-9a-f]{6});/gi)];
    const named = new Set(pairs.map((r) => r[1]));
    it('colours every shipped slug via .mdweb-badge[data-badge=…]', () => {
        for (const n of expected) expect(named.has(n), n).toBe(true);
    });
    it('every coloured variant has at least 4.5:1 contrast', () => {
        expect(pairs.length).toBe(expected.length);
        for (const r of pairs) expect(ratio(r[2], r[3]), r[1]).toBeGreaterThanOrEqual(4.5);
    });
    it('notes summary swaps Show notes / Hide notes with details[open] (no JS)', () => {
        expect(css).toMatch(/\.mdweb-notes > summary\.mdweb-collapse-toggle::before\s*\{\s*content:\s*"Show notes";\s*\}/);
        expect(css).toMatch(/\.mdweb-notes\[open\] > summary\.mdweb-collapse-toggle::before\s*\{\s*content:\s*"Hide notes";\s*\}/);
    });
});
