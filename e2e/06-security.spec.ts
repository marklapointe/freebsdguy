import { test, expect } from '@playwright/test';

test.describe('Security', () => {
  test('unauthenticated cannot create posts', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: { slug: 'nope', title: 'x', content: 'y' }
    });
    expect([401, 403]).toContain(res.status());
  });

  test('path traversal on post slug blocked', async ({ request }) => {
    const res = await request.get('/api/posts/' + encodeURIComponent('../../../etc/passwd'));
    expect([403, 404]).toContain(res.status());
  });

  test('path traversal on image blocked', async ({ request }) => {
    const res = await request.get('/api/getimage?fileName=' + encodeURIComponent('../../etc/passwd'));
    expect([403, 404, 400]).toContain(res.status());
  });

  test('public config never leaks apiKey field', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).not.toMatch(/"apiKey"\s*:/);
  });
});
