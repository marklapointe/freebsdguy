/**
 * Track #1682: the post header (date/author line, title, accent rule) and the
 * back link left-align flush with the body column (Mark, 2026-11-03: "the title
 * is indented a bit too far.. it should left justify to the rest of the
 * content"). From 1024px the body sits in the left grid column next to the
 * contents list with margin 0, so header and back link must also drop their
 * auto (centring) left margin there. Live left edges are checked after deploy
 * at 390, 768, 1280 and 1600px.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const BREAKPOINT = '1024px'; // where .article-layout becomes body + contents grid
let wide = '';
beforeAll(() => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // The layout grid and the header reset must live under the same breakpoint.
    const re = new RegExp(`@media\\s*\\(min-width:\\s*${BREAKPOINT}\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*)\\s*\\}`, 'g');
    for (const m of css.matchAll(re)) wide += m[1];
});

/** Last (winning) value of `prop` across rules for `sel` inside the wide media blocks. */
const last = (sel: string, prop: string) => {
    let v: string | undefined;
    for (const m of wide.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[1].split(',').map((s) => s.trim()).includes(sel)) continue;
        for (const d of m[2].split(';')) {
            const [k, ...rest] = d.split(':');
            if (k && k.trim() === prop) v = rest.join(':').trim();
        }
    }
    return v;
};

describe(`@media (min-width: ${BREAKPOINT}) resets header/back-link auto margins`, () => {
    it(`a min-width ${BREAKPOINT} block exists and holds the article-layout grid`, () => {
        expect(wide, `no @media (min-width: ${BREAKPOINT}) block found`).toMatch(/\.article-layout\s*\{[^}]*grid/);
    });
    for (const sel of ['.editorial .article-header', '.editorial .article-back']) {
        for (const prop of ['margin-left', 'margin-right']) {
            it(`${sel}: ${prop} is exactly 0`, () => {
                expect(last(sel, prop)).toBe('0');
            });
        }
    }
});
