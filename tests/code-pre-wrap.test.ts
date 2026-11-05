/**
 * Track #1682 (Mark 2026-11-04 11:57 PM CT): long single-line code blocks wrap
 * instead of scrolling sideways. Generic theme rule for every post.
 * A 300-char line must fit at 390px and 1600px; multi-line blocks keep breaks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
const LONG = 'x'.repeat(300);
const MULTI = 'line one\nline two\nline three';

describe('code block pre-wrap (theme)', () => {
    it('sets pre-wrap + overflow-wrap on preview and editorial pre/code', () => {
        // Strip comments so we only match live rules.
        const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(live).toMatch(/\.md-editor-preview pre,\s*\.md-editor-preview pre code,\s*\.editorial \.article-body pre,\s*\.editorial \.article-body pre code\s*\{[^}]*white-space:\s*pre-wrap(?:\s*!important)?/);
        expect(live).toMatch(/\.md-editor-preview pre,\s*\.md-editor-preview pre code,\s*\.editorial \.article-body pre,\s*\.editorial \.article-body pre code\s*\{[^}]*overflow-wrap:\s*anywhere(?:\s*!important)?/);
    });

    describe('layout at phone and desktop widths', () => {
        let browser: Browser;
        beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 60_000);
        afterAll(async () => { await browser?.close(); });

        async function measure(width: number) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            const html = `<!doctype html><html class="editorial" data-theme="dark"><head>
              <style>${css}</style></head>
              <body><div class="article-body md-editor-preview">
                <pre id="long"><code>${LONG}</code></pre>
                <pre id="multi"><code>${MULTI}</code></pre>
              </div></body></html>`;
            await page.setContent(html, { waitUntil: 'load' });
            const long = await page.evaluate(() => {
                const el = document.getElementById('long')!;
                const code = el.querySelector('code') || el;
                return {
                  sw: el.scrollWidth, cw: el.clientWidth,
                  ws: getComputedStyle(el).whiteSpace,
                  codeOw: getComputedStyle(code).overflowWrap,
                };
            });
            const multi = await page.evaluate(() => {
                const el = document.getElementById('multi')!;
                const lines = el.innerText.split('\n');
                return { lines, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) };
            });
            await page.close();
            return { long, multi };
        }

        for (const width of [390, 1600]) {
            it(`a 300-char line fits without horizontal scroll at ${width}px`, async () => {
                const { long } = await measure(width);
                expect(long.ws).toMatch(/pre-wrap/);
                expect(long.codeOw).toMatch(/anywhere/);
                expect(long.sw, `scrollWidth ${long.sw} > clientWidth ${long.cw}`).toBeLessThanOrEqual(long.cw + 1);
            }, 60_000);
        }

        it('a multi-line pre keeps its line breaks', async () => {
            const { multi } = await measure(390);
            expect(multi.lines.length).toBeGreaterThanOrEqual(3);
            // At least ~3 lines tall (allow fractional line-height).
            expect(multi.h).toBeGreaterThanOrEqual(multi.lh * 2.5);
        }, 60_000);
    });
});
