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

export const applyTheme = async (themeName?: string) => {
    try {
        const url = themeName ? `/theme?name=${themeName}` : '/theme';
        const response = await api.get(url);
        const themeData = response.data;
        const root = document.documentElement;
        Object.entries(themeData).forEach(([key, value]) => {
            root.style.setProperty(key, value as string);
        });

        if (themeName === 'light' || themeName === 'dark') {
            localStorage.setItem('theme', themeName);
        } else if (themeName) {
            localStorage.removeItem('theme');
        }
    } catch (error) {
        console.error('Failed to load theme', error);
    }
};