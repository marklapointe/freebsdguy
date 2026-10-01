/**
 * Regression tests for CODE_REVIEW_FINDINGS.md (client side).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// src/lib/api.ts — real module, axios mocked (#7 interceptor, /config dedupe)
// ---------------------------------------------------------------------------
const mockGet = vi.fn();
const mockPost = vi.fn();
const handlers: { req?: Function; err?: Function } = {};

vi.mock('axios', () => {
    const instance = {
        get: (...a: unknown[]) => mockGet(...a),
        post: (...a: unknown[]) => mockPost(...a),
        interceptors: {
            request: { use: (fn: Function) => { handlers.req = fn; } },
            response: { use: (_ok: Function, err: Function) => { handlers.err = err; } }
        }
    };
    return { default: { create: () => instance } };
});

vi.mock('md-editor-rt', () => ({
    MdPreview: ({ modelValue }: { modelValue: string }) => <div data-testid="preview">{modelValue}</div>,
    MdCatalog: () => <div data-testid="catalog" />,
    MdEditor: () => null
}));

describe('#7 api interceptor clears session-mode identity on auth failure', () => {
    beforeEach(() => {
        localStorage.clear();
        mockGet.mockReset();
    });

    it('clears role/username and redirects even when no localStorage token exists', async () => {
        const api = await import('../src/lib/api');
        api.setAuthModeCache('session');
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', 'mark');
        const loc = { pathname: '/admin', href: '' };
        const spy = vi.spyOn(window, 'location', 'get').mockReturnValue(loc as any);
        try {
            await expect(
                handlers.err!({ response: { status: 401, data: { message: 'No token' } }, config: { url: '/posts' } })
            ).rejects.toBeTruthy();
            expect(localStorage.getItem('role')).toBeNull();
            expect(localStorage.getItem('username')).toBeNull();
            expect(loc.href).toBe('/login');
        } finally {
            spy.mockRestore();
        }
    });

    it('does not redirect anonymous visitors (nothing stored) on a 401 from /me', async () => {
        await import('../src/lib/api');
        const loc = { pathname: '/', href: '' };
        const spy = vi.spyOn(window, 'location', 'get').mockReturnValue(loc as any);
        try {
            await expect(
                handlers.err!({ response: { status: 401, data: { message: 'No token' } }, config: { url: '/me' } })
            ).rejects.toBeTruthy();
            expect(loc.href).toBe('');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('cold-load /config dedupe', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it('getPublicConfig coalesces concurrent callers into one request and refresh() re-fetches', async () => {
        const api = await import('../src/lib/api');
        api.invalidatePublicConfig();
        mockGet.mockResolvedValue({ data: { siteName: 'One', currentTheme: 'dark' } });
        const [a, b, c] = await Promise.all([api.getPublicConfig(), api.getPublicConfig(), api.siteConfig.load()]);
        expect(a.siteName).toBe('One');
        expect(b).toBe(a);
        expect(c.siteName).toBe('One');
        expect(mockGet.mock.calls.filter(([u]) => u === '/config')).toHaveLength(1);

        mockGet.mockResolvedValue({ data: { siteName: 'Two', currentTheme: 'dark' } });
        const listener = vi.fn();
        const off = api.siteConfig.subscribe(listener);
        const fresh = await api.siteConfig.refresh();
        off();
        expect(fresh.siteName).toBe('Two');
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ siteName: 'Two' }));
        expect(mockGet.mock.calls.filter(([u]) => u === '/config')).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// PostDetail — stale response cancellation
// ---------------------------------------------------------------------------
describe('PostDetail ignores a late response from a previous slug', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it('renders the latest slug even when the earlier request resolves last', async () => {
        const { PostDetail } = await import('../src/components/PostDetail');
        const { Link } = await import('react-router-dom');
        const api = await import('../src/lib/api');
        api.invalidatePublicConfig();
        let resolveSlow: (v: unknown) => void = () => {};
        mockGet.mockImplementation((url: string) => {
            if (url === '/config') return Promise.resolve({ data: { siteName: 'S' } });
            if (url === '/posts/slow') return new Promise(r => { resolveSlow = r; });
            if (url === '/posts/fast') return Promise.resolve({ data: { title: 'Fast', content: 'fast body' } });
            return Promise.reject(new Error('unexpected ' + url));
        });
        render(
            <MemoryRouter initialEntries={['/post/slow']}>
                <Link to="/post/fast">go-fast</Link>
                <Routes>
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('go-fast'));
        await screen.findByText('fast body');
        await act(async () => {
            resolveSlow({ data: { title: 'Slow', content: 'slow body' } });
        });
        expect(screen.queryByText('slow body')).toBeNull();
        expect(screen.getByText('fast body')).toBeInTheDocument();
    });
});
