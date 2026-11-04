/**
 * Track #1682: posts use the whole screen width on desktop (Mark, 2026-11-04 1:15 PM CT:
 * "in desktop.. use the entire width of the screen please"). From 1024px the article
 * shell, header, body, back link and the navbar row have no max-width cap and only
 * small side padding; tables fill the body width. Phones keep the scroll-sideways
 * table box (display:block; overflow-x:auto) from the base rules.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

let css = '';
let wide = '';
beforeAll(() => {
    css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /@media\s*\(min-width:\s*1024px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
    for (const m of css.matchAll(re)) wide += m[1];
});
const last = (block: string, sel: string, prop: string) => {
    let v: string | undefined;
    for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[1].split(',').map((s) => s.trim()).includes(sel)) continue;
        for (const d of m[2].split(';')) {
            const [k, ...rest] = d.split(':');
            if (k && k.trim() === prop) v = rest.join(':').trim();
        }
    }
    return v;
};

describe('desktop (min-width 1024px) posts are full width', () => {
    for (const sel of ['.editorial .site-header nav', '.editorial .article-shell', '.editorial .article-header',
        '.editorial .article-body', '.editorial .article-layout .article-body', '.editorial .article-back', '.editorial .article-body p', '.editorial .article-body li']) {
        it(`${sel} has max-width: none`, () => {
            expect(last(wide, sel, 'max-width')).toBe('none');
        });
    }
    const SIDE = '1.5rem'; // small side padding, the same on both sides
    for (const sel of ['.editorial .site-header nav', '.editorial .article-shell']) {
        for (const side of ['padding-left', 'padding-right']) {
            it(`${sel} ${side} is ${SIDE}`, () => {
                expect(last(wide, sel, side)).toBe(SIDE);
            });
        }
    }
    it('tables fill the body width', () => {
        expect(last(wide, '.editorial .article-body .mdweb-table-wrap > table', 'width')).toBe('100%');
    });
    it('phones keep tables in a sideways-scrolling box', () => {
        const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
        expect(base).toMatch(/\.mdweb-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
        expect(base).toMatch(/\.md-editor-preview table, table\s*\{[^}]*display:\s*block[^}]*overflow-x:\s*auto/);
    });
});
