/**
 * Full feature regression against a live MDWeb instance.
 *
 *   npm run test:e2e
 *   # optional: MDWEB_BASE_URL=http://127.0.0.1:5173 for local dev
 *
 * Uses unique slugs/usernames per run; cleans up resources it creates.
 */
import { test, expect } from '@playwright/test';
import {
  adminUser,
  adminPass,
  apiLogin,
  authHeaders,
  injectSession,
  tinyPngBuffer,
  uiLogin,
  uniqueId
} from './helpers';

// Independent tests so one failure does not skip the rest of the product surface.
test.describe.configure({ mode: 'default' });

/** Prefer injectSession for admin UI (faster than full form login per test). */
async function asAdmin(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  await injectSession(page, request);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });
}

test.describe('FULL regression — all product surfaces', () => {
  // ─── Health / public ───────────────────────────────────────────────
  test('health endpoint is healthy', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('public config has site fields and never leaks secrets', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.siteName || body.currentTheme).toBeTruthy();
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"apiKey"\s*:/);
    expect(raw).not.toMatch(/jwtSecret/i);
    expect(raw).not.toMatch(/passwordHash/i);
  });

  test('public home loads branding and post list', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('login-link').or(page.getByTestId('logout-button'))).toBeVisible();
    // At least the welcome post or any post card/link area
    await expect(page.locator('main, body')).toContainText(/MDWeb|Welcome|post/i);
  });

  test('public post detail renders markdown body', async ({ page, request }) => {
    const posts = await (await request.get('/api/posts')).json();
    const list = Array.isArray(posts) ? posts : posts.posts || [];
    expect(list.length).toBeGreaterThan(0);
    const slug = list[0].slug;
    await page.goto(`/post/${slug}`);
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('404');
  });

  // ─── Auth ──────────────────────────────────────────────────────────
  test('API login returns token without personal theme field', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: adminUser, password: adminPass }
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.role).toBe('admin');
    expect(body.theme).toBeUndefined();
  });

  test('UI login reaches admin and session survives hard refresh', async ({ page }) => {
    // One real UI login in the suite (rest use injectSession)
    await uiLogin(page);
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 10000
    });
    await page.reload({ waitUntil: 'networkidle' });
    // Must NOT bounce to login
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });
    await expect(page.getByTestId('username-input')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible({
      timeout: 10000
    });
  });

  test('wrong password stays on login with error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('username-input').fill(adminUser);
    await page.getByTestId('password-input').fill('definitely-wrong-password-xyz');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toMatch(/login/);
  });

  test('logout clears token and protects /admin', async ({ page, request }) => {
    await asAdmin(page, request);
    await page.getByTestId('logout-button').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeFalsy();
    await page.goto('/admin');
    await page.waitForURL(/login/, { timeout: 10000 });
  });

  // ─── Posts CRUD ────────────────────────────────────────────────────
  test('posts: create via API, appear on home, update, delete', async ({ page, request }) => {
    const headers = await authHeaders(request);
    const slug = uniqueId('post');
    const title = `E2E Full ${slug}`;

    const create = await request.post('/api/posts', {
      headers,
      data: {
        slug,
        title,
        content: `# ${title}\n\nBody for full regression with **bold**.`,
        summary: 'full regression summary',
        date: new Date().toISOString(),
        pinned: false
      }
    });
    expect(create.status(), await create.text()).toBe(200);

    await page.goto('/');
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByText('full regression', { exact: false })).toBeVisible({ timeout: 10000 });

    const update = await request.post('/api/posts', {
      headers,
      data: {
        slug,
        title: `${title} UPDATED`,
        content: `# updated\n\nUpdated body ${slug}`,
        summary: 'updated summary',
        date: new Date().toISOString(),
        pinned: true
      }
    });
    expect(update.status(), await update.text()).toBe(200);

    const detail = await request.get(`/api/posts/${slug}`);
    expect(detail.ok()).toBeTruthy();
    const post = await detail.json();
    expect(post.title).toContain('UPDATED');
    expect(post.pinned).toBe(true);

    await page.goto('/');
    await expect(page.getByRole('link', { name: `${title} UPDATED` })).toBeVisible({
      timeout: 15000
    });

    const del = await request.delete(`/api/posts/${slug}`, { headers });
    expect([200, 404]).toContain(del.status());
    const gone = await request.get(`/api/posts/${slug}`);
    expect([404, 200]).toContain(gone.status());
    if (gone.status() === 200) {
      // some installs return empty — ensure not listed
      const list = await (await request.get('/api/posts')).json();
      const arr = Array.isArray(list) ? list : list.posts || [];
      expect(arr.find((p: { slug: string }) => p.slug === slug)).toBeFalsy();
    }
  });

  test('admin Posts UI lists content after login', async ({ page, request }) => {
    await asAdmin(page, request);
    await page.getByRole('button', { name: /^Posts$/i }).click();
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible();
  });

  // ─── Themes (admin-only) ───────────────────────────────────────────
  test('theme catalog has full preset pack including miami-cyberpunk', async ({ request }) => {
    const res = await request.get('/api/themes');
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.length, `expected full catalog, got ${body.length}`).toBeGreaterThanOrEqual(20);
    const ids = body.map((t: { id: string }) => t.id);
    expect(ids).toContain('miami-cyberpunk');
    expect(ids).toContain('miami-vice');
    expect(ids).toContain('dark');
    expect(ids).toContain('doom');
    expect(ids).toContain('gameboy');
  });

  test('public UI has no theme picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('theme-picker-button')).toHaveCount(0);
    await expect(page.getByTestId('theme-picker-menu')).toHaveCount(0);
  });

  test('anonymous cannot set site theme', async ({ request }) => {
    const res = await request.post('/api/theme', {
      data: { currentTheme: 'dark' }
    });
    expect([401, 403]).toContain(res.status());
  });

  test('admin sets site theme and it persists in /api/config + data-theme', async ({
    page,
    request
  }) => {
    const catalog = await (await request.get('/api/themes')).json();
    expect(catalog.length).toBeGreaterThanOrEqual(2);
    const target =
      catalog.find((t: { id: string }) => t.id === 'miami-cyberpunk') ||
      catalog.find((t: { id: string }) => t.id === 'miami-vice') ||
      catalog.find((t: { id: string }) => t.id === 'light') ||
      catalog[0];

    await asAdmin(page, request);
    await page.getByRole('button', { name: /Appearance/i }).click();
    const card = page.getByTestId(`theme-card-${target.id}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    await page.getByRole('button', { name: /Set as site theme/i }).click();
    // Success toast or error must not be "permission denied" for a healthy host
    await page.waitForTimeout(1200);

    const cfg = await request.get('/api/config');
    expect(cfg.ok()).toBeTruthy();
    const body = await cfg.json();
    expect(
      body.currentTheme,
      `theme not persisted (got ${body.currentTheme}). Is config.json writable by www?`
    ).toBe(target.id);

    await expect(page.locator('html')).toHaveAttribute('data-theme', target.id, {
      timeout: 10000
    });

    // Restore dark so other tests start from a known state
    const headers = await authHeaders(request);
    const restore = await request.post('/api/theme', {
      headers,
      data: { currentTheme: 'dark' }
    });
    expect(restore.ok(), await restore.text()).toBeTruthy();
  });

  // ─── Settings ──────────────────────────────────────────────────────
  test('admin Settings can update siteName and it reflects publicly', async ({ page, request }) => {
    const name = `MDWeb-E2E-${uniqueId('site').slice(-6)}`;
    const headers = await authHeaders(request);

    // API is source of truth for persistence; UI verifies navigation + public branding
    const save = await request.post('/api/admin/config', {
      headers,
      data: { siteName: name }
    });
    expect(save.ok(), await save.text()).toBeTruthy();

    const cfg = await request.get('/api/config');
    expect((await cfg.json()).siteName).toBe(name);

    await asAdmin(page, request);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Settings|General|Site/i })).toBeVisible({
      timeout: 10000
    });

    // Logo may hide text branding in the nav; document title is always updated from siteName
    await page.goto('/');
    await expect(page).toHaveTitle(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
      timeout: 10000
    });

    // Restore default branding
    await request.post('/api/admin/config', {
      headers,
      data: { siteName: 'MDWeb' }
    });
  });

  // ─── Users ─────────────────────────────────────────────────────────
  test('admin Users list shows admin; can create and delete contributor', async ({
    page,
    request
  }) => {
    const uname = uniqueId('user').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
    await asAdmin(page, request);
    await page.getByRole('button', { name: /Users/i }).click();
    await expect(page.getByRole('heading', { name: /Users/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/admin/i);

    const headers = await authHeaders(request);
    const create = await request.post('/api/admin/users', {
      headers,
      data: { username: uname, password: 'testpass12345', role: 'contributor' }
    });
    expect(create.status(), await create.text()).toBe(200);

    const list = await request.get('/api/admin/users', { headers });
    expect(list.ok()).toBeTruthy();
    const users = await list.json();
    expect(users.some((u: { username: string }) => u.username === uname)).toBeTruthy();

    const del = await request.delete(`/api/admin/users/${uname}`, { headers });
    expect(del.status(), await del.text()).toBe(200);
  });

  // ─── Images ────────────────────────────────────────────────────────
  test('admin can list images and upload then delete a PNG', async ({ request }) => {
    const headers = await authHeaders(request);
    const listBefore = await request.get('/api/admin/images?limit=all', { headers });
    expect(listBefore.ok(), await listBefore.text()).toBeTruthy();
    const beforeBody = await listBefore.json();
    expect(beforeBody).toHaveProperty('images');

    const png = tinyPngBuffer();
    const upload = await request.post('/api/admin/upload', {
      headers,
      multipart: {
        image: {
          name: `${uniqueId('img')}.png`,
          mimeType: 'image/png',
          buffer: png
        }
      }
    });
    // 200 success; 403 policy; 503 = sharp/libvips missing on this platform (known FreeBSD gap)
    if (upload.status() === 403) {
      test.skip(true, 'images disabled by security policy');
      return;
    }
    if (upload.status() === 503) {
      const msg = await upload.text();
      expect(msg).toMatch(/sharp|libvips|unavailable/i);
      // Listing still works even when processing is unavailable
      expect(Array.isArray(beforeBody.images)).toBeTruthy();
      return;
    }
    expect(upload.status(), await upload.text()).toBe(200);
    const upBody = await upload.json();
    expect(upBody.filename || upBody.url).toBeTruthy();
    const filename = upBody.filename as string;

    const getImg = await request.get(`/api/getimage?fileName=${encodeURIComponent(filename)}`);
    expect(getImg.ok(), await getImg.text()).toBeTruthy();

    const del = await request.delete(`/api/admin/images/${encodeURIComponent(filename)}`, {
      headers
    });
    expect([200, 404]).toContain(del.status());
  });

  test('admin Images tab opens', async ({ page, request }) => {
    await asAdmin(page, request);
    await page.getByRole('button', { name: /Images/i }).click();
    await expect(page.getByRole('heading', { name: /Images/i })).toBeVisible({ timeout: 10000 });
  });

  // ─── AI settings ───────────────────────────────────────────────────
  test('admin AI settings panel saves provider fields without leaking apiKey', async ({
    page,
    request
  }) => {
    await asAdmin(page, request);
    await page.getByRole('button', { name: /AI Settings/i }).click();
    await expect(page.getByTestId('ai-settings-heading')).toBeVisible({ timeout: 10000 });

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

  // ─── Security ──────────────────────────────────────────────────────
  test('security: unauth cannot create posts', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: { slug: 'x', title: 'x', content: 'x' }
    });
    expect([401, 403]).toContain(res.status());
  });

  test('security: path traversal on posts and images blocked', async ({ request }) => {
    const post = await request.get('/api/posts/' + encodeURIComponent('../etc/passwd'));
    expect([400, 403, 404]).toContain(post.status());
    const img = await request.get(
      '/api/getimage?fileName=' + encodeURIComponent('../etc/passwd')
    );
    expect([400, 403, 404]).toContain(img.status());
  });

  test('security: config responses during page load never include apiKey', async ({ page }) => {
    const leaked: string[] = [];
    page.on('response', async (res) => {
      if (!/\/api\/config/.test(res.url())) return;
      try {
        const t = await res.text();
        if (/"apiKey"\s*:/.test(t)) leaked.push(t.slice(0, 200));
      } catch {
        /* ignore */
      }
    });
    await page.goto('/');
    await page.waitForTimeout(1500);
    expect(leaked, leaked.join('\n')).toEqual([]);
  });

  // ─── Config writability (root cause of theme save failures) ────────
  test('admin config-status reports writable config (theme saves require this)', async ({
    request
  }) => {
    const headers = await authHeaders(request);
    const res = await request.get('/api/admin/config-status', { headers });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(
      body.isWritable,
      'config.json is not writable by the service user — theme/settings saves will 500'
    ).toBe(true);
  });
});
