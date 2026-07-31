import { test, expect } from '@playwright/test';

test.describe('Security network checks', () => {
  test('theme POST without token is denied', async ({ request }) => {
    const res = await request.post('/api/theme', {
      data: { currentTheme: 'light' },
    });
    expect(res.status()).toBe(401);
  });

  test('config responses during page load never include apiKey field', async ({ page }) => {
    const leaks: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/config')) return;
      try {
        const text = await response.text();
        if (/"apiKey"\s*:/.test(text)) {
          leaks.push(text.slice(0, 200));
        }
      } catch {
        /* ignore binary */
      }
    });
    await page.goto('/');
    await page.waitForTimeout(1000);
    expect(leaks).toEqual([]);
  });
});
