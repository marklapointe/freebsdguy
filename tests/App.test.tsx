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
    getStoredThemeMode: vi.fn().mockReturnValue(null),
    getEffectiveThemeMode: vi.fn().mockReturnValue('dark'),
    setStoredThemeMode: vi.fn(),
    toggleThemeMode: vi.fn().mockResolvedValue('light'),
    fetchThemeCatalog: vi.fn().mockResolvedValue([
        { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' },
        { id: 'light', label: 'Light', mdEditorTheme: 'light' }
    ]),
    setSiteTheme: vi.fn(),
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
            data: { token: 'fake-token', role: 'admin', username: 'admin' } 
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

    it('keeps session on refresh when token is in localStorage', async () => {
        localStorage.setItem('token', 'stored-token');
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', 'admin');
        window.history.pushState({}, 'Admin', '/admin');

        render(<App />);

        // Must not bounce to login form while token is present
        await waitFor(() => {
            expect(screen.queryByTestId('username-input')).toBeNull();
        });
        // Admin chrome / settings affordance
        await waitFor(() => {
            expect(screen.getByTestId('admin-link') || screen.getByText(/Posts/i)).toBeTruthy();
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

    it('admin save triggers showAlert notification and confirm modal', async () => {
        localStorage.setItem('token', 'stored-token');
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', 'admin');
        window.history.pushState({}, 'Admin', '/admin');

        (api.get as any).mockImplementation((url: string) => {
            if (url === '/config')
                return Promise.resolve({
                    data: {
                        siteName: 'MDWeb',
                        currentTheme: 'dark',
                        pagination: 10,
                        footer: { show: true, copyrightText: '© {year}', creditText: '' },
                        appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
                        security: { authMode: 'jwt', sessionTtlSeconds: 86400 },
                        service: { port: 5173 },
                        aiConfig: { enabled: false, provider: 'ollama', baseUrl: 'http://x', modelId: 'm' }
                    }
                });
            if (url === '/me') return Promise.resolve({ data: { username: 'admin', role: 'admin' } });
            if (url === '/admin/users') return Promise.resolve({ data: [{ username: 'admin', role: 'admin' }] });
            if (url.startsWith('/admin/images')) return Promise.resolve({ data: { images: [], total: 0 } });
            if (url.includes('/posts')) return Promise.resolve({ data: { posts: [{ slug: 'p', title: 'P', date: '2026-01-01', pinned: false }], total: 1 } });
            if (url.includes('/theme')) return Promise.resolve({ data: { '--bg': '#000', '--text': '#fff' } });
            if (url === '/admin/config-status') return Promise.resolve({ data: { isWritable: true } });
            const mock = commonMocks(url);
            if (mock) return mock;
            return Promise.resolve({ data: {} });
        });
        (api.post as any).mockResolvedValue({ data: { message: 'ok' } });
        (api as any).delete = vi.fn().mockResolvedValue({ data: {} });

        render(<App />);
        await waitFor(() => expect(screen.getByText('Site')).toBeTruthy());
        fireEvent.click(screen.getByText('Site'));
        await waitFor(() => expect(screen.getByTestId('site-save-button')).toBeTruthy());
        fireEvent.click(screen.getByTestId('site-save-button'));
        // Notification from showAlert (title and/or message)
        await waitFor(() =>
            expect(screen.getAllByText(/Settings saved|successfully|Success/i).length).toBeGreaterThan(0)
        );

        // Delete post triggers showConfirm → Modal
        fireEvent.click(screen.getByText('Posts'));
        await waitFor(() => expect(screen.getByText('P')).toBeTruthy());
        const row = screen.getByText('P').closest('div')!.parentElement!;
        const buttons = row.querySelectorAll('button');
        fireEvent.click(buttons[buttons.length - 1]);
        await waitFor(() => expect(screen.getByText(/Are you sure/i)).toBeTruthy());
        // Cancel closes modal (onCancel path)
        fireEvent.click(screen.getByText('Cancel'));
        // Open confirm again and OK
        fireEvent.click(buttons[buttons.length - 1]);
        await waitFor(() => expect(screen.getByText(/Are you sure/i)).toBeTruthy());
        fireEvent.click(screen.getByText('OK'));
        // close notification if present
        const closeBtns = screen.queryAllByRole('button');
        const xBtn = closeBtns.find(b => b.querySelector('svg') && b.closest('.fixed'));
        if (xBtn) fireEvent.click(xBtn);
    });
});
