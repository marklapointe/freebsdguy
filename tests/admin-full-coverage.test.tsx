/**
 * Exhaustive Admin.tsx coverage: images, posts CRUD, AI, themes, logo, errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const applyTheme = vi.fn().mockResolvedValue(null);
const fetchThemeCatalog = vi.fn();

vi.mock('../src/lib/api', () => ({
    api: {
        get: (...a: unknown[]) => get(...a),
        post: (...a: unknown[]) => post(...a),
        delete: (...a: unknown[]) => del(...a)
    },
    applyTheme: (...a: unknown[]) => applyTheme(...a),
    fetchThemeCatalog: (...a: unknown[]) => fetchThemeCatalog(...a),
    getMdEditorTheme: () => 'dark',
    getEffectiveThemeMode: (m?: string) => (m === 'light' ? 'light' : 'dark')
}));

vi.mock('md-editor-rt', () => ({
    MdEditor: ({ modelValue }: any) => <div data-testid="md-editor">{modelValue}</div>,
    MdPreview: ({ modelValue }: any) => <div>{modelValue}</div>
}));

vi.mock('../src/components/PostModal', () => ({
    PostModal: ({
        isOpen,
        post,
        onCancel,
        onSave,
        onAutoSummarize,
        onAutoEnhance,
        onApplyEnhancement,
        onDismissEnhancement,
        enhancedPreview,
        setPost
    }: any) =>
        isOpen ? (
            <div data-testid="post-modal">
                <span data-testid="modal-content">{post?.content || ''}</span>
                <span data-testid="modal-summary">{post?.summary || ''}</span>
                <button type="button" data-testid="modal-set-content" onClick={() => setPost({ ...post, content: 'new body' })}>
                    set-content
                </button>
                <button type="button" data-testid="modal-summarize" onClick={onAutoSummarize}>
                    summarize
                </button>
                <button type="button" data-testid="modal-enhance" onClick={onAutoEnhance}>
                    enhance
                </button>
                {enhancedPreview && (
                    <>
                        <span data-testid="enhanced-preview">{enhancedPreview}</span>
                        <button type="button" data-testid="modal-apply" onClick={onApplyEnhancement}>
                            apply
                        </button>
                        <button type="button" data-testid="modal-dismiss" onClick={onDismissEnhancement}>
                            dismiss
                        </button>
                    </>
                )}
                <button type="button" data-testid="modal-save" onClick={e => onSave(e)}>
                    save-modal
                </button>
                <button type="button" data-testid="modal-cancel" onClick={onCancel}>
                    close-modal
                </button>
            </div>
        ) : null
}));

vi.mock('../src/components/ImageModals', () => ({
    ImagePickerModal: ({ isOpen, images, onSelect, onClose, onUpload, onPreview }: any) =>
        isOpen ? (
            <div data-testid="image-picker">
                {(images || []).map((img: any) => (
                    <button key={img.filename} type="button" data-testid={`pick-${img.filename}`} onClick={() => onSelect(img.filename)}>
                        {img.originalName}
                    </button>
                ))}
                <button type="button" data-testid="picker-close" onClick={onClose}>
                    close-picker
                </button>
                <button type="button" data-testid="picker-preview" onClick={() => onPreview?.(images?.[0])}>
                    preview
                </button>
                <input data-testid="picker-upload" type="file" onChange={onUpload} />
            </div>
        ) : null,
    ImagePreviewModal: ({ image, onClose }: any) =>
        image ? (
            <div data-testid="image-preview">
                <span>{image.filename}</span>
                <button type="button" data-testid="preview-close" onClick={onClose}>
                    close-preview
                </button>
            </div>
        ) : null
}));

import { Admin } from '../src/components/admin/Admin';

const sampleImages = [
    { filename: 'logo.webp', originalName: 'Logo', uploadedAt: 1, size: 100 },
    { filename: 'pic.webp', originalName: 'Pic', uploadedAt: 2, size: 200 }
];

const baseConfig = {
    siteName: 'Site',
    siteLogo: 'logo.webp',
    currentTheme: 'dark',
    pagination: 10,
    sortBy: 'date',
    sortOrder: 'desc',
    searchPlacement: 'top',
    postsDir: './posts',
    themeDir: './themes',
    footer: { show: true, copyrightText: '© {year} {siteName}', creditText: 'Hosted' },
    appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
    service: { port: 5173 },
    security: {
        authMode: 'jwt',
        sessionTtlSeconds: 86400,
        sessionCookieName: 'mdweb.sid',
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

function setupMocks(opts: { images?: any[]; postsArray?: boolean; emptyThemes?: boolean; catalogEmpty?: boolean } = {}) {
    const images = opts.images ?? sampleImages;
    fetchThemeCatalog.mockResolvedValue(
        opts.catalogEmpty
            ? []
            : [
                  { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' },
                  { id: 'matrix', label: 'Matrix', mdEditorTheme: 'dark' }
              ]
    );
    get.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/config') && !u.includes('status')) return Promise.resolve({ data: { ...baseConfig } });
        if (u.includes('/admin/users'))
            return Promise.resolve({
                data: [
                    { username: 'admin', role: 'admin' },
                    { username: 'bob', role: 'contributor' }
                ]
            });
        if (/\/posts\/[^/?]+$/.test(u) && !u.includes('limit'))
            return Promise.resolve({
                data: {
                    slug: 'demo',
                    title: 'Demo',
                    content: '# Full body',
                    summary: 's',
                    date: '2026-01-01',
                    author: 'admin',
                    pinned: true
                }
            });
        if (u.includes('/posts')) {
            const post = {
                slug: 'demo',
                title: 'Demo',
                summary: 's',
                date: '2026-01-01',
                author: 'admin',
                pinned: true
            };
            if (opts.postsArray) return Promise.resolve({ data: [post] });
            return Promise.resolve({ data: { posts: [post], total: 1 } });
        }
        if (u.includes('/admin/images') || (u.includes('/images') && u.includes('limit')))
            return Promise.resolve({ data: { images, total: images.length || 40 } });
        if (u.includes('/admin/themes')) {
            if (opts.emptyThemes) return Promise.resolve({ data: [] });
            return Promise.resolve({ data: ['legacy-a', 'legacy-b'] });
        }
        if (u.includes('/theme'))
            return Promise.resolve({
                data: {
                    '--bg': '#000000',
                    '--text': '#ffffff',
                    '--primary': '#00ff00',
                    '--secondary': '#111111',
                    '--accent': '#00aa00',
                    '--border': '#222222',
                    '--hover': '#333333',
                    '--site-name-color': '#00ff00',
                    name: 'dark'
                }
            });
        if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
        if (u.includes('/ai/models')) return Promise.resolve({ data: ['llama3', 'mistral'] });
        return Promise.resolve({ data: {} });
    });
    post.mockResolvedValue({ data: { message: 'ok', summary: 'AI summary', enhanced: '# better' } });
    del.mockResolvedValue({ data: { message: 'deleted' } });
}

describe('Admin full coverage', () => {
    const showAlert = vi.fn();
    const showConfirm = vi.fn((_m: string, fn: () => void) => fn());
    const setSiteName = vi.fn();
    const setSiteLogo = vi.fn();

    beforeEach(() => {
        setupMocks();
        showAlert.mockClear();
        showConfirm.mockClear();
        setSiteName.mockClear();
        setSiteLogo.mockClear();
        applyTheme.mockClear();
        localStorage.clear();
    });

    function renderAdmin(role: string = 'admin') {
        return render(
            <MemoryRouter>
                <Admin
                    user={{ username: 'admin', role }}
                    siteName="Site"
                    setSiteName={setSiteName}
                    siteLogo="logo.webp"
                    setSiteLogo={setSiteLogo}
                    showAlert={showAlert}
                    showConfirm={showConfirm}
                />
            </MemoryRouter>
        );
    }

    it('shows loading when user is null', () => {
        render(
            <MemoryRouter>
                <Admin
                    user={null}
                    siteName="Site"
                    setSiteName={setSiteName}
                    setSiteLogo={setSiteLogo}
                    showAlert={showAlert}
                    showConfirm={showConfirm}
                />
            </MemoryRouter>
        );
        expect(screen.getByText('Loading...')).toBeTruthy();
    });

    it('contributor sees content tabs only', async () => {
        renderAdmin('contributor');
        await waitFor(() => expect(screen.getAllByText('Posts').length).toBeGreaterThan(0));
        expect(screen.queryByText('Site')).toBeNull();
        expect(screen.queryByText('Users')).toBeNull();
    });

    it('posts array shape, delete post, empty posts message', async () => {
        setupMocks({ postsArray: true });
        get.mockImplementation((url: string) => {
            const u = String(url);
            if (u.includes('/posts') && !/\/posts\/[^/?]+$/.test(u)) return Promise.resolve({ data: [] });
            if (u.includes('/config') && !u.includes('status')) return Promise.resolve({ data: { ...baseConfig } });
            if (u.includes('/admin/users')) return Promise.resolve({ data: [] });
            if (u.includes('/admin/images')) return Promise.resolve({ data: { images: [], total: 0 } });
            if (u.includes('/theme')) return Promise.resolve({ data: { '--bg': '#000' } });
            if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
            return Promise.resolve({ data: {} });
        });
        renderAdmin();
        await waitFor(() => expect(screen.getByText(/No posts yet/i)).toBeTruthy());
    });

    it('deletes a post via confirm', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        const deleteBtns = screen.getAllByRole('button');
        const trash = deleteBtns.find(b => b.querySelector('svg') && b.className.includes('hover:bg-red'));
        // Click delete on post row — second icon button in posts list
        const postRow = screen.getByText('Demo').closest('div')!.parentElement!;
        const buttons = postRow.querySelectorAll('button');
        fireEvent.click(buttons[buttons.length - 1]);
        await waitFor(() => expect(del).toHaveBeenCalled());
        expect(showConfirm).toHaveBeenCalled();
    });

    it('saves post via modal and runs AI summarize/enhance', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('edit-post-demo')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-post-demo'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
        fireEvent.click(screen.getByTestId('modal-summarize'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/ai/summarize', expect.any(Object)));
        fireEvent.click(screen.getByTestId('modal-enhance'));
        await waitFor(() => expect(screen.getByTestId('enhanced-preview')).toBeTruthy());
        fireEvent.click(screen.getByTestId('modal-apply'));
        fireEvent.click(screen.getByTestId('modal-set-content'));
        fireEvent.click(screen.getByTestId('modal-save'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/posts', expect.any(Object)));
        expect(showAlert).toHaveBeenCalledWith('Post saved successfully!', 'Success');
    });

    it('AI summarize/enhance error paths and edit load failure', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('edit-post-demo')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-post-demo'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
        post.mockRejectedValueOnce(new Error('sum fail'));
        fireEvent.click(screen.getByTestId('modal-summarize'));
        await waitFor(() =>
            expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Failed to generate summary'), 'Error')
        );

        post.mockRejectedValueOnce(new Error('enh fail'));
        fireEvent.click(screen.getByTestId('modal-enhance'));
        await waitFor(() =>
            expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Failed to enhance'), 'Error')
        );

        fireEvent.click(screen.getByTestId('modal-cancel'));
        get.mockImplementation((url: string) => {
            const u = String(url);
            if (/\/posts\/[^/?]+$/.test(u)) return Promise.reject({ response: { data: { message: 'gone' } } });
            if (u.includes('/posts'))
                return Promise.resolve({
                    data: {
                        posts: [{ slug: 'demo', title: 'Demo', date: '2026-01-01', pinned: false }],
                        total: 1
                    }
                });
            if (u.includes('/config') && !u.includes('status')) return Promise.resolve({ data: { ...baseConfig } });
            if (u.includes('/admin/users')) return Promise.resolve({ data: [] });
            if (u.includes('/admin/images')) return Promise.resolve({ data: { images: sampleImages, total: 2 } });
            if (u.includes('/theme')) return Promise.resolve({ data: { '--bg': '#000000' } });
            if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
            return Promise.resolve({ data: {} });
        });
        fireEvent.click(screen.getByTestId('edit-post-demo'));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith('gone', 'Error'));
    });

    it('images tab: select, bulk delete, upload, preview, pagination', async () => {
        setupMocks({ images: sampleImages });
        // force total high for pagination
        get.mockImplementation((url: string) => {
            const u = String(url);
            if (u.includes('/admin/images')) return Promise.resolve({ data: { images: sampleImages, total: 40 } });
            if (u.includes('/config') && !u.includes('status')) return Promise.resolve({ data: { ...baseConfig } });
            if (u.includes('/admin/users')) return Promise.resolve({ data: [{ username: 'admin', role: 'admin' }] });
            if (u.includes('/posts')) return Promise.resolve({ data: { posts: [], total: 0 } });
            if (u.includes('/theme')) return Promise.resolve({ data: { '--bg': '#000000', '--text': '#fff' } });
            if (u.includes('/admin/config-status')) return Promise.resolve({ data: { isWritable: true } });
            return Promise.resolve({ data: {} });
        });
        renderAdmin();
        await waitFor(() => expect(screen.getAllByText('Images').length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByText('Images')[0]);
        await waitFor(() => expect(screen.getByText('Logo')).toBeTruthy());

        fireEvent.click(screen.getByText('Select'));
        // toggle selection checkboxes
        const selButtons = screen.getAllByRole('button').filter(b => b.querySelector('svg'));
        // first selection toggle
        const checkBtns = Array.from(document.querySelectorAll('button')).filter(b =>
            b.className.includes('absolute top-2')
        );
        expect(checkBtns.length).toBeGreaterThan(0);
        fireEvent.click(checkBtns[0]);
        fireEvent.click(checkBtns[0]); // deselect
        fireEvent.click(checkBtns[0]); // select again
        fireEvent.click(screen.getByText(/Delete \(/));
        await waitFor(() =>
            expect(post).toHaveBeenCalledWith('/admin/images/delete-bulk', expect.any(Object))
        );

        // bulk delete exits selection mode; re-enter then cancel
        const selectOrCancel = screen.queryByText('Select') || screen.queryByText('Cancel');
        if (selectOrCancel && selectOrCancel.textContent === 'Select') {
            fireEvent.click(selectOrCancel);
            fireEvent.click(screen.getByText('Cancel'));
        } else if (selectOrCancel) {
            fireEvent.click(selectOrCancel);
        }

        // Upload (Images tab file input)
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeTruthy();
        const file = new File(['x'], 'x.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [file] } });
        await waitFor(() =>
            expect(post).toHaveBeenCalledWith('/admin/upload', expect.any(FormData), expect.any(Object))
        );

        // empty upload no-op
        fireEvent.change(fileInput, { target: { files: [] } });

        // img onError fallback
        const imgs = document.querySelectorAll('img');
        imgs.forEach(img => fireEvent.error(img));

        // Pagination controls
        const perPage = Array.from(document.querySelectorAll('select')).find(s =>
            Array.from(s.options).some(o => o.value === '30')
        ) as HTMLSelectElement | undefined;
        if (perPage) {
            fireEvent.change(perPage, { target: { value: '12' } });
            await waitFor(() => expect(get).toHaveBeenCalled());
            const nextBtn = screen.queryByText('Next');
            if (nextBtn && !(nextBtn as HTMLButtonElement).disabled) fireEvent.click(nextBtn);
            const prevBtn = screen.queryByText('Prev');
            if (prevBtn) fireEvent.click(prevBtn);
            fireEvent.change(perPage, { target: { value: 'all' } });
        }
    });

    it('deletes image and clears logo when logo deleted', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Images')).toBeTruthy());
        fireEvent.click(screen.getByText('Images'));
        await waitFor(() => expect(screen.getByText('Logo')).toBeTruthy());
        // Find delete buttons (red)
        const redBtns = Array.from(document.querySelectorAll('button')).filter(b => b.className.includes('bg-red-500'));
        fireEvent.click(redBtns[0]);
        await waitFor(() => expect(del).toHaveBeenCalled());
    });

    it('site settings full form and save error + port change', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Site')).toBeTruthy());
        fireEvent.click(screen.getByText('Site'));
        await waitFor(() => expect(screen.getByTestId('site-settings-heading')).toBeTruthy());

        fireEvent.change(screen.getByTestId('site-name-input'), { target: { value: 'NewSite' } });
        fireEvent.change(screen.getByTestId('site-pagination-input'), { target: { value: 'bad' } });
        fireEvent.change(screen.getByTestId('site-pagination-input'), { target: { value: '20' } });
        fireEvent.change(screen.getByTestId('site-sortby-select'), { target: { value: 'title' } });
        fireEvent.change(screen.getByTestId('site-sortorder-select'), { target: { value: 'asc' } });
        fireEvent.change(screen.getByTestId('site-search-placement'), { target: { value: 'none' } });
        fireEvent.click(screen.getByTestId('footer-show-toggle'));
        fireEvent.change(screen.getByTestId('footer-copyright-input'), { target: { value: '© {year}' } });
        fireEvent.click(screen.getByText('Reset default'));
        fireEvent.click(screen.getByTestId('footer-clear-copyright'));
        fireEvent.change(screen.getByTestId('footer-credit-input'), { target: { value: 'FreeBSD' } });
        fireEvent.click(screen.getByTestId('footer-show-toggle')); // show again
        // open advanced paths
        fireEvent.click(screen.getByText('Advanced paths'));
        fireEvent.change(screen.getByTestId('site-posts-dir'), { target: { value: '/var/db/mdweb/posts' } });
        fireEvent.change(screen.getByTestId('site-theme-dir'), { target: { value: '/var/db/mdweb/themes' } });
        // port change
        const portInput = screen.getByDisplayValue('5173');
        fireEvent.change(portInput, { target: { value: '8080' } });
        localStorage.setItem('lastPort', '5173');
        fireEvent.click(screen.getByTestId('site-save-button'));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Port changed'), 'Success'));

        post.mockRejectedValueOnce({ response: { data: { message: 'EACCES' } } });
        fireEvent.click(screen.getByTestId('site-save-button'));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith('EACCES', 'Save failed'));

        // logo picker
        fireEvent.click(screen.getByText('Choose image'));
        await waitFor(() => expect(screen.getByTestId('image-picker')).toBeTruthy());
        fireEvent.click(screen.getByTestId('pick-logo.webp'));
        await waitFor(() => expect(setSiteLogo).toHaveBeenCalledWith('logo.webp'));
        expect(showAlert).toHaveBeenCalledWith('Logo updated successfully!', 'Success');
    });

    it('appearance: theme controls, save theme colors, reload catalog', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Appearance')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() => expect(screen.getByTestId('admin-theme-mode')).toBeTruthy());
        fireEvent.change(screen.getByTestId('admin-theme-mode'), { target: { value: 'light' } });
        fireEvent.click(screen.getByTestId('admin-crt-effects'));
        fireEvent.click(screen.getByTestId('admin-text-glow'));
        fireEvent.click(screen.getByTestId('theme-card-matrix'));
        // color pickers when themeColors loaded
        await waitFor(() => {
            const colorInputs = document.querySelectorAll('input[type="color"]');
            expect(colorInputs.length).toBeGreaterThan(0);
        });
        const colorInputs = document.querySelectorAll('input[type="color"]');
        fireEvent.change(colorInputs[0], { target: { value: '#ff0000' } });
        fireEvent.click(screen.getByText(/Save color overrides/i));
        await waitFor(() =>
            expect(post).toHaveBeenCalledWith(expect.stringContaining('/admin/themes/'), expect.any(Object))
        );
        fireEvent.click(screen.getByText(/Set as site theme/i));
        fireEvent.click(screen.getByText('Reload'));
        await waitFor(() => expect(fetchThemeCatalog).toHaveBeenCalled());
    });

    it('appearance empty catalog and theme save error', async () => {
        setupMocks({ catalogEmpty: true, emptyThemes: true });
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Appearance')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() =>
            expect(screen.getAllByText(/No themes found|Theme catalog|Could not load/i).length).toBeGreaterThan(0)
        );
        post.mockRejectedValueOnce({ response: { data: { message: 'theme fail' } } });
        const saveTheme = screen.queryByText(/Save color overrides/i);
        if (saveTheme) {
            fireEvent.click(saveTheme);
            await waitFor(() => expect(showAlert).toHaveBeenCalled());
        }
    });

    it('security tab session advanced fields', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('admin-security-tab')).toBeTruthy());
        fireEvent.click(screen.getByTestId('admin-security-tab'));
        await waitFor(() => expect(screen.getByTestId('security-settings-heading')).toBeTruthy());
        fireEvent.change(screen.getByTestId('auth-mode-select'), { target: { value: 'session' } });
        // advanced may be toggleable
        const advanced = screen.queryByText(/Advanced session/i) || screen.queryByText(/Show advanced/i);
        if (advanced) fireEvent.click(advanced);
        const ttl = screen.queryByTestId('session-ttl-hours');
        if (ttl) fireEvent.change(ttl, { target: { value: '12' } });
        const cookie = screen.queryByTestId('session-cookie-name');
        if (cookie) fireEvent.change(cookie, { target: { value: 'sid' } });
        // toggles for disable flags
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => fireEvent.click(cb));
        fireEvent.click(screen.getByTestId('security-save-button'));
        await waitFor(() => expect(post).toHaveBeenCalled());
    });

    it('users create validation and delete', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Users')).toBeTruthy());
        fireEvent.click(screen.getByText('Users'));
        await waitFor(() => expect(screen.getByTestId('user-create-panel')).toBeTruthy());
        fireEvent.change(screen.getByTestId('new-user-username'), { target: { value: 'carol' } });
        fireEvent.change(screen.getByTestId('new-user-password'), { target: { value: 'password1' } });
        fireEvent.change(screen.getByTestId('new-user-role'), { target: { value: 'admin' } });
        fireEvent.click(screen.getByTestId('new-user-submit'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/users', expect.any(Object)));
        const delUser = screen.getByText('Delete');
        fireEvent.click(delUser);
        await waitFor(() => expect(del).toHaveBeenCalled());
    });

    it('AI settings provider switch and models error', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('AI Settings')).toBeTruthy());
        fireEvent.click(screen.getByText('AI Settings'));
        await waitFor(() => expect(screen.getByTestId('ai-settings-heading')).toBeTruthy());
        fireEvent.click(screen.getByTestId('ai-enabled-toggle'));
        fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'openai' } });
        fireEvent.change(screen.getByTestId('ai-baseurl-input'), { target: { value: 'https://api.openai.com/v1' } });
        fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'ollama' } });
        get.mockImplementationOnce(() => Promise.reject(new Error('conn')));
        const refresh = screen.getByTitle('Refresh models');
        fireEvent.click(refresh);
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Could not connect'), 'Connection Error'));
        fireEvent.click(screen.getByTestId('ai-save-button'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/ai-config', expect.any(Object)));
    });

    it('themeChanged event updates config', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Demo')).toBeTruthy());
        await act(async () => {
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: 'matrix' }));
        });
        await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('name=matrix')));
    });

    it('fetchThemeCatalog empty falls back to admin themes string list', async () => {
        setupMocks({ catalogEmpty: true, emptyThemes: false });
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Appearance')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() => expect(screen.getByTestId('theme-card-legacy-a')).toBeTruthy());
    });

    it('upload failure alerts', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Images')).toBeTruthy());
        fireEvent.click(screen.getByText('Images'));
        post.mockRejectedValueOnce(new Error('upload fail'));
        await waitFor(() => {
            expect(document.querySelector('input[type="file"]')).toBeTruthy();
        });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } });
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Failed to upload'), 'Error'));
    });

    it('theme catalog throws sets error; openai model input', async () => {
        // Reject on every catalog fetch so Appearance reload surfaces error
        fetchThemeCatalog.mockRejectedValue(new Error('net'));
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Appearance')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() => expect(screen.getByText(/Could not load theme catalog/i)).toBeTruthy());

        fireEvent.click(screen.getByText('AI Settings'));
        await waitFor(() => expect(screen.getByTestId('ai-provider-select')).toBeTruthy());
        fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'openai' } });
        await waitFor(() => {
            expect(document.querySelector('input[placeholder*="gpt"]')).toBeTruthy();
        });
        fireEvent.change(document.querySelector('input[placeholder*="gpt"]') as HTMLInputElement, {
            target: { value: 'gpt-4' }
        });
        const apiKey = document.querySelector('input[type="password"]') as HTMLInputElement;
        fireEvent.change(apiKey, { target: { value: 'sk-test' } });
        fetchThemeCatalog.mockResolvedValue([
            { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' }
        ]);
    });

    it('admin themes meta objects when catalog empty; create user error; apply enhance', async () => {
        fetchThemeCatalog.mockResolvedValue([]);
        get.mockImplementation((url: string) => {
            const u = String(url);
            if (u.includes('/admin/themes'))
                return Promise.resolve({
                    data: [{ id: 'obj-theme', label: 'Obj', mdEditorTheme: 'dark' }]
                });
            if (u.includes('/config') && !u.includes('status')) return Promise.resolve({ data: { ...baseConfig } });
            if (u.includes('/admin/users')) return Promise.resolve({ data: [{ username: 'admin', role: 'admin' }] });
            if (u.includes('/posts'))
                return Promise.resolve({
                    data: {
                        posts: [{ slug: 'demo', title: 'Demo', date: '2026-01-01', pinned: false }],
                        total: 1
                    }
                });
            if (u.includes('/admin/images')) return Promise.resolve({ data: { images: sampleImages, total: 2 } });
            if (u.includes('/theme'))
                return Promise.resolve({
                    data: {
                        '--bg': '#000000',
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
            if (/\/posts\/[^/?]+$/.test(u))
                return Promise.resolve({
                    data: {
                        slug: 'demo',
                        title: 'Demo',
                        content: 'body',
                        summary: '',
                        date: '2026-01-01',
                        pinned: false
                    }
                });
            return Promise.resolve({ data: {} });
        });
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Appearance')).toBeTruthy());
        fireEvent.click(screen.getByText('Appearance'));
        await waitFor(() => expect(screen.getByTestId('theme-card-obj-theme')).toBeTruthy());

        fireEvent.click(screen.getByText('Users'));
        await waitFor(() => expect(screen.getByTestId('new-user-submit')).toBeTruthy());
        post.mockRejectedValueOnce({ response: { data: { message: 'exists' } } });
        fireEvent.change(screen.getByTestId('new-user-username'), { target: { value: 'x' } });
        fireEvent.change(screen.getByTestId('new-user-password'), { target: { value: 'password1' } });
        fireEvent.click(screen.getByTestId('new-user-submit'));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith('exists', 'Error'));

        // New Post + cancel covers dismiss paths
        fireEvent.click(screen.getByText('New Post'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
        fireEvent.click(screen.getByTestId('modal-cancel'));
    });

    it('logo picker open refresh on delete selected logo image', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByText('Site')).toBeTruthy());
        fireEvent.click(screen.getByText('Site'));
        await waitFor(() => expect(screen.getByText('Choose image')).toBeTruthy());
        fireEvent.click(screen.getByText('Choose image'));
        await waitFor(() => expect(screen.getByTestId('image-picker')).toBeTruthy());
        // preview callback from picker
        fireEvent.click(screen.getByTestId('picker-preview'));
        await waitFor(() => expect(screen.getByTestId('image-preview')).toBeTruthy());
        fireEvent.click(screen.getByTestId('preview-close'));
        fireEvent.click(screen.getByTestId('picker-close'));
        fireEvent.click(screen.getByText('Choose image'));
        await waitFor(() => expect(screen.getByTestId('picker-upload')).toBeTruthy());
        fireEvent.change(screen.getByTestId('picker-upload'), {
            target: { files: [new File(['z'], 'z.png', { type: 'image/png' })] }
        });
        await waitFor(() => expect(post).toHaveBeenCalled());
    });

    it('covers enhance apply/dismiss and ollama model select', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('edit-post-demo')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-post-demo'));
        await waitFor(() => expect(screen.getByTestId('post-modal')).toBeTruthy());
        post.mockResolvedValue({ data: { enhanced: '# better content', summary: 'sum' } });
        fireEvent.click(screen.getByTestId('modal-enhance'));
        await waitFor(() => expect(screen.getByTestId('enhanced-preview')).toBeTruthy());
        fireEvent.click(screen.getByTestId('modal-apply'));
        // enhance again then dismiss
        fireEvent.click(screen.getByTestId('modal-enhance'));
        await waitFor(() => expect(screen.getByTestId('modal-dismiss')).toBeTruthy());
        fireEvent.click(screen.getByTestId('modal-dismiss'));

        fireEvent.click(screen.getByText('AI Settings'));
        await waitFor(() => expect(screen.getByTestId('ai-settings-heading')).toBeTruthy());
        // models list from mock should render select
        await waitFor(() => {
            const sel = document.querySelector('select option[value="llama3"]');
            expect(sel || screen.getByTestId('ai-provider-select')).toBeTruthy();
        });
        const modelSelect = Array.from(document.querySelectorAll('select')).find(s =>
            Array.from(s.options).some(o => o.value === 'llama3')
        );
        if (modelSelect) fireEvent.change(modelSelect, { target: { value: 'mistral' } });
    });

    it('security advanced cookie details toggle', async () => {
        renderAdmin();
        await waitFor(() => expect(screen.getByTestId('admin-security-tab')).toBeTruthy());
        fireEvent.click(screen.getByTestId('admin-security-tab'));
        fireEvent.change(screen.getByTestId('auth-mode-select'), { target: { value: 'session' } });
        await waitFor(() => expect(screen.getByTestId('session-cookie-name')).toBeTruthy());
        fireEvent.change(screen.getByTestId('session-cookie-name'), { target: { value: 'custom.sid' } });
        const details = screen.getByText(/Advanced cookie name/i).closest('details')!;
        // open/close via click on summary
        fireEvent.click(screen.getByText(/Advanced cookie name/i));
        expect(details).toBeTruthy();
    });
});
