/**
 * Track #1682 slice 1 — CSS fixes for post rendering:
 *   1. word-break / overflow-wrap / hyphens on body + post text
 *   2. md-preview background transparent + inherits theme text colour
 *   3. list bullets restored (disc/decimal) inside previews + .prose
 *   4. no horizontal scroll: pre/table scroll, images fit
 *   5. mobile layout: full-width content column, nav overflow safety
 *
 * These are asserted by inspecting src/index.css (the library ships its own
 * dark background + break-all that we must override).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const cssPath = path.resolve(process.cwd(), 'src/index.css');
let css = '';
beforeAll(() => {
    css = fs.readFileSync(cssPath, 'utf8');
});

describe('index.css: post text wrapping', () => {
    it('uses overflow-wrap / word-break normal / hyphens auto for body and preview', () => {
        expect(css).toMatch(/overflow-wrap:\s*break-word/);
        // 'anywhere' lets flex/min-content boxes split ordinary words (D): only for links/code.
        const anywhereSelectors = [...css.matchAll(/([^{}]+)\{[^}]*overflow-wrap:\s*anywhere/g)].map((m) => m[1].trim());
        for (const sel of anywhereSelectors) {
            for (const part of sel.split(',')) expect(part.trim()).toMatch(/(^|\s)(a|code)$/);
        }
        expect(css).toMatch(/word-break:\s*normal/);
        expect(css).toMatch(/hyphens:\s*auto/);
        // break-all must NOT leak into post / preview rendering
        expect(css).not.toMatch(/word-break:\s*break-all/);
    });

    it('overrides md-editor-rt break-all (which loads after index.css) with !important', () => {
        expect(css).toMatch(/\.md-editor-preview,\s*\.md-editor-html[^{]*\.md-editor-preview h6\s*\{[^}]*word-break:\s*normal\s*!important/);
    });

    it('applies wrapping to the md-preview block', () => {
        expect(css).toMatch(/\.md-editor-preview\b[^{]*\{[^}]*overflow-wrap/);
    });
});

describe('index.css: md-preview background + list style', () => {
    it('makes the preview background transparent and inherit the theme text colour', () => {
        expect(css).toMatch(/\.md-editor-preview-wrapper/);
        expect(css).toMatch(/\.md-editor\b/);
        expect(css).toMatch(/background-color:\s*transparent/);
        expect(css).toMatch(/color:\s*var\(--color-text\)|color:\s*inherit/);
    });

    it('restores list bullets (disc / decimal) in previews and .prose', () => {
        expect(css).toMatch(/list-style:\s*disc/);
        expect(css).toMatch(/list-style:\s*decimal/);
        expect(css).toMatch(/\.md-editor-preview\s*ol,\s*\.md-editor-preview\s*ul/);
        expect(css).toMatch(/\.prose\s*ul|\.prose\s*ol/);
    });

    it('gives lists padding on the start side', () => {
        expect(css).toMatch(/padding-inline-start:/);
    });
});

describe('index.css: scroll + responsive', () => {
    it('scrolls pre and table horizontally instead of clipping, and images fit', () => {
        expect(css).toMatch(/pre\s*\{[^}]*overflow-x:\s*auto/);
        expect(css).toMatch(/table\s*\{[^}]*overflow-x:\s*auto/);
        expect(css).toMatch(/img\s*\{[^}]*max-width:\s*100%/);
    });

    it('caps text column width on desktop (~70ch)', () => {
        expect(css).toMatch(/max-width:\s*70ch/);
    });

    it('mobile: full-width content column with ~1rem padding, no nav overflow', () => {
        // a phone breakpoint (covers 390px) that pads the content column by ~1rem
        const m = css.match(/@media[^{]*max-width:\s*(\d+)px\)\s*\{[\s\S]{0,1200}?padding(?:-inline|-left|-right)?:\s*[^;]*1rem/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    });
});
describe('index.css: review fix — long site title may shrink', () => {
    it('.site-title has min-width: 0', () => {
        expect(css).toMatch(/\.site-title\s*\{[^}]*min-width:\s*0/);
    });
});
