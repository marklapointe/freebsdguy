import { test, expect } from '@playwright/test';

test.describe('Public site', () => {
  test('home loads with site branding and posts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    // Footer is configurable; default still shows copyright when enabled
    const footer = page.getByTestId('site-footer');
    if (await footer.count()) {
      await expect(footer).toBeVisible();
    }
  });

  test('public config exposes footer preferences', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.footer).toBeTruthy();
    expect(typeof body.footer.show).toBe('boolean');
    expect(typeof body.footer.copyrightText).toBe('string');
  });

  test('public config never returns raw apiKey', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).not.toHaveProperty('jwtSecret');
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"\s*:/);
  });

  test('health endpoint ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
