/**
 * Track #1682: words must never split mid-word in posts (Mark, 2026-11-03:
 * "fix it so words aren't broken"; on a 375px phone the table link "Sabrent"
 * wrapped as "Sabren" + "t").
 *
 * Causes: md-editor-rt ships word-break:break-all on the preview and its
 * headings; our CSS added hyphens:auto and overflow-wrap:anywhere on links and
 * code. `anywhere` shrinks a table cell's min-content to one letter, so a
 * squeezed table splits every link. Fix: word-break normal, overflow-wrap
 * break-word (only stops overflow, never changes min-content), hyphens manual,
 * and tables scroll sideways instead of squeezing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

let css = '';
beforeAll(() => {
    css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
});

const decls = (prop: string) =>
    [...css.matchAll(new RegExp(`([^{}]+)\\{[^}]*${prop}\\s*:\\s*([^;}]+)`, 'g'))].map((m) => ({
        sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
        val: m[2].trim(),
    }));

describe('no mid-word breaks in post content', () => {
    it('never uses overflow-wrap:anywhere', () => {
        expect(decls('overflow-wrap').filter((d) => d.val.startsWith('anywhere'))).toEqual([]);
    });
    it('never uses hyphens:auto', () => {
        expect(decls('(?:-webkit-)?hyphens').filter((d) => d.val.startsWith('auto'))).toEqual([]);
    });
    it('sets hyphens manual on post text', () => {
        expect(css).toMatch(/\.md-editor-preview[^{]*\{[^}]*hyphens:\s*manual\s*!important/);
    });
    it('table cells and links keep whole words (word-break normal, overflow-wrap normal, !important)', () => {
        expect(css).toMatch(/\.md-editor-preview th[^{]*\.md-editor-preview td[^{]*\{[^}]*word-break:\s*normal\s*!important[^}]*overflow-wrap:\s*normal\s*!important/);
        expect(css).toMatch(/\.md-editor-preview a[^{]*\{[^}]*overflow-wrap:\s*break-word\s*!important/);
    });
    it('wide tables scroll horizontally instead of squeezing words', () => {
        expect(css).toMatch(/\.md-editor-preview table[^{]*\{[^}]*display:\s*block[^}]*overflow-x:\s*auto/);
        // no blanket min-width: short cells must not force a narrow table to scroll
        expect(css).not.toMatch(/\.md-editor-preview th[^{]*\{[^}]*min-width/);
    });
});

describe('table stripes follow light/dark mode (no black rows in light mode)', () => {
    it('light mode: even rows light grey with dark text', () => {
        expect(css).toMatch(/html\[data-theme-mode="light"\] \.md-editor-preview table tr:nth-child\(2n\)[^{]*\{[^}]*background-color:\s*#f2f2f2\s*!important[^}]*color:\s*#1f2328\s*!important/);
    });
    it('dark mode: a dark stripe scoped to dark mode only', () => {
        expect(css).toMatch(/html\[data-theme-mode="dark"\] \.md-editor-preview table tr:nth-child\(2n\)[^{]*\{[^}]*background-color:\s*#1f242c\s*!important/);
    });
});
