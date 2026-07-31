/**
 * Exhaustive live e2e: every theme pack from /api/themes is applied site-wide,
 * then light and dark modes are exercised in the browser. Assertions check:
 * - data-theme stays on the selected pack (never drifts to another pack)
 * - data-theme-mode matches the user choice
 * - CSS variables form a coherent surface family for that mode
 * - mode toggle is pure/repeatable (A→B→A restores A)
 *
 * Intentionally O(themes × modes) — do not thin this out.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './helpers';

const THEME_CSS_KEYS = [
  '--primary',
  '--secondary',
  '--accent',
  '--text',
  '--bg',
  '--border',
  '--hover',
  '--site-name-color',
  '--on-accent',
  '--on-primary'
] as const;

type CssSnapshot = Record<(typeof THEME_CSS_KEYS)[number], string> & {
  dataTheme: string | null;
  dataMode: string | null;
};

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace(/['"]/g, '').trim().replace('#', '');
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16)
    };
  }
  if (h.length !== 6 || Number.isNaN(parseInt(h, 16))) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function relativeLuminance(hex: string): number {
  const p = parseHex(hex);
  if (!p) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

async function setSiteTheme(request: APIRequestContext, themeId: string): Promise<void> {
  const headers = await authHeaders(request);
  const res = await request.post('/api/theme', {
    headers,
    data: { currentTheme: themeId }
  });
  expect(res.ok(), `set theme ${themeId}: ${await res.text()}`).toBeTruthy();
  const cfg = await (await request.get('/api/config')).json();
  expect(cfg.currentTheme, `config did not persist ${themeId}`).toBe(themeId);
}

async function applyModeInBrowser(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate((m) => {
    localStorage.setItem('themeMode', m);
  }, mode);
  // Avoid networkidle — CRT animations / chunk loads can hang it forever
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('theme-mode-toggle')).toBeVisible({ timeout: 15000 });
  // Wait until the document has the requested mode painted
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode, { timeout: 20000 });
}

async function readCssSnapshot(page: Page): Promise<CssSnapshot> {
  return page.evaluate((keys) => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const out: Record<string, string> = {
      dataTheme: root.getAttribute('data-theme'),
      dataMode: root.getAttribute('data-theme-mode')
    };
    for (const k of keys) {
      // Prefer inline style (what applyTheme sets) then computed
      const inline = root.style.getPropertyValue(k).trim();
      const computed = styles.getPropertyValue(k).trim();
      out[k] = inline || computed;
    }
    return out as CssSnapshot;
  }, THEME_CSS_KEYS as unknown as string[]);
}

function assertModeCoherent(snap: CssSnapshot, mode: 'light' | 'dark', packId: string): void {
  expect(snap.dataTheme, `pack drift under ${packId}/${mode}`).toBe(packId);
  expect(snap.dataMode, `mode attr under ${packId}`).toBe(mode);

  for (const key of THEME_CSS_KEYS) {
    expect(snap[key], `${packId}/${mode} missing ${key}`).toMatch(/#|rgb/i);
  }

  // Normalize rgb() from computed style to hex-ish check via luminance path
  const bg = snap['--bg'];
  const text = snap['--text'];
  const secondary = snap['--secondary'];
  // Only hex is guaranteed from inline styles after applyTheme
  if (bg.startsWith('#') && text.startsWith('#') && secondary.startsWith('#')) {
    const bgL = relativeLuminance(bg);
    const textL = relativeLuminance(text);
    const secL = relativeLuminance(secondary);
    if (mode === 'light') {
      expect(bgL, `${packId} light --bg not light (${bg})`).toBeGreaterThan(0.72);
      expect(secL, `${packId} light --secondary not light (${secondary})`).toBeGreaterThan(0.55);
      expect(textL, `${packId} light --text not dark (${text})`).toBeLessThan(0.45);
      expect(contrastRatio(text, bg), `${packId} light contrast`).toBeGreaterThanOrEqual(3);
      expect(Math.abs(bgL - secL), `${packId} light surface family split`).toBeLessThan(0.25);
    } else {
      expect(bgL, `${packId} dark --bg not dark (${bg})`).toBeLessThan(0.28);
      expect(secL, `${packId} dark --secondary not dark (${secondary})`).toBeLessThan(0.4);
      expect(textL, `${packId} dark --text not light (${text})`).toBeGreaterThan(0.5);
      expect(contrastRatio(text, bg), `${packId} dark contrast`).toBeGreaterThanOrEqual(3);
      expect(Math.abs(bgL - secL), `${packId} dark surface family split`).toBeLessThan(0.25);
    }
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('ALL theme packs × light/dark (exhaustive, repeatable)', () => {
  test('API returns coherent palettes for every catalog theme × mode', async ({ request }) => {
    test.setTimeout(120_000);
    const catalog = await (await request.get('/api/themes')).json();
    expect(Array.isArray(catalog)).toBeTruthy();
    expect(catalog.length).toBeGreaterThanOrEqual(20);

    for (const t of catalog) {
      for (const mode of ['dark', 'light'] as const) {
        const res = await request.get(`/api/theme?name=${encodeURIComponent(t.id)}&mode=${mode}`);
        expect(res.ok(), `${t.id}/${mode} status`).toBeTruthy();
        const body = await res.json();
        expect(body.mdEditorTheme).toBe(mode);
        for (const key of THEME_CSS_KEYS) {
          expect(body[key], `${t.id}/${mode} ${key}`).toMatch(/^#/);
        }
        // Repeat call is pure
        const res2 = await request.get(`/api/theme?name=${encodeURIComponent(t.id)}&mode=${mode}`);
        const body2 = await res2.json();
        for (const key of THEME_CSS_KEYS) {
          expect(body2[key], `${t.id}/${mode} not pure on ${key}`).toBe(body[key]);
        }
        const bgL = relativeLuminance(body['--bg']);
        const textL = relativeLuminance(body['--text']);
        const secL = relativeLuminance(body['--secondary']);
        if (mode === 'light') {
          expect(bgL, `${t.id} light bg`).toBeGreaterThan(0.72);
          expect(secL, `${t.id} light secondary`).toBeGreaterThan(0.55);
          expect(textL, `${t.id} light text`).toBeLessThan(0.45);
        } else {
          expect(bgL, `${t.id} dark bg`).toBeLessThan(0.28);
          expect(secL, `${t.id} dark secondary`).toBeLessThan(0.4);
          expect(textL, `${t.id} dark text`).toBeGreaterThan(0.5);
        }
        expect(contrastRatio(body['--text'], body['--bg']), `${t.id}/${mode} contrast`).toBeGreaterThanOrEqual(
          3
        );
        // Button labels: on-accent / on-primary must contrast with fill
        expect(body['--on-accent'], `${t.id}/${mode} on-accent`).toMatch(/^#/);
        expect(body['--on-primary'], `${t.id}/${mode} on-primary`).toMatch(/^#/);
        expect(
          contrastRatio(body['--on-accent'], body['--accent']),
          `${t.id}/${mode} white-on-white accent risk`
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(body['--on-primary'], body['--primary']),
          `${t.id}/${mode} white-on-white primary risk`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('browser paints every pack in both modes without pack drift; toggle is repeatable', async ({
    page,
    request
  }) => {
    // ~40 packs × reloads + toggles — keep this exhaustive; do not thin out
    test.setTimeout(20 * 60 * 1000);

    const catalog = await (await request.get('/api/themes')).json();
    expect(catalog.length).toBeGreaterThanOrEqual(20);

    // Baseline home so localStorage /theme apply path is live
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('theme-mode-toggle')).toBeVisible({ timeout: 20000 });

    for (const t of catalog) {
      await setSiteTheme(request, t.id);

      // Force dark
      await applyModeInBrowser(page, 'dark');
      const darkSnap = await readCssSnapshot(page);
      assertModeCoherent(darkSnap, 'dark', t.id);

      // Force light
      await applyModeInBrowser(page, 'light');
      const lightSnap = await readCssSnapshot(page);
      assertModeCoherent(lightSnap, 'light', t.id);

      // Surfaces must differ between modes for the same pack
      expect(lightSnap['--bg'], `${t.id} mode switch did nothing to --bg`).not.toBe(darkSnap['--bg']);

      // Round-trip light → dark → light via navbar toggle (user path)
      await page.getByTestId('theme-mode-toggle').click(); // → dark
      await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark', { timeout: 15000 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', t.id);
      const midDark = await readCssSnapshot(page);
      assertModeCoherent(midDark, 'dark', t.id);

      await page.getByTestId('theme-mode-toggle').click(); // → light
      await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light', { timeout: 15000 });
      const lightAgain = await readCssSnapshot(page);
      assertModeCoherent(lightAgain, 'light', t.id);
      // Repeatable: back to the same light palette
      for (const key of THEME_CSS_KEYS) {
        expect(lightAgain[key], `${t.id} toggle round-trip drift on ${key}`).toBe(lightSnap[key]);
      }
    }

    // Restore known site default so other suites start clean
    await setSiteTheme(request, 'dark');
    await page.evaluate(() => localStorage.setItem('themeMode', 'dark'));
  });
});
