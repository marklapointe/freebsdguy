/**
 * Broad Admin.tsx coverage: tabs, site save, appearance, security, users, AI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock('../src/lib/api', () => ({
    api: {
        get: (...a: unknown[]) => get(...a),
        post: (...a: unknown[]) => post(...a),
        delete: (...a: unknown[]) => del(...a)
    },
    applyTheme: vi.fn().mockResolvedValue(null),
    fetchThemeCatalog: vi.fn().mockResolvedValue([
        { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' },
        { id: 'matrix', label: 'Matrix', mdEditorTheme: 'dark' }
    ]),
    getMdEditorTheme: () => 'dark',
    getEffectiveThemeMode: () => 'dark'
}));

vi.mock('md-editor-rt', () => ({
    MdEditor: ({ modelValue }: any) => <div data-testid="md-editor">{modelValue}</div>,
    MdPreview: ({ modelValue }: any) => <div>{modelValue}</div>
}));

vi.mock('../src/components/PostModal', () => ({
    PostModal: ({ isOpen, post, onCancel, onSave }: any) =>
        isOpen ? (
            <div data-testid="post-modal">
                <span data-testid="modal-content">{post.content || ''}</span>
                <button type="button" onClick={onCancel}>
                    close-modal
                </button>
                <button type="button" onClick={e => onSave(e)}>
                    save-modal
                </button>
            </div>
        ) : null
}));

vi.mock('../src/components/ImageModals', () => ({
    ImagePickerModal: () => null,
    ImagePreviewModal: () => null
}));

import { Admin } from '../src/components/admin/Admin';

const baseConfig = {
    siteName: 'Site',
    siteLogo: 'logo.webp',
    currentTheme: 'dark',
    pagination: 10,
    sortBy: 'date',
    sortOrder: 'desc',
    searchPlacement: 'top',
    footer: { show: true, copyrightText: '© {year} {siteName}', creditText: '' },
    appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
    service: { port: 5173 },
    postsDir: './posts',
    themeDir: './themes',
    security: {
        authMode: 'jwt',
        sessionTtlSeconds: 86400,
        disableAI: false,
        disableImages: false,
        disablePublicSearch: false,
        authSecretSet: true
    },
    aiConfig: {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        modelId: 'llama3',
        apiKey: '',
        apiKeySet: false
    }
};

function setupMocks() {
    get.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/config')) return Promise.resolve({ data: { ...baseConfig } });
        if (u.includes('/admin/users'))
            return Promise.resolve({ data: [{ username: 'admin', role: 'admin' }] });
        if (u.includes('/posts/') && !u.includes('limit'))
            return Promise.resolve({
                data: {
                    slug: 'demo',
                    title: 'Demo',
                    content: '# Full body content here',
                    summary: 's',
                    date: '2026-01-01',
                    author: 'admin',
                    pinned: false
                }
            });
        if (u.includes('/posts'))
            return Promise.resolve({
                data: {
                    posts: [
                        {
                            slug: 'demo',
                            title: 'Demo',
                            summary: 's',
                            date: '2026-01-01',
                            author: 'admin',
                            pinned: false
                        }
                    ],
                    total: 1
                }
            });
        if (u.includes('/admin/images') || u.includes('/images'))
            return Promise.resolve({ data: { images: [], total: 0 } });
        if (u.includes('/theme'))
            return Promise.resolve({
                data: {
                    '--bg': '#000',
                    '--text': '#fff',
                    '--primary': '#0f0',
                    '--secondary': '#111',
                    '--accent': '#0a0',
                    '--border': '#222',
                    '--hover': '#333',
                    '--site-name-color': '#0f0'
                }
            });
        if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
        if (u.includes('/ai/models')) return Promise.resolve({ data: ['llama3', 'mistral'] });
        return Promise.resolve({ data: {} });
    });
    post.mockResolvedValue({ data: { message: 'ok' } });
    del.mockResolvedValue({ data: { message: 'ok' } });
}

describe('Admin coverage', () => {
    const showAlert = vi.fn();
    const showConfirm = vi.fn((_m: string, fn: () => void) => fn());

    beforeEach(() => {
        setupMocks();
        showAlert.mockClear();
        showConfirm.mockClear();
    });

    function renderAdmin() {
        return render(
            <MemoryRouter>
                <Admin
                    user={{ username: 'admin', role: 'admin' }}
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

    it('loads and opens Site settings, saves', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        fireEvent.click(screen.getByText('Site'));
        await waitFor(() => expect(screen.getByTestId('site-settings-heading')).toBeTruthy());
        fireEvent.change(screen.getByTestId('site-pagination-input'), { target: { value: '5' } });
        fireEvent.change(screen.getByTestId('footer-copyright-input'), {
            target: { value: '© {year} Custom' }
        });
        fireEvent.click(screen.getByTestId('footer-clear-copyright'));
        fireEvent.click(screen.getByTestId('site-save-button'));
        await waitFor(() => expect(post).toHaveBeenCalled());
    });

    it('opens appearance and security and AI tabs', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() => expect(screen.getByTestId('admin-theme-mode')).toBeTruthy());
        fireEvent.change(screen.getByTestId('admin-theme-mode'), { target: { value: 'light' } });
        fireEvent.click(screen.getByTestId('theme-card-matrix'));
        fireEvent.click(screen.getByText('Security'));
        await waitFor(() => expect(screen.getByTestId('security-settings-heading')).toBeTruthy());
        fireEvent.change(screen.getByTestId('auth-mode-select'), { target: { value: 'session' } });
        fireEvent.click(screen.getByTestId('security-save-button'));
        fireEvent.click(screen.getByText('AI Settings'));
        await waitFor(() => expect(screen.getByTestId('ai-settings-heading')).toBeTruthy());
        fireEvent.click(screen.getByTestId('ai-save-button'));
        await waitFor(() => expect(post).toHaveBeenCalled());
    });

    it('edits post loading full content', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('edit-post-demo')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-post-demo'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
        expect(screen.getByTestId('modal-content').textContent).toContain('Full body');
        fireEvent.click(screen.getByText('close-modal'));
    });

    it('creates user', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        fireEvent.click(screen.getByText('Users'));
        await waitFor(() => expect(screen.getByTestId('user-create-panel')).toBeTruthy());
        fireEvent.change(screen.getByTestId('new-user-username'), { target: { value: 'bob' } });
        fireEvent.change(screen.getByTestId('new-user-password'), { target: { value: 'password1' } });
        fireEvent.click(screen.getByTestId('new-user-submit'));
        await waitFor(() => expect(post).toHaveBeenCalled());
    });

    it('new post button opens modal', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        fireEvent.click(screen.getByText('New Post'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
    });
});
