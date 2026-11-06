/**
 * Track #1682: every post table cell lines up top-left (Mark, 2026-11-03:
 * "for tables cells ; justify at the top and to the left"). md-editor-rt and
 * markdown column alignment (`|:---:|`, inline styles) can centre cells; post
 * tables must not, on every surface posts render into. md-editor-rt ships no
 * !important cell alignment, so our !important rule wins the cascade.
 * Computed styles are checked on the live site after deploy (390px and 1280px).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SURFACES = ['.md-editor-preview', '.md-editor-html', '.prose', '.editorial .article-body'];

type Rule = { sels: string[]; body: string };
let rules: Rule[] = [];
beforeAll(() => {
    let css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Unwrap at-rule blocks (@media, @supports ...) so nested rules are seen as ordinary rules.
    css = css.replace(/@[a-z-]+[^{;]*\{/gi, '');
    rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        sels: m[1].split(',').map((s) => s.trim()).filter(Boolean),
        body: m[2],
    }));
});

const has = (sel: string, decl: RegExp) => rules.some((r) => r.sels.includes(sel) && decl.test(r.body));
const isPostCell = (sel: string) => SURFACES.some((s) => sel.startsWith(s + ' ') || sel.startsWith('html') && sel.includes(s)) && /\b(th|td)\b/.test(sel);

describe('post table cells align top-left', () => {
    for (const surface of SURFACES) {
        for (const cell of ['th', 'td']) {
            it(`${surface} ${cell}: vertical-align top !important`, () => {
                expect(has(`${surface} ${cell}`, /vertical-align:\s*top\s*!important/)).toBe(true);
            });
            it(`${surface} ${cell}: text-align left !important`, () => {
                expect(has(`${surface} ${cell}`, /text-align:\s*left\s*!important/)).toBe(true);
            });
        }
    }
    it('no post-surface rule (including inside @media) centres, right-aligns or middle-aligns cells', () => {
        const bad = rules.filter((r) => r.sels.some(isPostCell) &&
            (/text-align:\s*(center|right)/.test(r.body) || /vertical-align:\s*(middle|bottom)/.test(r.body)));
        expect(bad).toEqual([]);
    });
});
