/**
 * Track #1682 slice 1 — the site title must render as ONE consistently styled
 * span (Navbar no longer splits "The" from the rest of the name).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const post = vi.fn();
const applyTheme = vi.fn().mockResolvedValue(null);
const toggleThemeMode = vi.fn().mockResolvedValue('dark');

const siteConfigLoad = vi.fn().mockResolvedValue({ siteName: 'The FreeBSD Guy', siteLogo: undefined });

vi.mock('../src/lib/api', () => ({
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
    getPublicConfig: () => get('/config').then((r: any) => r.data),
    invalidatePublicConfig: () => {},
    applyTheme: (...a: unknown[]) => applyTheme(...a),
    getEffectiveThemeMode: (m?: string) => (m === 'light' ? 'light' : 'dark'),
    getMdEditorTheme: () => 'dark',
    setAuthModeCache: vi.fn(),
    toggleThemeMode: (...a: unknown[]) => toggleThemeMode(...a),
    siteConfig: {
        load: (...a: unknown[]) => siteConfigLoad(...a),
        refresh: (...a: unknown[]) => siteConfigLoad(...a),
        get: () => ({ siteName: 'The FreeBSD Guy' }),
        subscribe: () => () => {}
    }
}));

import { Navbar } from '../src/components/Navbar';

describe('Navbar site title', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset();
        applyTheme.mockClear();
        toggleThemeMode.mockClear();
        siteConfigLoad.mockResolvedValue({ siteName: 'The FreeBSD Guy', siteLogo: undefined });
        get.mockResolvedValue({
            data: {
                currentTheme: 'dark',
                appearance: { themeMode: 'dark', crtEffects: true, textGlow: true }
            }
        });
    });

    it('renders the whole site name as one consistently styled span', async () => {
        const setUser = vi.fn();
        render(
            <MemoryRouter>
                <Navbar user={null} setUser={setUser} />
            </MemoryRouter>
        );
        await waitFor(() => expect(siteConfigLoad).toHaveBeenCalled());

        const el = screen.getByText('The FreeBSD Guy');
        // It is a single element carrying the full name.
        expect(el.textContent).toBe('The FreeBSD Guy');

        const link = el.closest('a');
        expect(link).toBeTruthy();
        // The link text is exactly the full name, nothing else.
        expect(link!.textContent).toBe('The FreeBSD Guy');

        // Exactly one span inside the link (no split first/second-word spans).
        const spans = link!.querySelectorAll('span');
        expect(spans.length).toBe(1);

        // That span carries the site-name colour (consistent), and no child span
        // carries a different inline colour.
        const color = spans[0].style.color;
        expect(color).toBe('var(--site-name-color, var(--accent))');
        for (const s of Array.from(spans)) {
            expect(s.style.color).toBe(color);
        }
    });
});