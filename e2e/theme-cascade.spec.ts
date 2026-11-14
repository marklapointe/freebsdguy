import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

/**
 * Track #1682 FOUC follow-up — cascade proof in a real browser for the
 * "default first, theme second, both render-blocking <link>s" contract:
 *  - the default stylesheet stays fully in effect for everything the theme
 *    does not define (vars AND selectors);
 *  - a var defined by both resolves to the THEME (second link wins);
 *  - swapping the order flips the shared var (order matters and holds).
 *
 * Fully self-contained: both stylesheets and the page are served through
 * route interception, so no mdweb server or network is needed.
 */

// Use the bundled browser when present; fall back to the system Chrome only
// when it is not (per the brief).
try {
    const bundled = chromium.executablePath();
    if (!fs.existsSync(bundled) && fs.existsSync('/usr/bin/google-chrome')) {
        test.use({ launchOptions: { executablePath: '/usr/bin/google-chrome' } });
    }
} catch {
    if (fs.existsSync('/usr/bin/google-chrome')) {
        test.use({ launchOptions: { executablePath: '/usr/bin/google-chrome' } });
    }
}

const DEFAULT_CSS = `:root{--only-default:1px;--both:red}
.only-default-sel{margin-left:7px;padding-left:calc(var(--only-default) + 6px)}
.both-sel{color:var(--both)}`;

const THEME_CSS = `:root{--both:blue}`;

const pageHtml = (defaultFirst: boolean) => {
    const a = '<link rel="stylesheet" href="/default.css">';
    const b = '<link rel="stylesheet" href="/theme.css">';
    return `<!doctype html><html><head><meta charset="utf-8">${defaultFirst ? a + b : b + a}</head>` +
        `<body><div id="x" class="only-default-sel both-sel">x</div></body></html>`;
};

async function mockSite(page: import('@playwright/test').Page, defaultFirst: boolean) {
    await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/default.css') {
            return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: DEFAULT_CSS });
        }
        if (url.pathname === '/theme.css') {
            return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: THEME_CSS });
        }
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(defaultFirst) });
    });
}

async function readComputed(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const el = document.getElementById('x') as HTMLElement;
        const cs = getComputedStyle(el);
        const root = getComputedStyle(document.documentElement);
        return {
            color: cs.color,
            marginLeft: cs.marginLeft,
            paddingLeft: cs.paddingLeft,
            both: root.getPropertyValue('--both').trim(),
            onlyDefault: root.getPropertyValue('--only-default').trim()
        };
    });
}

test('default CSS linked first, theme CSS second: theme overrides only what it defines', async ({ page }) => {
    await mockSite(page, true);
    await page.goto('https://cascade.test/');
    const got = await readComputed(page);
    // Shared var: the later (theme) link wins.
    expect(got.both).toBe('blue');
    expect(got.color).toBe('rgb(0, 0, 255)');
    // Default-only var and default selector still apply in full.
    expect(got.onlyDefault).toBe('1px');
    expect(got.marginLeft).toBe('7px');
    expect(got.paddingLeft).toBe('7px');
});

test('order matters: theme linked first, default second flips the shared var back', async ({ page }) => {
    await mockSite(page, false);
    await page.goto('https://cascade.test/');
    const got = await readComputed(page);
    // Same specificity (:root), later link wins -> default is authoritative again.
    expect(got.both).toBe('red');
    expect(got.color).toBe('rgb(255, 0, 0)');
    // The theme link adds nothing of its own here, and default rules are intact.
    expect(got.onlyDefault).toBe('1px');
    expect(got.marginLeft).toBe('7px');
});
