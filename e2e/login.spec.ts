import { test, expect } from '@playwright/test';

const adminUser = process.env.MDWEB_ADMIN_USER || 'admin';
const adminPass = process.env.MDWEB_ADMIN_PASS || 'admin';

test.describe('Login', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
  });

  test('bad password stays on login / shows error path', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(adminUser);
    await page.getByTestId('password-input').fill('wrong-password-xyz');
    await page.getByTestId('login-submit').click();
    await page.waitForTimeout(800);
    expect(page.url()).toMatch(/login/);
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  test('valid admin can log in', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(adminUser);
    await page.getByTestId('password-input').fill(adminPass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/admin/, { timeout: 10000 });
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });
});
