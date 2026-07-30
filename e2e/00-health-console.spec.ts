import { test, expect } from '@playwright/test';

/**
 * Hard gates for full regression: CDN/CSP/console failures must fail the suite.
 */
test.describe('Health and console gates', () => {
  test('health and config OK; no external script CDNs', async ({ page, request }) => {
    const cdnHits: string[] = [];
    const consoleErrors: string[] = [];

    page.on('request', (req) => {
      const u = req.url();
      if (/unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/i.test(u)) {
        cdnHits.push(u);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Ignore known HTTP COOP noise on plain IP origins
        if (/Cross-Origin-Opener-Policy|origin-keyed agent cluster/i.test(t)) return;
        consoleErrors.push(t);
      }
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const health = await request.get('/api/health');
    expect(health.ok(), await health.text()).toBeTruthy();
    expect((await health.json()).ok).toBe(true);

    const cfg = await request.get('/api/config');
    expect(cfg.ok()).toBeTruthy();
    const body = await cfg.json();
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"\s*:/);
    expect(body).not.toHaveProperty('jwtSecret');

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    await page.goto('/post/welcome', { waitUntil: 'networkidle' });
    await expect(page.locator('nav')).toBeVisible();

    expect(cdnHits, `CDN hits forbidden: ${cdnHits.join(', ')}`).toEqual([]);
    const cspBlocks = consoleErrors.filter((e) =>
      /Content Security Policy|violates|unpkg/i.test(e)
    );
    expect(cspBlocks, cspBlocks.join('\n')).toEqual([]);
  });
});
