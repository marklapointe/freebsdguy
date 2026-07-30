import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('axios', () => {
    const mockAxiosInstance = {
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() }
        },
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        create: vi.fn().mockReturnThis()
    };
    return {
        default: {
            ...mockAxiosInstance,
            create: vi.fn(() => mockAxiosInstance)
        }
    };
});

vi.mock('../src/lib/api', () => ({
    api: {
        get: vi.fn(),
        post: vi.fn(),
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() }
        }
    },
    applyTheme: vi.fn().mockResolvedValue(null),
    getMdEditorTheme: vi.fn().mockReturnValue('dark'),
    fetchThemeCatalog: vi.fn().mockResolvedValue([
        { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' },
        { id: 'light', label: 'Light', mdEditorTheme: 'light' }
    ]),
    cycleTheme: vi.fn(),
    siteConfig: {
        load: vi.fn().mockResolvedValue({ siteName: 'MDWeb', currentTheme: 'dark' }),
        get: vi.fn().mockReturnValue({ siteName: 'MDWeb', currentTheme: 'dark' }),
        subscribe: vi.fn().mockReturnValue(() => {}),
        notify: vi.fn()
    }
}));

import App from '../src/App';
import { api } from '../src/lib/api';

const commonMocks = (url: string) => {
    if (url.startsWith('/posts?')) return Promise.resolve({ data: { posts: [], total: 0, limit: 10, offset: 0 } });
    if (url === '/posts') return Promise.resolve({ data: [] });
    if (url === '/config') return Promise.resolve({ data: { siteName: 'MDWeb', currentTheme: 'dark' } });
    if (url === '/admin/config-status') return Promise.resolve({ data: { isWritable: true } });
    if (url === '/admin/users') return Promise.resolve({ data: [] });
    if (url.startsWith('/admin/images')) return Promise.resolve({ data: { files: [], total: 0, limit: 30, offset: 0 } });
    if (url === '/admin/themes') return Promise.resolve({ data: [] });
    if (url.includes('/theme')) return Promise.resolve({ data: { '--bg': '#121212' } });
    return null;
};

describe('App Component', () => {
    beforeEach(() => {
        window.history.pushState({}, 'Home', '/');
        vi.clearAllMocks();
        localStorage.clear();
        
        // Mock default responses for the api instance
        (api.get as any).mockImplementation((url: string) => {
            const mock = commonMocks(url);
            if (mock) return mock;
            return Promise.reject(new Error(`not found: ${url}`));
        });
    });

    it('renders site title', async () => {
        render(<App />);
        await waitFor(() => {
            expect(screen.getAllByText(/MDWeb/i).length).toBeGreaterThan(0);
        });
    });

    it('navigates to login page', async () => {
        render(<App />);
        const loginLink = await screen.findByTestId('login-link');
        fireEvent.click(loginLink);
        // Look for the heading in the login form
        expect(screen.getByRole('heading', { name: /Login/i })).toBeTruthy();
    });

    it('handles login successfully', async () => {
        (api.post as any).mockResolvedValueOnce({ 
            data: { token: 'fake-token', role: 'admin', username: 'admin', theme: 'dark' } 
        });
        
        render(<App />);
        const loginLink = await screen.findByTestId('login-link');
        fireEvent.click(loginLink);
        
        fireEvent.change(screen.getByTestId('username-input'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'admin' } });
        fireEvent.click(screen.getByTestId('login-submit'));

        await waitFor(() => {
            expect(localStorage.getItem('token')).toBe('fake-token');
        });
    });

    it('renders posts on home page', async () => {
        const mockPosts = [
            { slug: 'test-post', title: 'Test Post', date: '2026-01-01', summary: 'Test summary', content: 'Test content' }
        ];
        (api.get as any).mockImplementation((url: string) => {
            if (url.includes('/posts')) return Promise.resolve({ data: { posts: mockPosts, total: 1, limit: 10, offset: 0 } });
            const mock = commonMocks(url);
            if (mock) return mock;
            return Promise.reject(new Error(`not found: ${url}`));
        });

        render(<App />);
        expect(await screen.findByText('Test Post')).toBeTruthy();
        expect(screen.getByText('Test summary')).toBeTruthy();
    });
});
