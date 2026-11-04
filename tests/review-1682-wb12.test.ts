/**
 * Track #1682 mdweb 1.1.0_12: review findings on the _11 table tools (review-upstream.log).
 *  - /api/getimage is confined server-side to plain upload files (no separators, no symlinks
 *    out, only image/CSV types, never the metadata manifest).
 *  - CSV tables have an accessible name (caption) and a download link naming its table.
 *  - The popup is a real modal: background inert, labelled by the table title, Esc hint,
 *    48px close button, focus restored (or moved to the heading if the opener is gone).
 *  - A missing CSV gives an error message without a link back to the failing file.
 *  - The popup never shrinks below 0.5; below that it scrolls.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index';
import { loadConfig, configPath } from '../server/lib/config';
import { parseCsv, fitScale, renderCsvTables, addTableTools, closeTablePopup, isBigTable, MIN_SCALE } from '../src/lib/table-tools';

describe('/api/getimage confinement', () => {
    const config = loadConfig();
    const postsDir = path.resolve(path.dirname(configPath()), config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const made: string[] = []; let manifest: Buffer | null = null;
    const put = (f: string, body: string) => { fs.writeFileSync(f, body); made.push(f); };
    beforeAll(() => {
        fs.mkdirSync(imagesDir, { recursive: true });
        const m = path.join(imagesDir, 'metadata.json');
        manifest = fs.existsSync(m) ? fs.readFileSync(m) : null;
    });
    afterAll(() => {
        for (const f of made) { try { fs.unlinkSync(f); } catch { /* gone */ } }
        fs.rmSync(path.join(imagesDir, 'wb12sub'), { recursive: true, force: true });
        const m = path.join(imagesDir, 'metadata.json');
        if (manifest) fs.writeFileSync(m, manifest); else { try { fs.unlinkSync(m); } catch { /* none */ } }
    });

    it('serves a CSV upload as text/csv with nosniff', async () => {
        put(path.join(imagesDir, 'wb12-ok.csv'), 'A,B\n1,2\n');
        const r = await request(app).get('/api/getimage?fileName=wb12-ok.csv');
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toMatch(/text\/csv/);
        expect(r.headers['x-content-type-options']).toBe('nosniff');
    });
    it('refuses a symlink in uploads that points outside it', async () => {
        const outside = path.join(postsDir, 'wb12-secret.csv');
        put(outside, 'secret\n');
        const link = path.join(imagesDir, 'wb12-link.csv');
        try { fs.unlinkSync(link); } catch { /* none */ }
        fs.symlinkSync(outside, link); made.push(link);
        const r = await request(app).get('/api/getimage?fileName=wb12-link.csv');
        expect(r.status).toBe(404);
        expect(r.text).not.toContain('secret');
    });
    it('refuses separators, encoded separators and dot names with 403, even when the target exists', async () => {
        put(path.join(postsDir, 'wb12-up.csv'), 'secret-up\n');
        put(path.join(imagesDir, '.wb12-hidden.png'), 'secret-dot');
        fs.mkdirSync(path.join(imagesDir, 'wb12sub'), { recursive: true });
        put(path.join(imagesDir, 'wb12sub', 'x.png'), 'secret-sub');
        for (const n of ['..%2Fwb12-up.csv', '../wb12-up.csv', 'wb12sub%2Fx.png', 'wb12sub%5Cx.png', '%2e%2e%2Fwb12-up.csv', '.wb12-hidden.png']) {
            const r = await request(app).get(`/api/getimage?fileName=${n}`);
            expect(r.status, n).toBe(403);
            expect(r.text).not.toMatch(/secret/);
        }
    });
    it('refuses a symlink inside uploads even when it points at another upload (no alias for the manifest)', async () => {
        put(path.join(imagesDir, 'metadata.json'), '{"secret":1}');
        const link = path.join(imagesDir, 'wb12-alias.csv');
        try { fs.unlinkSync(link); } catch { /* none */ }
        fs.symlinkSync(path.join(imagesDir, 'metadata.json'), link); made.push(link);
        const r = await request(app).get('/api/getimage?fileName=wb12-alias.csv');
        expect(r.status).toBe(404);
        expect(r.text).not.toMatch(/secret/);
    });
    it('refuses a hard-link alias of another file', async () => {
        put(path.join(imagesDir, 'wb12-orig.csv'), 'secret-hl\n');
        const hl = path.join(imagesDir, 'wb12-hl.csv');
        try { fs.unlinkSync(hl); } catch { /* none */ }
        fs.linkSync(path.join(imagesDir, 'wb12-orig.csv'), hl); made.push(hl);
        const r = await request(app).get('/api/getimage?fileName=wb12-hl.csv');
        expect(r.status).toBe(404);
    });
    it('a FIFO named like an upload does not hang the server', async () => {
        const { execFileSync } = await import('child_process');
        const f = path.join(imagesDir, 'wb12-fifo.csv');
        try { fs.unlinkSync(f); } catch { /* none */ }
        execFileSync('mkfifo', [f]); made.push(f);
        const r = await request(app).get('/api/getimage?fileName=wb12-fifo.csv').timeout(3000);
        expect(r.status).toBe(404);
    });
    it('serves SVG with a sandboxing CSP so a directly opened SVG cannot run script here', async () => {
        put(path.join(imagesDir, 'wb12.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const r = await request(app).get('/api/getimage?fileName=wb12.svg');
        expect(r.status).toBe(200);
        expect(r.headers['content-security-policy']).toMatch(/sandbox/);
    });
    it('does not serve the metadata manifest or other non-upload types', async () => {
        put(path.join(imagesDir, 'metadata.json'), '{"x":1}');
        put(path.join(imagesDir, 'wb12.html'), '<script>1</script>');
        expect((await request(app).get('/api/getimage?fileName=metadata.json')).status).toBe(404);
        expect((await request(app).get('/api/getimage?fileName=wb12.html')).status).toBe(404);
    });
});

