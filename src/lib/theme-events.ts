/**
 * Typed theme CustomEvent helpers — avoid `as any` on window listeners.
 * Theme pack is site-wide; light/dark mode is per-browser.
 */

export const THEME_CHANGED = 'themeChanged';
export const THEME_MODE_CHANGED = 'themeModeChanged';

export type ThemeChangedDetail = string | null | undefined;
export type ThemeModeDetail = 'light' | 'dark';

export function dispatchThemeChanged(themeId: string): void {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: themeId }));
}

export function dispatchThemeModeChanged(mode: ThemeModeDetail): void {
    window.dispatchEvent(new CustomEvent(THEME_MODE_CHANGED, { detail: mode }));
}

export function onThemeChanged(handler: (detail: ThemeChangedDetail) => void): () => void {
    const listener = (e: Event) => {
        handler((e as CustomEvent).detail as ThemeChangedDetail);
    };
    window.addEventListener(THEME_CHANGED, listener);
    return () => window.removeEventListener(THEME_CHANGED, listener);
}

export function onThemeModeChanged(handler: (mode: ThemeModeDetail | unknown) => void): () => void {
    const listener = (e: Event) => {
        handler((e as CustomEvent).detail);
    };
    window.addEventListener(THEME_MODE_CHANGED, listener);
    return () => window.removeEventListener(THEME_MODE_CHANGED, listener);
}
