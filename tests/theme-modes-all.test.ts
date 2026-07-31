/**
 * Exhaustive, repeatable checks: every shipped theme pack is coherent in both
 * light and dark modes, and mode derivation is pure (same inputs → same palette).
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import {
    listThemeIds,
    loadThemeColors,
    loadThemeColorsForMode,
    deriveThemeMode,
    isThemeModeCoherent,
    relativeLuminance,
    contrastRatio,
    onColorFor,
    REQUIRED_THEME_KEYS
} from '../server/lib/themes.ts';

const themesDir = path.resolve(process.cwd(), 'server/themes');
const allIds = listThemeIds(themesDir).filter((id) => !id.endsWith('-light') && !id.endsWith('-dark'));

describe('every theme pack × light/dark mode (exhaustive)', () => {
    it('ships a non-empty catalog', () => {
        expect(allIds.length).toBeGreaterThanOrEqual(20);
    });

    it.each(allIds)('%s: dark mode is surface-coherent with readable text', (id) => {
        const colors = loadThemeColorsForMode(themesDir, id, 'dark');
        expect(colors, id).toBeTruthy();
        for (const key of REQUIRED_THEME_KEYS) {
            expect(colors![key], `${id} dark missing ${key}`).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
        }
        expect(colors!.mdEditorTheme).toBe('dark');
        expect(isThemeModeCoherent(colors!, 'dark'), `${id} dark incoherent: ${JSON.stringify(colors)}`).toBe(
            true
        );
        expect(relativeLuminance(colors!['--bg'])).toBeLessThan(0.28);
        expect(relativeLuminance(colors!['--text'])).toBeGreaterThan(0.5);
        expect(contrastRatio(colors!['--text'], colors!['--bg'])).toBeGreaterThanOrEqual(3);
    });

    it.each(allIds)('%s: light mode is surface-coherent with readable text', (id) => {
        const colors = loadThemeColorsForMode(themesDir, id, 'light');
        expect(colors, id).toBeTruthy();
        for (const key of REQUIRED_THEME_KEYS) {
            expect(colors![key], `${id} light missing ${key}`).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
        }
        expect(colors!.mdEditorTheme).toBe('light');
        expect(isThemeModeCoherent(colors!, 'light'), `${id} light incoherent: ${JSON.stringify(colors)}`).toBe(
            true
        );
        expect(relativeLuminance(colors!['--bg'])).toBeGreaterThan(0.72);
        expect(relativeLuminance(colors!['--text'])).toBeLessThan(0.45);
        expect(contrastRatio(colors!['--text'], colors!['--bg'])).toBeGreaterThanOrEqual(3);
    });

    it.each(allIds)('%s: light and dark palettes differ on surfaces and are pure/repeatable', (id) => {
        const dark1 = loadThemeColorsForMode(themesDir, id, 'dark')!;
        const dark2 = loadThemeColorsForMode(themesDir, id, 'dark')!;
        const light1 = loadThemeColorsForMode(themesDir, id, 'light')!;
        const light2 = loadThemeColorsForMode(themesDir, id, 'light')!;

        // Pure: two calls → identical
        for (const key of REQUIRED_THEME_KEYS) {
            expect(dark1[key], `${id} dark not pure on ${key}`).toBe(dark2[key]);
            expect(light1[key], `${id} light not pure on ${key}`).toBe(light2[key]);
        }

        // Modes must actually change the page surface
        expect(dark1['--bg']).not.toBe(light1['--bg']);
        expect(dark1['--text']).not.toBe(light1['--text']);

        // Within a mode, secondary stays in the same family as bg (no mixed chrome)
        const darkBgL = relativeLuminance(dark1['--bg']);
        const darkSecL = relativeLuminance(dark1['--secondary']);
        const lightBgL = relativeLuminance(light1['--bg']);
        const lightSecL = relativeLuminance(light1['--secondary']);
        expect(Math.abs(darkBgL - darkSecL), `${id} dark surface family split`).toBeLessThan(0.25);
        expect(Math.abs(lightBgL - lightSecL), `${id} light surface family split`).toBeLessThan(0.25);
    });

    it.each(allIds)('%s: toggling light→dark→light returns the same light palette', (id) => {
        const base = loadThemeColors(themesDir, id)!;
        const lightA = deriveThemeMode(base, 'light');
        const dark = deriveThemeMode(base, 'dark');
        const lightB = deriveThemeMode(base, 'light');
        for (const key of REQUIRED_THEME_KEYS) {
            expect(lightB[key], `${id} round-trip drift on ${key}`).toBe(lightA[key]);
            // dark intermediate must not pollute (derive is pure from base)
            expect(dark[key]).toBeTruthy();
        }
    });

    it.each(allIds)('%s: button chip colors never white-on-white / black-on-black', (id) => {
        for (const mode of ['dark', 'light'] as const) {
            const colors = loadThemeColorsForMode(themesDir, id, mode)!;
            const onAccent = colors['--on-accent'];
            const onPrimary = colors['--on-primary'];
            expect(onAccent, `${id}/${mode} missing --on-accent`).toMatch(/^#/);
            expect(onPrimary, `${id}/${mode} missing --on-primary`).toMatch(/^#/);
            // on-* must match the luminance rule
            expect(onAccent).toBe(onColorFor(colors['--accent']));
            expect(onPrimary).toBe(onColorFor(colors['--primary']));
            // And contrast must be usable for button labels
            expect(
                contrastRatio(onAccent, colors['--accent']),
                `${id}/${mode} on-accent vs accent`
            ).toBeGreaterThanOrEqual(3);
            expect(
                contrastRatio(onPrimary, colors['--primary']),
                `${id}/${mode} on-primary vs primary`
            ).toBeGreaterThanOrEqual(3);
            // Never both "white-ish"
            if (relativeLuminance(colors['--accent']) > 0.7) {
                expect(relativeLuminance(onAccent)).toBeLessThan(0.2);
            }
            if (relativeLuminance(colors['--primary']) > 0.7) {
                expect(relativeLuminance(onPrimary)).toBeLessThan(0.2);
            }
        }
    });
});
