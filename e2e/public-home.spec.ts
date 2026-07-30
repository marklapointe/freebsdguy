import { test, expect } from '@playwright/test';

test.describe('Public site', () => {
  test('home loads with site branding and posts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/All rights reserved/i)).toBeVisible();
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
