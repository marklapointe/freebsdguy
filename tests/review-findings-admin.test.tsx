/**
 * Admin.tsx regressions from CODE_REVIEW_FINDINGS.md (#6, #9, #10, uploads, handlers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const refresh = vi.fn().mockResolvedValue({ siteName: 'New' });

vi.mock('../src/lib/api', () => ({
    api: {
        get: (...a: unknown[]) => get(...a),
        post: (...a: unknown[]) => post(...a),
        delete: (...a: unknown[]) => del(...a)
    },
    applyTheme: vi.fn().mockResolvedValue(null),
    fetchThemeCatalog: vi.fn().mockResolvedValue([{ id: 'dark', label: 'Dark', mdEditorTheme: 'dark' }]),
    getMdEditorTheme: () => 'dark',
    getEffectiveThemeMode: (m?: string) => (m === 'light' ? 'light' : 'dark'),
    siteConfig: { refresh: (...a: unknown[]) => refresh(...a), load: vi.fn(), subscribe: () => () => {}, notify: vi.fn() }
}));

vi.mock('md-editor-rt', () => ({
    MdEditor: () => null,
    MdPreview: ({ modelValue }: any) => <div>{modelValue}</div>
}));
vi.mock('../src/components/PostModal', () => ({ PostModal: () => null }));
vi.mock('../src/components/ImageModals', () => ({ ImagePickerModal: () => null, ImagePreviewModal: () => null }));

import { Admin } from '../src/components/admin/Admin';

const baseConfig = {
    siteName: 'Site',
    siteLogo: 'logo.webp',
    currentTheme: 'amber',
    pagination: 10,
    sortBy: 'date',
    sortOrder: 'desc',
    searchPlacement: 'top',
    footer: { show: true, copyrightText: '', creditText: '' },
    appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
    service: { port: 5173 },
    security: { authMode: 'jwt', sessionTtlSeconds: 86400, disableAI: false, disableImages: false, disablePublicSearch: false },
    aiConfig: { enabled: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', modelId: 'llama3', apiKey: 'sk-secret' }
};

function setupMocks() {
    get.mockImplementation((url: string) => {
        const u = String(url);
        if (u === '/config') return Promise.resolve({ data: JSON.parse(JSON.stringify(baseConfig)) });
        if (u.includes('/admin/users')) return Promise.resolve({ data: [{ username: 'admin', role: 'admin' }, { username: 'a b', role: 'contributor' }] });
        if (u.includes('/posts'))
            return Promise.resolve({ data: { posts: [{ slug: 'my post', title: 'My Post', summary: '', date: '', author: 'admin' }], total: 1 } });
        if (u.includes('/admin/images')) return Promise.resolve({ data: { images: [], total: 0 } });
        if (u.includes('/theme')) return Promise.resolve({ data: { '--bg': '#000' } });
        if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
        if (u.includes('/ai/models')) return Promise.resolve({ data: ['llama3'] });
        return Promise.resolve({ data: {} });
    });
    post.mockResolvedValue({ data: { message: 'ok' } });
    del.mockResolvedValue({ data: { message: 'ok' } });
}

const showAlert = vi.fn();
const showConfirm = vi.fn((_m: string, fn: () => void) => fn());

function renderAdmin(role: 'admin' | 'contributor' = 'admin') {
    return render(
        <MemoryRouter>
            <Admin
                user={{ username: 'u', role }}
                siteName="Site"
                setSiteName={vi.fn()}
                siteLogo="logo.webp"
                setSiteLogo={vi.fn()}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        </MemoryRouter>
    );
}

const themeCalls = () => get.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/theme'));

describe('Admin review findings', () => {
    beforeEach(() => {
        setupMocks();
        get.mockClear();
        post.mockClear();
        del.mockClear();
        refresh.mockClear();
        showAlert.mockClear();
        document.documentElement.style.cssText = '';
    });

    it('#9 contributor never fetches /theme (no config, no :root overwrite)', async () => {
        renderAdmin('contributor');
        await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/posts')));
        await new Promise(r => setTimeout(r, 20));
        expect(themeCalls()).toHaveLength(0);
    });

    it('#9 admin fetches /theme only for the loaded site theme, never the hard-coded dark default', async () => {
        renderAdmin('admin');
        await waitFor(() => expect(themeCalls().length).toBeGreaterThan(0));
        for (const u of themeCalls()) expect(u).toContain('name=amber');
    });

    it('#6 /ai/models request never carries the API key', async () => {
        renderAdmin('admin');
        await waitFor(() => expect(get).toHaveBeenCalledWith('/config'));
        fireEvent.click(await screen.findByRole('button', { name: /AI/i }));
        await waitFor(() => expect(get.mock.calls.some(c => String(c[0]).startsWith('/ai/models'))).toBe(true));
        for (const c of get.mock.calls.filter(c => String(c[0]).startsWith('/ai/models'))) {
            expect(String(c[0])).not.toMatch(/apiKey/);
            expect(String(c[0])).not.toContain('sk-secret');
        }
    });

    it('#10 saving site settings refreshes the shared site config', async () => {
        renderAdmin('admin');
        await waitFor(() => expect(get).toHaveBeenCalledWith('/config'));
        fireEvent.click(await screen.findByRole('button', { name: /^Site$/i }));
        const save = await screen.findByRole('button', { name: /Save site settings/i });
        fireEvent.click(save);
        await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/config', expect.any(Object)));
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('delete post encodes the slug and surfaces failures', async () => {
        del.mockRejectedValueOnce(new Error('nope'));
        renderAdmin('admin');
        await waitFor(() => expect(screen.getByText('My Post')).toBeTruthy());
        const postRow = screen.getByText('My Post').closest('div')!.parentElement!;
        const buttons = postRow.querySelectorAll('button');
        fireEvent.click(buttons[buttons.length - 1]);
        await waitFor(() => expect(del).toHaveBeenCalledWith('/posts/my%20post'));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringMatching(/nope|delete/i), expect.any(String)));
    });
});