let root: HTMLElement;
const reset = () => { document.body.innerHTML = ''; root = document.createElement('main'); document.body.appendChild(root); };

describe('CSV table accessibility', () => {
    beforeEach(reset);
    it('names the table by its link text and gives each download link distinct text', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=a.csv" title="mdweb-csv-table">Results side by side</a></p><p><a href="/api/getimage?fileName=b.csv" title="mdweb-csv-table">Context capacity</a></p>';
        await renderCsvTables(root, async () => 'A,B\n1,2\n');
        const t = root.querySelectorAll('table');
        expect(t[0].caption!.textContent).toBe('Results side by side');
        expect(t[0].getAttribute('aria-labelledby')).toBe(t[0].caption!.id);
        const dl = [...root.querySelectorAll('a.mdweb-csv-download')].map((a) => a.textContent);
        expect(dl).toEqual(['Download CSV: Results side by side', 'Download CSV: Context capacity']);
    });
    it('a missing CSV says so and does not link the failing file', async () => {
        root.innerHTML = '<p><a href="/api/getimage?fileName=gone.csv" title="mdweb-csv-table">T</a></p>';
        await renderCsvTables(root, async () => { throw new Error('404'); });
        expect(root.querySelector('a[href*="gone.csv"]')).toBeNull();
        expect(root.querySelector('.mdweb-csv-error')!.textContent).toMatch(/T.*could not be found/);
    });
});

describe('parse and size fixes', () => {
    it('keeps a single empty quoted field', () => { expect(parseCsv('""')).toEqual([['']]); });
    it('counts columns across rows, with colspan', () => {
        reset();
        root.innerHTML = `<table><tr><th colspan="8">x</th></tr><tr>${'<td>1</td>'.repeat(8)}</tr></table>`;
        expect(isBigTable(root.querySelector('table')!)).toBe(true);
    });
    it('the popup scale floor is readable (0.5)', () => {
        expect(MIN_SCALE).toBe(0.5);
        expect(fitScale(100000, 100, 400, 800)).toBe(0.5);
    });
});

const big = (title = '') => `${title ? `<h2 id="h">${title}</h2>` : ''}<div class="mdweb-table-wrap"><table><thead><tr>${'<th>h</th>'.repeat(8)}</tr></thead><tbody>${`<tr>${'<td>1</td>'.repeat(8)}</tr>`.repeat(3)}</tbody></table></div>`;

describe('modal popup', () => {
    beforeEach(reset);
    it('is labelled by the table title, makes the page inert and shows an Esc hint', () => {
        root.innerHTML = big('Limits and sweet spot');
        addTableTools(root);
        (root.querySelector('button.mdweb-table-expand') as HTMLButtonElement).click();
        const d = document.querySelector('.mdweb-table-popup') as HTMLElement;
        const lab = document.getElementById(d.getAttribute('aria-labelledby')!)!;
        expect(lab.textContent).toBe('Limits and sweet spot');
        expect(d.hasAttribute('aria-label')).toBe(false);
        expect(root.hasAttribute('inert')).toBe(true);
        expect(d.hasAttribute('inert')).toBe(false);
        expect(d.textContent).toMatch(/Esc to close/);
        expect(document.activeElement).toBe(d.querySelector('.mdweb-table-close'));
        closeTablePopup();
        expect(root.hasAttribute('inert')).toBe(false);
    });
    it('moves focus to the post heading when the opener is gone', () => {
        document.body.insertAdjacentHTML('afterbegin', '<h1 tabindex="-1" class="article-title">Post</h1>');
        root.innerHTML = big('T');
        addTableTools(root);
        const b = root.querySelector('button.mdweb-table-expand') as HTMLButtonElement;
        b.click(); b.remove();
        closeTablePopup();
        expect(document.activeElement?.classList.contains('article-title')).toBe(true);
    });
    it('focus fallback prefers the post title over an earlier site h1', () => {
        document.body.insertAdjacentHTML('afterbegin', '<h1>Site</h1><h1 class="article-title">Post</h1>');
        root.innerHTML = big('T');
        addTableTools(root);
        const b = root.querySelector('button.mdweb-table-expand') as HTMLButtonElement;
        b.click(); b.remove(); closeTablePopup();
        expect(document.activeElement?.textContent).toBe('Post');
    });
    it('two tables under one heading get distinct titles', () => {
        root.innerHTML = big('Same') + big().replace('<div', '<div');
        addTableTools(root);
        const labels = [...root.querySelectorAll('button.mdweb-table-expand')].map((b) => b.getAttribute('aria-label'));
        expect(labels).toEqual(['Expand table: Same, full screen', 'Expand table: Same (2), full screen']);
    });
});

describe('popup CSS contract', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    it('close button is at least 48x48 CSS px', () => {
        const rule = /\.mdweb-table-close \{([^}]*)\}/.exec(css)![1];
        expect(rule).toMatch(/width: 48px/); expect(rule).toMatch(/height: 48px/);
    });
    it('the below-floor scroll state really scrolls', () => {
        expect(/\.mdweb-table-popup--scroll \{[^}]*overflow: auto/.test(css)).toBe(true);
    });
});
