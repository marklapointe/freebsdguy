/**
 * Documentation screenshots — EVERY theme × light/dark + product chrome.
 * Not part of default smoke; run: npm run docs:shots
 * Uses Playwright baseURL (default FreeBSD live host; see playwright.config.ts).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { authHeaders } from './helpers';

const OUT = path.resolve(process.cwd(), 'docs/images');
const THEMES_OUT = path.join(OUT, 'themes');
const VIEW = { width: 1280, height: 800 };

async function setTheme(request: APIRequestContext, id: string) {
  const headers = await authHeaders(request);
  const res = await request.post('/api/theme', { headers, data: { currentTheme: id } });
  expect(res.ok(), `set theme ${id}: ${await res.text()}`).toBeTruthy();
}

async function paintMode(page: Page, mode: 'light' | 'dark', themeId: string) {
  // Set storage after navigation (about:blank blocks localStorage)
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((m) => localStorage.setItem('themeMode', m), mode);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeId, { timeout: 20000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode, { timeout: 20000 });
  await page.waitForTimeout(150);
}

function ensureDirs() {
  fs.mkdirSync(THEMES_OUT, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
}

test.describe.configure({ mode: 'serial' });

test('capture all themes × light/dark + product chrome for docs', async ({ page, request }) => {
  test.setTimeout(30 * 60 * 1000);
  ensureDirs();

  const catalog = await (await request.get('/api/themes')).json();
  expect(Array.isArray(catalog)).toBeTruthy();
  expect(catalog.length, 'theme catalog empty').toBeGreaterThanOrEqual(20);

  // Prefer crisp stills: turn off CRT flicker during capture
  const headers = await authHeaders(request);
  const cfgRes = await request.get('/api/config');
  const cfg = await cfgRes.json();
  await request.post('/api/admin/config', {
    headers,
    data: {
      ...cfg,
      appearance: {
        ...(cfg.appearance || {}),
        crtEffects: false,
        textGlow: false,
        themeMode: 'dark'
      }
    }
  });

  await page.setViewportSize(VIEW);

  const lines: string[] = [
    '# Theme gallery',
    '',
    `Generated from catalog (${catalog.length} packs × dark/light).`,
    '',
    '| Theme | Dark | Light |',
    '|-------|------|-------|'
  ];

  for (const t of catalog) {
    const id = t.id as string;
    await setTheme(request, id);

    await paintMode(page, 'dark', id);
    const darkPath = path.join(THEMES_OUT, `${id}-dark.png`);
    await page.screenshot({ path: darkPath, type: 'png' });

    await paintMode(page, 'light', id);
    const lightPath = path.join(THEMES_OUT, `${id}-light.png`);
    await page.screenshot({ path: lightPath, type: 'png' });

    const label = (t.label || id).replace(/\|/g, '/');
    lines.push(
      `| ${label} (\`${id}\`) | ![${id} dark](./${id}-dark.png) | ![${id} light](./${id}-light.png) |`
    );
  }

  fs.writeFileSync(path.join(THEMES_OUT, 'INDEX.md'), lines.join('\n') + '\n', 'utf8');
  const galleryRows = lines
    .filter((l) => l.includes('-dark.png'))
    .map((l) => l.replace(/\]\(\.\//g, '](./images/themes/'));
  fs.writeFileSync(
    path.resolve(process.cwd(), 'docs/THEMES.md'),
    [
      '# All MDWeb themes',
      '',
      'Every shipped theme pack in **dark** and **light** mode.',
      '',
      'Regenerate: `npm run docs:shots`',
      '',
      'Per-file index: [images/themes/INDEX.md](./images/themes/INDEX.md)',
      '',
      '| Theme | Dark | Light |',
      '|-------|------|-------|',
      ...galleryRows
    ].join('\n') + '\n',
    'utf8'
  );

  // Count check
  const darks = fs.readdirSync(THEMES_OUT).filter((f) => f.endsWith('-dark.png'));
  const lights = fs.readdirSync(THEMES_OUT).filter((f) => f.endsWith('-light.png'));
  expect(darks.length, 'dark shot count').toBe(catalog.length);
  expect(lights.length, 'light shot count').toBe(catalog.length);

  // Product chrome under miami-cyberpunk or dark
  const hero =
    catalog.find((t: { id: string }) => t.id === 'miami-cyberpunk')?.id ||
    catalog.find((t: { id: string }) => t.id === 'dark')?.id ||
    catalog[0].id;
  await setTheme(request, hero);
  await paintMode(page, 'dark', hero);
  await page.screenshot({ path: path.join(OUT, 'home-hero.png'), type: 'png' });

  // Kitchen sink post if present
  await page.goto('/post/kitchen-sink-markdown', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('login')) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'post-kitchen-sink.png'), type: 'png' });
  }

  await page.goto('/post/math-for-the-rest-of-us', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('login')) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'post-math.png'), type: 'png' });
  }

  // Admin appearance
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const user = process.env.MDWEB_ADMIN_USER || 'admin';
  const pass = process.env.MDWEB_ADMIN_PASS || 'admin';
  await page.getByTestId('username-input').fill(user);
  await page.getByTestId('password-input').fill(pass);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/admin/, { timeout: 20000 });
  await page.getByRole('button', { name: /Appearance/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'admin-appearance.png'), type: 'png' });

  const sec = page.getByTestId('admin-security-tab');
  if (await sec.count()) {
    await sec.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'admin-security.png'), type: 'png' });
  }

  // Restore dark theme for the live host
  await setTheme(request, 'dark');
  await request.post('/api/admin/config', {
    headers,
    data: {
      currentTheme: 'dark',
      appearance: {
        themeMode: 'dark',
        crtEffects: true,
        textGlow: true
      }
    }
  });
});
