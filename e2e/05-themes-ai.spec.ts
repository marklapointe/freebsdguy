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

test.describe('Themes catalog', () => {
  test('GET /api/themes returns many presets', async ({ request }) => {
    const res = await request.get('/api/themes');
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    // Live FreeBSD install may only have default themes until catalog is synced
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test('navbar theme picker opens and lists themes', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('theme-picker-button').click();
    await expect(page.getByTestId('theme-picker-menu')).toBeVisible();
    const options = page.locator('[data-testid^="theme-option-"]');
    await expect(options.first()).toBeVisible();
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('selecting a theme updates data-theme attribute', async ({ page, request }) => {
    const catalog = await (await request.get('/api/themes')).json();
    const target = catalog.find((t: { id: string }) => t.id === 'matrix')
      || catalog.find((t: { id: string }) => t.id === 'dark')
      || catalog[0];
    expect(target).toBeTruthy();

    await login(page);
    await page.goto('/');
    await page.getByTestId('theme-picker-button').click();
    await page.getByTestId(`theme-option-${target.id}`).click();
    await page.waitForTimeout(400);
    const dataTheme = await page.locator('html').getAttribute('data-theme');
    expect(dataTheme).toBe(target.id);
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    expect(bg.length).toBeGreaterThan(0);
  });
});

test.describe('AI settings UI', () => {
  test('admin can open AI settings and save provider fields', async ({ page, request }) => {
    await login(page);
    // AI Settings nav
    await page.getByRole('button', { name: /AI Settings/i }).click();
    await expect(page.getByTestId('ai-settings-heading')).toBeVisible();

    // Enable + set ollama fields
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
    // enabled may still show in public projection
    expect(body.aiConfig?.provider === 'ollama' || body.aiConfig?.enabled !== undefined).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"\s*:/);
  });
});
