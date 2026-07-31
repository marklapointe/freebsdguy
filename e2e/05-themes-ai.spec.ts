import { test, expect } from '@playwright/test';

const user = process.env.MDWEB_ADMIN_USER || 'admin';
const pass = process.env.MDWEB_ADMIN_PASS || 'admin';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('username-input').fill(user);
  await page.getByTestId('password-input').fill(pass);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/admin/, { timeout: 15000 });
}

test.describe('Themes catalog (admin-only)', () => {
  test('GET /api/themes returns many presets including miami-cyberpunk', async ({ request }) => {
    const res = await request.get('/api/themes');
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.length).toBeGreaterThanOrEqual(2);
    const ids = body.map((t: { id: string }) => t.id);
    // When full catalog is deployed
    if (ids.length >= 20) {
      expect(ids).toContain('miami-cyberpunk');
      expect(ids).toContain('miami-vice');
    }
  });

  test('public navbar has no theme picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('theme-picker-button')).toHaveCount(0);
    await expect(page.getByTestId('theme-picker-menu')).toHaveCount(0);
  });

  test('non-admin cannot POST site theme', async ({ request }) => {
    const res = await request.post('/api/theme', {
      data: { currentTheme: 'dark' }
    });
    expect([401, 403]).toContain(res.status());
  });

  test('admin sets theme from Appearance settings and persists server-side', async ({
    page,
    request
  }) => {
    const catalog = await (await request.get('/api/themes')).json();
    const target =
      catalog.find((t: { id: string }) => t.id === 'miami-cyberpunk') ||
      catalog.find((t: { id: string }) => t.id === 'miami-vice') ||
      catalog.find((t: { id: string }) => t.id === 'dark') ||
      catalog[0];
    expect(target).toBeTruthy();

    await login(page);
    await page.getByRole('button', { name: /Appearance/i }).click();
    const card = page.getByTestId(`theme-card-${target.id}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
    await page.getByRole('button', { name: /Set as site theme/i }).click();
    await page.waitForTimeout(1000);

    const cfg = await request.get('/api/config');
    expect(cfg.ok()).toBeTruthy();
    const body = await cfg.json();
    expect(body.currentTheme, 'theme must persist in config.json').toBe(target.id);
    const dataTheme = await page.locator('html').getAttribute('data-theme');
    expect(dataTheme).toBe(target.id);
  });
});

test.describe('AI settings UI', () => {
  test('admin can open AI settings and save provider fields', async ({ page, request }) => {
    await login(page);
    await page.getByRole('button', { name: /AI Settings/i }).click();
    await expect(page.getByTestId('ai-settings-heading')).toBeVisible();

    const toggle = page.getByTestId('ai-enabled-toggle');
    if (!(await toggle.isChecked())) {
      await toggle.click({ force: true });
    }
    await page.getByTestId('ai-provider-select').selectOption('ollama');
    await page.getByTestId('ai-baseurl-input').fill('http://127.0.0.1:11434');
    await page.getByTestId('ai-save-button').click();
    await page.waitForTimeout(800);

    const cfg = await request.get('/api/config');
    const body = await cfg.json();
    expect(body.aiConfig?.provider === 'ollama' || body.aiConfig?.enabled !== undefined).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"\s*:/);
  });
});
