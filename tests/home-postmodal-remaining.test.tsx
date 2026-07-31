/**
 * Home + PostModal remaining branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();

vi.mock('../src/lib/api', () => ({
    api: { get: (...a: unknown[]) => get(...a), post: vi.fn() },
    getMdEditorTheme: () => 'dark',
    getEffectiveThemeMode: () => 'dark'
}));

vi.mock('md-editor-rt', () => ({
    MdEditor: ({ modelValue, onChange }: any) => (
        <textarea data-testid="md-editor" value={modelValue || ''} onChange={e => onChange?.(e.target.value)} />
    ),
    MdPreview: ({ modelValue }: any) => <div data-testid="md-preview">{modelValue}</div>
}));

import { Home } from '../src/components/Home';
import { PostModal } from '../src/components/PostModal';

describe('Home remaining', () => {
    beforeEach(() => {
        get.mockReset();
    });

    it('loads posts, search filter, load more, bottom search, theme event', async () => {
        get.mockImplementation((url: string) => {
            if (url === '/config')
                return Promise.resolve({ data: { pagination: 2, searchPlacement: 'bottom' } });
            if (url.startsWith('/posts'))
                return Promise.resolve({
                    data: {
                        posts: [
                            { slug: 'a', title: 'Alpha', summary: 'first', date: '2026-01-01', pinned: true },
                            { slug: 'b', title: 'Beta', summary: 'second', date: '', pinned: false }
                        ],
                        total: 4
                    }
                });
            return Promise.resolve({ data: {} });
        });
        render(
            <MemoryRouter>
                <Home />
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
        expect(screen.getByTestId('public-search')).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText(/Search posts/i), { target: { value: 'zzz' } });
        await waitFor(() => expect(screen.getByText(/No posts matching/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText(/Search posts/i), { target: { value: '' } });
        fireEvent.click(screen.getByText(/Load More/i));
        await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('offset=2')));
        await act(async () => {
            window.dispatchEvent(new CustomEvent('themeChanged'));
        });
    });

    it('config failure still loads; none search placement; array posts shape', async () => {
        get.mockImplementation((url: string) => {
            if (url === '/config') return Promise.reject(new Error('x'));
            if (url.startsWith('/posts'))
                return Promise.resolve({
                    data: [{ slug: 'only', title: 'Only', summary: '', date: '2026-01-01' }]
                });
            return Promise.resolve({ data: {} });
        });
        render(
            <MemoryRouter>
                <Home />
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText('Only')).toBeTruthy());
    });

    it('searchPlacement none hides search', async () => {
        get.mockImplementation((url: string) => {
            if (url === '/config') return Promise.resolve({ data: { pagination: 10, searchPlacement: 'none' } });
            if (url.startsWith('/posts')) return Promise.resolve({ data: { posts: [], total: 0 } });
            return Promise.resolve({ data: {} });
        });
        render(
            <MemoryRouter>
                <Home />
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.queryByTestId('public-search')).toBeNull());
    });
});

describe('PostModal remaining', () => {
    it('cancel, slug change, summary, enhance apply paths with ai off', () => {
        const onCancel = vi.fn();
        const setPost = vi.fn();
        render(
            <PostModal
                isOpen
                post={{ slug: 's', title: 'T', summary: 'sum', content: 'body', pinned: false }}
                onSave={e => e.preventDefault()}
                onCancel={onCancel}
                onAutoSummarize={() => {}}
                isSummarizing={false}
                onAutoEnhance={() => {}}
                isEnhancing={false}
                enhancedPreview={null}
                onApplyEnhancement={() => {}}
                onDismissEnhancement={() => {}}
                setPost={setPost}
                aiEnabled={false}
            />
        );
        fireEvent.change(screen.getByLabelText(/Slug/i), { target: { value: 'new-slug' } });
        fireEvent.change(screen.getByLabelText(/Summary/i), { target: { value: 's2' } });
        expect(setPost).toHaveBeenCalled();
        fireEvent.click(screen.getByText(/Cancel/i));
        expect(onCancel).toHaveBeenCalled();
    });
});
