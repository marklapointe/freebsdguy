import axios from 'axios';

export const api = axios.create({
    baseURL: '/api',
    withCredentials: true
});

/** Cached public auth mode (jwt default). */
let cachedAuthMode: 'jwt' | 'session' = 'jwt';

export function getAuthMode(): 'jwt' | 'session' {
    return cachedAuthMode;
}

export function setAuthModeCache(mode: string | undefined): void {
    cachedAuthMode = mode === 'session' ? 'session' : 'jwt';
}

api.interceptors.request.use(config => {
    // JWT mode: send Bearer when present. Session mode relies on HttpOnly cookie.
    if (cachedAuthMode !== 'session') {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});

api.interceptors.response.use(
    response => response,
    error => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Only wipe session on real JWT failures — not every 403 (e.g. role-gated routes)
            const msg = error.response.data?.message;
            const isJwtFailure =
                msg === 'No token' ||
                msg === 'Failed to authenticate token' ||
                msg === 'Invalid token' ||
                msg === 'jwt malformed' ||
                msg === 'jwt expired' ||
                msg === 'invalid signature';

            const token = localStorage.getItem('token');
            const path = error.config?.url || '';
            // Never treat /login failures as "clear session and bounce"
            const isLoginAttempt = String(path).includes('/login');

            if (token && isJwtFailure && !isLoginAttempt) {
                localStorage.removeItem('token');
                localStorage.removeItem('role');
                localStorage.removeItem('username');
                if (!window.location.pathname.startsWith('/login')) {
                    window.location.href = '/login';
                }
            }
        }
        return Promise.reject(error);
    }
);

// Singleton site config store
class SiteConfig {
    private static instance: SiteConfig;
    private config: { siteName: string; siteLogo?: string; currentTheme: string } | null = null;
    private listeners: Array<(config: { siteName: string; siteLogo?: string; currentTheme: string }) => void> = [];

    private constructor() {}

    static getInstance(): SiteConfig {
        if (!SiteConfig.instance) {
            SiteConfig.instance = new SiteConfig();
        }
        return SiteConfig.instance;
    }

    async load(): Promise<{ siteName: string; siteLogo?: string; currentTheme: string }> {
        if (this.config) {
            return this.config;
        }
        try {
            const res = await api.get('/config');
            this.config = {
                siteName: res.data.siteName || 'MDWeb',
                siteLogo: res.data.siteLogo,
                currentTheme: res.data.currentTheme || 'dark'
            };
            if (this.config.siteName) {
                document.title = this.config.siteName;
            }
            return this.config;
        } catch (e) {
            console.error('Failed to load site config', e);
            return { siteName: 'MDWeb', currentTheme: 'dark' };
        }
    }

    get(): { siteName: string; siteLogo?: string; currentTheme: string } | null {
        return this.config;
    }

