import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('axios', () => {
    const mockAxiosInstance = {
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() }
        },
        get: vi.fn(),
        post: vi.fn(),
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
    applyTheme: vi.fn()
}));

import App from '../src/App';
import { api } from '../src/lib/api';

const commonMocks = (url: string) => {
    if (url === '/config') return Promise.resolve({ data: { siteName: 'BrandingTest', currentTheme: 'dark' } });
    if (url.startsWith('/posts')) return Promise.resolve({ data: { posts: [], total: 0 } });
    if (url === '/admin/config-status') return Promise.resolve({ data: { isWritable: true } });
    if (url.includes('/theme')) return Promise.resolve({ data: { '--bg': '#121212', '--site-name-color': '#ff0000' } });
    return null;
};

describe('Site Branding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (api.get as any).mockImplementation((url: string) => {
            const mock = commonMocks(url);
            if (mock) return mock;
            return Promise.reject(new Error(`not found: ${url}`));
        });
    });

    it('renders site name text when no logo is defined', async () => {
        render(<App />);
        
        await waitFor(() => {
            // "BrandingTest" should be visible
            expect(screen.getByText('BrandingTest')).toBeTruthy();
        });

        // The first part should have the custom color
        const firstPart = screen.getByText('BrandingTest');
        expect(firstPart.style.color).toBe('var(--site-name-color, var(--accent))');
    });

    it('renders logo image when siteLogo is defined', async () => {
        (api.get as any).mockImplementation((url: string) => {
            if (url === '/config') return Promise.resolve({ data: { siteName: 'BrandingTest', siteLogo: 'logo.webp', currentTheme: 'dark' } });
            const mock = commonMocks(url);
            if (mock) return mock;
            return Promise.reject(new Error(`not found: ${url}`));
        });

        render(<App />);

        await waitFor(() => {
            const logo = screen.getByAltText('BrandingTest');
            expect(logo).toBeTruthy();
            expect(logo.getAttribute('src')).toBe('/api/getimage?fileName=logo.webp');
        });

        // Site name text should NOT be present (at least not as the main link text)
        expect(screen.queryByText('BrandingTest')).toBeNull();
    });
});
