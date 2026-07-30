import { test, expect } from '@playwright/test';

const user = process.env.MDWEB_ADMIN_USER || 'admin';
const pass = process.env.MDWEB_ADMIN_PASS || 'admin';

test.describe('Auth full path', () => {
  test('API login with default credentials returns token', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: user, password: pass }
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.role).toBe('admin');
  });

  test('UI login success reaches admin and stores token', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(user);
    await page.getByTestId('password-input').fill(pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/admin/, { timeout: 15000 });
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 10000
    });
  });

  test('wrong password shows server error text', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(user);
    await page.getByTestId('password-input').fill('definitely-wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toMatch(/login/);
  });

  test('logout clears session; /admin redirects to login', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(user);
    await page.getByTestId('password-input').fill(pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/admin/, { timeout: 15000 });

    await page.getByTestId('logout-button').click();
    await page.waitForTimeout(500);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();

    await page.goto('/admin');
    await page.waitForURL(/login/, { timeout: 10000 });
  });
});
