import axios from 'axios';

export const api = axios.create({
    baseURL: '/api'
});

api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
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

/** Apply CSS variables from a theme payload; only --* keys hit the DOM */
export const applyTheme = async (themeName?: string): Promise<ThemeColors | null> => {
    try {
        const url = themeName ? `/theme?name=${encodeURIComponent(themeName)}` : '/theme';
        const response = await api.get(url);
        const themeData = response.data as ThemeColors;
        const root = document.documentElement;
        Object.entries(themeData).forEach(([key, value]) => {
            if (key.startsWith('--') && typeof value === 'string') {
                root.style.setProperty(key, value);
            }
        });
        const activeTheme = themeName || (themeData as any).id || 'dark';
        root.setAttribute('data-theme', activeTheme);

        // Enable CRT scanlines & phosphor bloom for all retro / CRT themes
        const isRetroTheme = !['dark', 'light'].includes(activeTheme);
        if (isRetroTheme) {
            document.body.classList.add('crt-active');
            if (activeTheme.startsWith('crt-') || activeTheme.includes('green') || activeTheme.includes('amber') || activeTheme.includes('plasma') || activeTheme.includes('3270') || activeTheme.includes('apple') || activeTheme.includes('matrix') || activeTheme.includes('dos') || activeTheme.includes('gameboy') || activeTheme.includes('arcade')) {
                document.body.classList.add('phosphor-glow');
            } else {
                document.body.classList.remove('phosphor-glow');
            }
        } else {
            document.body.classList.remove('crt-active', 'phosphor-glow');
        }

        // Editor light/dark only — site theme lives in server config (admin Appearance)
        if (themeData.mdEditorTheme === 'light' || themeData.mdEditorTheme === 'dark') {
            localStorage.setItem('mdEditorTheme', themeData.mdEditorTheme);
        } else {
            localStorage.setItem('mdEditorTheme', 'dark');
        }
        // Drop any legacy per-user theme override
        localStorage.removeItem('theme');
        return themeData;
    } catch (error) {
        console.error('Failed to load theme', error);
        return null;
    }
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
