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