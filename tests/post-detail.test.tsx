import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const get = vi.fn();
vi.mock('../src/lib/api', () => ({
    api: { get: (...a: unknown[]) => get(...a) },
    getMdEditorTheme: () => 'dark',
    siteConfig: {
        load: vi.fn().mockResolvedValue({ siteName: 'Test' })
    }
}));
vi.mock('md-editor-rt', () => ({
    MdPreview: ({ modelValue }: { modelValue: string }) => <div data-testid="preview">{modelValue}</div>,
    MdCatalog: () => <div data-testid="catalog" />
}));

import { PostDetail } from '../src/components/PostDetail';

describe('PostDetail', () => {
    beforeEach(() => {
        get.mockReset();
    });

    it('loads and renders a post', async () => {
        get.mockResolvedValue({
            data: {
                title: 'Hello',
                content: '# Body',
                date: '2026-01-01',
                author: 'admin',
                summary: 'sum'
            }
        });
        render(
            <MemoryRouter initialEntries={['/post/hello']}>
                <Routes>
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy());
        expect(screen.getByTestId('preview').textContent).toContain('Body');
    });

    it('shows not found when missing', async () => {
        get.mockRejectedValue(new Error('404'));
        render(
            <MemoryRouter initialEntries={['/post/missing']}>
                <Routes>
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByTestId('post-not-found')).toBeTruthy());
    });

    it('reacts to themeChanged event', async () => {
        get.mockResolvedValue({
            data: { title: 'T', content: 'c', date: '2026-01-01', author: 'a', summary: 's' }
        });
        render(
            <MemoryRouter initialEntries={['/post/t']}>
                <Routes>
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText('T')).toBeTruthy());
        window.dispatchEvent(new CustomEvent('themeChanged'));
    });

    it('shows not found when slug param is empty', async () => {
        render(
            <MemoryRouter initialEntries={['/post/']}>
                <Routes>
                    <Route path="/post/" element={<PostDetail />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByTestId('post-not-found')).toBeTruthy());
    });
});
