// Usage: node scripts/check-no-word-breaks.mjs <post-url> <screenshot.png> [css-override]
// 375px viewport; prints words split across lines in post text and tables (Track #1682).
import { chromium } from '@playwright/test';
const url = process.argv[2];
if (!url || !process.argv[3]) { console.error('usage: node scripts/check-no-word-breaks.mjs <published-post-url> <screenshot.png> [css-override]\nPASS when no word in the post (text, headings, tables) is split across two lines at 375px.'); process.exit(2); }
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
if (process.argv[4]) { const fs = await import('fs'); const body = fs.readFileSync(process.argv[4]); await p.route('**/assets/*.css', r => r.fulfill({ body, contentType: 'text/css' })); }
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForSelector('.md-editor-preview', { timeout: 20000 }).catch(() => { console.error(`no post content (.md-editor-preview) at ${url}`); process.exit(2); });
const r = await p.evaluate(() => {
  const split = []; let words = 0;
  for (const el of document.querySelectorAll('.md-editor-preview th, .md-editor-preview td, .md-editor-preview h1, .md-editor-preview h2, .md-editor-preview h3, .md-editor-preview p, .md-editor-preview li')) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) for (const m of n.data.matchAll(/[A-Za-z0-9]{2,}/g)) {
      words++; const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const tops = [...rg.getClientRects()].filter(x => x.width > 0).map(x => x.top);
      if (tops.length && Math.max(...tops) - Math.min(...tops) > 4) split.push(m[0]); // >4px = a second line, not sub-pixel baseline noise
    }
  }
  return { words, split: [...new Set(split)], pageOverflow: document.documentElement.scrollWidth > innerWidth };
});
console.log(`${url} @375px: ${r.words} words checked; split words: ${r.split.length ? r.split.join(', ') : 'none'}; page wider than screen: ${r.pageOverflow ? 'yes' : 'no'} -- ${r.split.length || r.pageOverflow ? 'FAIL' : 'PASS'}`); await p.screenshot({ path: process.argv[3], fullPage: false }); await b.close(); process.exit(r.split.length || r.pageOverflow ? 1 : 0);
