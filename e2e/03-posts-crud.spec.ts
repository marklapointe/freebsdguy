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

  test('editing a post loads full markdown body into the editor', async ({ page, request }) => {
    // Seed a showcase-style post (frontmatter + body) like auto-generated demos
    const loginRes = await request.post('/api/login', {
      data: { username: user, password: pass }
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const { token } = await loginRes.json();
    const slug = `e2e-edit-body-${Date.now()}`;
    const body = `# Editor body check\n\nUnique phrase XYZEDIT123 for the markdown editor.\n`;
    const save = await request.post('/api/posts', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        slug,
        title: 'Edit Body Check',
        summary: 'sum',
        content: body,
        date: new Date().toISOString(),
        author: 'admin',
        pinned: false
      }
    });
    expect(save.ok(), await save.text()).toBeTruthy();

    await login(page);

    // Posts tab is default; open editor via unique data-testid
    const editBtn = page.getByTestId(`edit-post-${slug}`);
    await expect(editBtn).toBeVisible({ timeout: 15000 });
    await editBtn.click();

    // Modal open — editor must contain body (MdEditor may render text in editor + preview)
    await expect(page.getByRole('heading', { name: /Edit Post/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('XYZEDIT123').first()).toBeVisible({ timeout: 15000 });

    await request.delete(`/api/posts/${slug}`, { headers: { Authorization: `Bearer ${token}` } });
  });

  test('admin posts list loads after login', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /Posts/i }).click();
    await expect(page.getByRole('heading', { name: /Posts/i })).toBeVisible();
  });
});
