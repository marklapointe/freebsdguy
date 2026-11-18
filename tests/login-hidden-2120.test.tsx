/**
 * Track #2120 — the web-login kill switch (security.disableWebLogin) hides the
 * Login entry point and the login page, and hides /admin for visitors who are
 * not signed in. An existing signed-in session on /admin is left alone.
 *
 * The server already refuses POST /api/login when the flag is on; these tests
 * cover the frontend half: no login link in the navbar, no login form, and no
 * redirect into a login page that does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const post = vi.fn();
const applyTheme = vi.fn().mockResolvedValue(null);
const toggleThemeMode = vi.fn().mockResolvedValue('dark');
const setAuthModeCache = vi.fn();
const siteConfigLoad = vi.fn().mockResolvedValue({ siteName: 'My Site', siteLogo: undefined });

vi.mock('../src/lib/api', () => ({
    api: {
        get: (...a: unknown[]) => get(...a),
        post: (...a: unknown[]) => post(...a)
    },
    getPublicConfig: () => get('/config').then((r: any) => r.data),
    invalidatePublicConfig: () => {},
    applyTheme: (...a: unknown[]) => applyTheme(...a),
    getEffectiveThemeMode: (m?: string) => (m === 'light' ? 'light' : 'dark'),
    getMdEditorTheme: () => 'dark',
    setAuthModeCache: (...a: unknown[]) => setAuthModeCache(...a),
    toggleThemeMode: (...a: unknown[]) => toggleThemeMode(...a),
    siteConfig: {
        load: (...a: unknown[]) => siteConfigLoad(...a),
        refresh: (...a: unknown[]) => siteConfigLoad(...a),
        get: () => ({ siteName: 'My Site' }),
        subscribe: () => () => {}
    },
    fetchThemeCatalog: vi.fn().mockResolvedValue([])
}));

vi.mock('md-editor-rt', () => ({
    MdEditor: () => null,
    MdPreview: ({ modelValue }: any) => <div>{modelValue}</div>
}));

// Avoid deep Admin
vi.mock('../src/components/admin/Admin', () => ({
    Admin: () => <div data-testid="admin-page">Admin</div>
}));

vi.mock('../src/components/Home', () => ({
    Home: () => <div data-testid="home-page">Home</div>
}));

vi.mock('../src/components/PostDetail', () => ({
    PostDetail: () => <div>Post</div>
}));

import { Navbar } from '../src/components/Navbar';
import App from '../src/App';

/** Public projection of GET /api/config, with the kill-switch flag. */
const publicConfig = (disableWebLogin: boolean) => ({
    siteName: 'My Site',
    currentTheme: 'dark',
    appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
    security: { authMode: 'jwt', disableWebLogin }
});

