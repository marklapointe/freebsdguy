/**
 * Track #1682 FOUC follow-up, rule 5: paintTheme may keep running later, but it
 * must NOT remove the server-set <html> class/attributes before applying the
 * same values — otherwise the first paint would flicker between two identical
 * states. Characterization test locking that behaviour in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: (...a: unknown[]) => mockGet(...a),
            post: vi.fn(),
            interceptors: {
                request: { use: () => {} },
                response: { use: () => {} }
            }
        })
    }
}));

import { applyTheme } from '../src/lib/api';

const PACK = {
    '--primary': '#f2f4f7',
    '--secondary': '#161b22',
    '--accent': '#a5b4fc',
    '--text': '#e6e8eb',
    '--bg': '#0e1116',
    '--border': '#262c36',
    '--hover': '#1c222b',
    '--site-name-color': '#f2f4f7',
    '--on-accent': '#0a0a0a',
    '--on-primary': '#0a0a0a'
};

describe('paintTheme keeps server-set html attrs (no remove-then-reapply)', () => {
    let removeAttrSpy: ReturnType<typeof vi.spyOn>;
    let classRemoveSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const el = document.documentElement;
        // Simulate exactly what the server shell emits for pack "dark".
        el.classList.add('editorial');
        el.setAttribute('data-theme', 'dark');
        el.setAttribute('data-theme-mode', 'dark');
        el.setAttribute('data-site-accent', 'indigo');
        mockGet.mockReset();
        mockGet.mockResolvedValue({ data: PACK });
        removeAttrSpy = vi.spyOn(el, 'removeAttribute');
        classRemoveSpy = vi.spyOn(el.classList, 'remove');
    });

    afterEach(() => {
        const el = document.documentElement;
        el.classList.remove('editorial');
        el.removeAttribute('data-theme');
        el.removeAttribute('data-theme-mode');
        el.removeAttribute('data-site-accent');
        vi.restoreAllMocks();
    });

    it('does not removeAttribute or drop .editorial when the same pack paints', async () => {
        await applyTheme('dark', { mode: 'dark', crtEffects: false, textGlow: false });
        const el = document.documentElement;
        expect(removeAttrSpy).not.toHaveBeenCalled();
        expect(classRemoveSpy).not.toHaveBeenCalledWith('editorial');
        // Same values still in place (set, never removed-then-set).
        expect(el.getAttribute('data-theme')).toBe('dark');
        expect(el.getAttribute('data-theme-mode')).toBe('dark');
        expect(el.getAttribute('data-site-accent')).toBe('indigo');
        expect(el.classList.contains('editorial')).toBe(true);
        // And the pack paints its vars as before.
        expect(el.style.getPropertyValue('--bg')).toBe('#0e1116');
    });
});
