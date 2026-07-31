import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, applyTheme, getEffectiveThemeMode, setAuthModeCache } from '../lib/api';
import { User } from '../types';

interface LoginProps {
    setUser: (user: User | null) => void;
}

export const Login = ({ setUser }: LoginProps) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await api.post('/login', { username, password });
            if (res.data.authMode === 'session' || res.data.authMode === 'jwt') {
                setAuthModeCache(res.data.authMode);
            }
            if (res.data.token) {
                localStorage.setItem('token', res.data.token);
            } else {
                localStorage.removeItem('token');
            }
            localStorage.setItem('role', res.data.role);
            const userObj = {
                username: res.data.username || username,
                role: res.data.role
            };
            localStorage.setItem('username', userObj.username);
            // Theme pack is site-wide; light/dark follows browser preference
            try {
                const cfg = await api.get('/config');
                const appearance = cfg.data.appearance || {};
                await applyTheme(cfg.data.currentTheme || 'dark', {
                    mode: getEffectiveThemeMode(appearance.themeMode),
                    crtEffects: appearance.crtEffects !== false,
                    textGlow: appearance.textGlow !== false
                });
            } catch {
                await applyTheme('dark', { mode: getEffectiveThemeMode('dark') });
            }
            setUser(userObj);
            navigate('/admin');
        } catch (err: unknown) {
            const ax = err as { response?: { data?: { message?: string } } };
            const serverMsg = ax.response?.data?.message;
            if (serverMsg) {
                setError(serverMsg);
            } else {
                setError('Invalid credentials');
            }
        }
    };

    return (
        <div className="flex justify-center items-center min-h-[80vh]">
            <form onSubmit={handleSubmit} className="p-8 bg-secondary rounded-lg shadow-xl w-full max-w-md border border-accent text-text">
                <h2 className="text-3xl font-bold mb-6 text-center">Login</h2>
                {error && <p className="text-red-500 mb-4 text-center">{error}</p>}
                <div className="mb-4">
                    <label htmlFor="username" className="block mb-2 text-sm font-medium">Username</label>
                    <input
                        id="username"
                        data-testid="username-input"
                        type="text"
                        className="w-full p-3 rounded bg-bg text-text border border-accent focus:outline-none"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                    />
                </div>
                <div className="mb-6">
                    <label htmlFor="password" className="block mb-2 text-sm font-medium">Password</label>
                    <input
                        id="password"
                        data-testid="password-input"
                        type="password"
                        className="w-full p-3 rounded bg-bg text-text border border-accent focus:outline-none"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                    />
                </div>
                <button type="submit" data-testid="login-submit" className="w-full p-3 bg-accent text-on-accent rounded font-bold hover:bg-opacity-80 transition shadow-lg">
                    Sign In
                </button>
            </form>
        </div>
    );
};