describe('web login kill switch (Track #2120)', () => {
    let pendingConfig: Array<(value: unknown) => void> = [];

    beforeEach(() => {
        localStorage.clear();
        get.mockReset();
        post.mockReset();
        applyTheme.mockClear();
        setAuthModeCache.mockReset();
        pendingConfig = [];
        // /config stays in flight until the test releases it, so the window
        // before the config arrives is observable.
        get.mockImplementation((url: string) => {
            if (url === '/config') {
                return new Promise(resolve => {
                    pendingConfig.push(resolve);
                });
            }
            if (url === '/me') return Promise.reject(new Error('no session'));
            return Promise.resolve({ data: {} });
        });
        window.history.pushState({}, '', '/');
    });

    /** Release the pending GET /api/config with the given kill-switch state. */
    const loadConfig = async (disableWebLogin: boolean) => {
        await act(async () => {
            const resolvers = pendingConfig;
            pendingConfig = [];
            resolvers.forEach(resolve => resolve({ data: publicConfig(disableWebLogin) }));
            await Promise.resolve();
        });
    };

    /** Make GET /api/config fail, the way an unreachable or broken backend would. */
    const failConfig = () => {
        get.mockImplementation((url: string) => {
            if (url === '/config') return Promise.reject(new Error('config failed'));
            if (url === '/me') return Promise.reject(new Error('no session'));
            return Promise.resolve({ data: {} });
        });
    };

    it('a. hides the login link when the public config disables web login', async () => {
        render(<App />);
        await loadConfig(true);
        expect(screen.queryByTestId('login-link')).toBeNull();
        expect(screen.getByTestId('home-page')).toBeTruthy();
    });

    it('b. /login shows not-found instead of the login form', async () => {
        window.history.pushState({}, '', '/login');
        render(<App />);
        await loadConfig(true);
        expect(screen.getByTestId('not-found')).toBeTruthy();
        expect(screen.queryByTestId('username-input')).toBeNull();
        expect(screen.queryByTestId('password-input')).toBeNull();
        expect(screen.queryByTestId('login-submit')).toBeNull();
    });

    it('c. /admin shows not-found and never redirects to /login', async () => {
        window.history.pushState({}, '', '/admin');
        render(<App />);
        await loadConfig(true);
        expect(screen.getByTestId('not-found')).toBeTruthy();
        expect(screen.queryByTestId('admin-page')).toBeNull();
        expect(screen.queryByTestId('username-input')).toBeNull();
        expect(window.location.pathname).toBe('/admin');
    });

    it('d. keeps the login link and the login form when web login is enabled', async () => {
        render(<App />);
        await loadConfig(false);
        const loginLink = await screen.findByTestId('login-link');
        fireEvent.click(loginLink);
        await waitFor(() => expect(screen.getByTestId('username-input')).toBeTruthy());
        expect(screen.queryByTestId('not-found')).toBeNull();
    });

    it('e. never flashes the login link before the public config arrives', async () => {
        render(<App />);
        // Config still in flight: the link must not be on screen yet.
        expect(screen.queryByTestId('login-link')).toBeNull();
        await loadConfig(false);
        expect(await screen.findByTestId('login-link')).toBeTruthy();
    });

    it('f. keeps a signed-in session working while the kill switch is on', async () => {
        localStorage.setItem('token', 't');
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', 'admin');
        window.history.pushState({}, '', '/admin');
        render(<App />);
        await loadConfig(true);
        expect(screen.getByTestId('admin-page')).toBeTruthy();
        expect(screen.queryByTestId('not-found')).toBeNull();
    });

    it('g. keeps the login link when the public config fetch fails', async () => {
        // A failed fetch is not an answer: the flag is off (login on) unless the
        // public config explicitly says the web login is disabled.
        failConfig();
        render(<App />);
        expect(await screen.findByTestId('login-link')).toBeTruthy();
    });

    it('h. renders the login form on /login when the public config fetch fails', async () => {
        window.history.pushState({}, '', '/login');
        failConfig();
        render(<App />);
        expect(await screen.findByTestId('username-input')).toBeTruthy();
        expect(screen.queryByTestId('not-found')).toBeNull();
        expect(screen.queryByTestId('login-submit')).toBeTruthy();
    });

    it('i. keeps the login hidden when a cosmetic step after the decision throws', async () => {
        // The kill switch is decided first; a later cosmetic throw (blocked
        // storage) must not undo that decision and re-enable the web login.
        window.history.pushState({}, '', '/login');
        setAuthModeCache.mockImplementation(() => {
            throw new Error('storage');
        });
        try {
            render(<App />);
            await loadConfig(true);
            expect(screen.getByTestId('not-found')).toBeTruthy();
            expect(screen.queryByTestId('username-input')).toBeNull();
            expect(screen.queryByTestId('login-submit')).toBeNull();
            expect(screen.queryByTestId('login-link')).toBeNull();
        } finally {
            setAuthModeCache.mockReset();
        }
    });
});

describe('Navbar login entry point', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset();
        siteConfigLoad.mockResolvedValue({ siteName: 'My Site', siteLogo: undefined });
        get.mockResolvedValue({
            data: { currentTheme: 'dark', appearance: { themeMode: 'dark' } }
        });
    });

    it('shows the login link by default so other callers keep working', async () => {
        render(
            <MemoryRouter>
                <Navbar user={null} setUser={vi.fn()} />
            </MemoryRouter>
        );
        expect(await screen.findByTestId('login-link')).toBeTruthy();
    });

    it('hides the login link when loginEnabled is false', async () => {
        render(
            <MemoryRouter>
                <Navbar user={null} setUser={vi.fn()} loginEnabled={false} />
            </MemoryRouter>
        );
        await waitFor(() => expect(siteConfigLoad).toHaveBeenCalled());
        expect(screen.queryByTestId('login-link')).toBeNull();
    });
});
