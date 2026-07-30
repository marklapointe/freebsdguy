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
            const isAuthError = error.response.data?.message === 'No token' ||
                                error.response.data?.message === 'Failed to authenticate token' ||
                                error.response.data?.message === 'Invalid credentials' ||
                                error.response.data?.message === 'Forbidden';

            const token = localStorage.getItem('token');
            if (token && isAuthError) {
                localStorage.removeItem('token');
                localStorage.removeItem('role');
                localStorage.removeItem('username');
                window.location.href = '/login';
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
        root.setAttribute('data-theme', themeName || themeData.mdEditorTheme || 'dark');

        if (themeName) {
            localStorage.setItem('theme', themeName);
        }
        if (themeData.mdEditorTheme === 'light' || themeData.mdEditorTheme === 'dark') {
            localStorage.setItem('mdEditorTheme', themeData.mdEditorTheme);
        } else {
            // Heuristic from bg luminance is server-side; default dark for editor
            localStorage.setItem('mdEditorTheme', 'dark');
        }
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

/** Cycle to next theme in catalog; requires auth for POST /theme */
export const cycleTheme = async (currentId: string, catalog: ThemeMeta[]): Promise<string | null> => {
    if (!catalog.length) return null;
    const idx = catalog.findIndex(t => t.id === currentId);
    const next = catalog[(idx + 1) % catalog.length] || catalog[0];
    try {
        await api.post('/theme', { currentTheme: next.id });
    } catch {
        // Anonymous users: still apply locally
    }
    await applyTheme(next.id);
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: next.id }));
    return next.id;
};
