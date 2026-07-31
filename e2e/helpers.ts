/**
 * Shared Playwright helpers for repeatable MDWeb e2e runs.
 * Unique IDs per test avoid cross-run collisions when tests share one server.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const adminUser = process.env.MDWEB_ADMIN_USER || 'admin';
export const adminPass = process.env.MDWEB_ADMIN_PASS || 'admin';

export function uniqueId(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function apiLogin(
  request: APIRequestContext,
  username = adminUser,
  password = adminPass
): Promise<string> {
  const res = await request.post('/api/login', {
    data: { username, password }
  });
  expect(res.ok(), `login failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.token, 'login token missing').toBeTruthy();
  return body.token as string;
}

export async function uiLogin(
  page: Page,
  username = adminUser,
  password = adminPass
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('login-submit').click();

  await page.waitForURL(/\/admin/, { timeout: 20000 });
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token, 'token not stored after UI login').toBeTruthy();
}

/** Inject API token into page storage (faster than full UI login for admin screens). */
export async function injectSession(
  page: Page,
  request: APIRequestContext,
  username = adminUser,
  password = adminPass
): Promise<void> {
  const token = await apiLogin(request, username, password);
  await page.goto('/');
  await page.evaluate(
    ({ token: t, user, role }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('username', user);
      localStorage.setItem('role', role);
    },
    { token, user: username, role: 'admin' }
  );
}

export async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await apiLogin(request);
  return { Authorization: `Bearer ${token}` };
}

/** Minimal 1x1 PNG for upload tests */
export function tinyPngBuffer(): Buffer {
  // 1x1 red PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}
