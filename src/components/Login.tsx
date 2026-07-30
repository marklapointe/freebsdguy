import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, applyTheme } from '../lib/api';
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
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('role', res.data.role);
            const userObj = {
                username: res.data.username || username,
                role: res.data.role
            };
            localStorage.setItem('username', userObj.username);
            // Site theme is admin-owned; always load from public config (not per-user)
            try {
                const cfg = await api.get('/config');
                await applyTheme(cfg.data.currentTheme || 'dark');
            } catch {
                await applyTheme('dark');
            }
            setUser(userObj);
            navigate('/admin');
        } catch (err: unknown) {
            const ax = err as { response?: { status?: number; data?: { message?: string } } };
            const status = ax.response?.status;
            const serverMsg = ax.response?.data?.message;
            if (status === 429) {
                setError(serverMsg || 'Too many requests — wait a moment and try again');
            } else if (serverMsg) {
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
                <button type="submit" data-testid="login-submit" className="w-full p-3 bg-accent rounded font-bold hover:bg-opacity-80 transition shadow-lg text-white">
                    Sign In
                </button>
            </form>
        </div>
    );
};