    subscribe(listener: (config: { siteName: string; siteLogo?: string; currentTheme: string }) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify(): void {
        if (this.config) {
            this.listeners.forEach(l => l(this.config!));
        }
    }
}

export const siteConfig = SiteConfig.getInstance();

export interface ThemeMeta {
    id: string;
    label: string;
    mdEditorTheme: 'light' | 'dark';
    description?: string;
}

export type ThemeColors = Record<string, string>;
export type ThemeMode = 'light' | 'dark';

const THEME_MODE_KEY = 'themeMode';

/** Full set of CSS vars every theme response must pin (avoids stale vars from prior packs). */
const THEME_CSS_KEYS = [
    '--primary',
    '--secondary',
    '--accent',
    '--text',
    '--bg',
    '--border',
    '--hover',
    '--site-name-color',
    '--on-accent',
    '--on-primary'
] as const;

export interface PublicAppearance {
    themeMode: ThemeMode;
    crtEffects: boolean;
    textGlow: boolean;
}

export interface ApplyThemeOptions {
    /** Explicit light/dark; defaults to user localStorage then site appearance.themeMode */
    mode?: ThemeMode;
    /** Site CRT scanlines — from public config appearance */
    crtEffects?: boolean;
    /** Site phosphor text glow — from public config appearance */
    textGlow?: boolean;
}

/** Last successfully applied pack + appearance (avoids races / mixed config mid-toggle). */
let cachedThemePack: string | null = null;
let cachedCrtEffects = true;
let cachedTextGlow = true;
/** Monotonic token so out-of-order /theme responses never partially paint. */
let applyGeneration = 0;

/** Per-user light/dark preference for the active site theme pack (not the pack itself). */
export function getStoredThemeMode(): ThemeMode | null {
    try {
        const m = localStorage.getItem(THEME_MODE_KEY);
        return m === 'light' || m === 'dark' ? m : null;
    } catch {
        return null;
    }
}

export function setStoredThemeMode(mode: ThemeMode): void {
    localStorage.setItem(THEME_MODE_KEY, mode);
}

/** User override if set; otherwise site default (dark when unset). */
export function getEffectiveThemeMode(siteDefault?: ThemeMode | string | null): ThemeMode {
    const stored = getStoredThemeMode();
    if (stored) return stored;
    return siteDefault === 'light' ? 'light' : 'dark';
}

function isRetroThemeId(id: string): boolean {
    return !['dark', 'light'].includes(id);
}

function paintTheme(themeData: ThemeColors, packId: string, mode: ThemeMode, crtEffects: boolean, textGlow: boolean): void {
    const root = document.documentElement;
    // Pin every known key so a prior pack cannot leave mixed surfaces behind
    for (const key of THEME_CSS_KEYS) {
        const value = themeData[key];
        if (typeof value === 'string' && value.startsWith('#')) {
            root.style.setProperty(key, value);
        }
    }
    // Also apply any extra --* keys the pack may define
    Object.entries(themeData).forEach(([key, value]) => {
        if (key.startsWith('--') && typeof value === 'string' && !(THEME_CSS_KEYS as readonly string[]).includes(key)) {
            root.style.setProperty(key, value);
        }
    });
    root.setAttribute('data-theme', packId);
    root.setAttribute('data-theme-mode', mode);

    const retro = isRetroThemeId(packId);
    if (crtEffects && retro) {
        document.body.classList.add('crt-active');
    } else {
        document.body.classList.remove('crt-active');
    }
    if (textGlow && retro) {
        document.body.classList.add('phosphor-glow');
    } else {
        document.body.classList.remove('phosphor-glow');
    }

    if (themeData.mdEditorTheme === 'light' || themeData.mdEditorTheme === 'dark') {
        localStorage.setItem('mdEditorTheme', themeData.mdEditorTheme);
    } else {
        localStorage.setItem('mdEditorTheme', mode);
    }
    localStorage.removeItem('theme');
}

/**
 * Apply CSS variables from a theme pack + light/dark mode.
 * Theme pack is site-wide (admin); mode is per-browser via localStorage.
 * Concurrent calls are sequenced — only the latest response paints the DOM.
 */
export const applyTheme = async (
    themeName?: string,
    options?: ApplyThemeOptions
): Promise<ThemeColors | null> => {
    const gen = ++applyGeneration;
    try {
        let name = themeName || cachedThemePack || undefined;
        let mode = options?.mode;
        let crtEffects = options?.crtEffects;
        let textGlow = options?.textGlow;

        // Prefer cache for appearance flags when only mode is flipping (toggle path)
        if (crtEffects === undefined && cachedThemePack) crtEffects = cachedCrtEffects;
        if (textGlow === undefined && cachedThemePack) textGlow = cachedTextGlow;

        if (!name || mode === undefined || crtEffects === undefined || textGlow === undefined) {
            try {
                const res = await api.get('/config');
                if (gen !== applyGeneration) return null;
                name = name || res.data.currentTheme || 'dark';
                const a = (res.data.appearance || {}) as Partial<PublicAppearance>;
                if (mode === undefined) mode = getEffectiveThemeMode(a.themeMode);
                if (crtEffects === undefined) crtEffects = a.crtEffects !== false;
                if (textGlow === undefined) textGlow = a.textGlow !== false;
            } catch {
                name = name || 'dark';
                if (mode === undefined) mode = getEffectiveThemeMode('dark');
                if (crtEffects === undefined) crtEffects = true;
                if (textGlow === undefined) textGlow = true;
            }
        }

        mode = mode === 'light' ? 'light' : 'dark';
        const url = `/theme?name=${encodeURIComponent(name!)}&mode=${mode}`;
        const response = await api.get(url);
        if (gen !== applyGeneration) return null;

        const themeData = response.data as ThemeColors;
        cachedThemePack = name!;
        cachedCrtEffects = !!crtEffects;
        cachedTextGlow = !!textGlow;
        paintTheme(themeData, name!, mode, !!crtEffects, !!textGlow);
        return themeData;
    } catch (error) {
        console.error('Failed to load theme', error);
        return null;
    }
};

/** Toggle user light/dark preference and re-apply the current site theme pack. */
export const toggleThemeMode = async (): Promise<ThemeMode> => {
    const current = getEffectiveThemeMode();
    const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
    setStoredThemeMode(next);
    // Use cached pack so we never race /config mid-toggle into a different theme
    await applyTheme(cachedThemePack || undefined, {
        mode: next,
        crtEffects: cachedCrtEffects,
        textGlow: cachedTextGlow
    });
    window.dispatchEvent(new CustomEvent('themeModeChanged', { detail: next }));
    return next;
};

export const getMdEditorTheme = (): 'light' | 'dark' => {
    const t = localStorage.getItem('mdEditorTheme');
    return t === 'light' ? 'light' : 'dark';
};

export const fetchThemeCatalog = async (): Promise<ThemeMeta[]> => {
    try {
        const res = await api.get('/themes');
        return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
        console.error('Failed to load theme catalog', e);
        return [
            { id: 'dark', label: 'Dark', mdEditorTheme: 'dark' },
            { id: 'light', label: 'Light', mdEditorTheme: 'light' }
        ];
    }
};

/** Admin-only: persist site-wide theme (POST /api/theme requires admin). */
export const setSiteTheme = async (themeId: string): Promise<boolean> => {
    try {
        await api.post('/theme', { currentTheme: themeId });
        await applyTheme(themeId);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: themeId }));
        return true;
    } catch (e) {
        console.error('Failed to set site theme (admin only)', e);
        return false;
    }
};
