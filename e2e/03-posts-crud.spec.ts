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

test.describe('Posts CRUD (browser)', () => {
  const slug = `e2e-post-${Date.now()}`;
  const title = `E2E Post ${Date.now()}`;

  test('create post via API then visible on home and detail', async ({ page, request }) => {
    const loginRes = await request.post('/api/login', {
      data: { username: user, password: pass }
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const { token } = await loginRes.json();

    const save = await request.post('/api/posts', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        slug,
        title,
        content: '# Hello\n\nE2E body with `code`.',
        summary: 'E2E summary',
        date: new Date().toISOString(),
        pinned: false
      }
    });
    expect(save.status(), await save.text()).toBe(200);

    await page.goto('/');
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByText('E2E body', { exact: false })).toBeVisible({ timeout: 10000 });

    // cleanup
    const del = await request.delete(`/api/posts/${slug}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect([200, 404]).toContain(del.status());
  });

  test('admin posts list loads after login', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /Posts/i }).click();
    await expect(page.getByRole('heading', { name: /Posts/i })).toBeVisible();
  });
});
