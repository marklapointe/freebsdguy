import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut, Settings } from 'lucide-react';
import { api, applyTheme } from '../lib/api';
import { User } from '../types';

interface NavbarProps {
    user: User | null;
    setUser: (user: User | null) => void;
    siteName: string;
    siteLogo?: string;
}

export const Navbar = ({ user, setUser, siteName, siteLogo }: NavbarProps) => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
    useEffect(() => {
        const syncTheme = async () => {
            const localTheme = localStorage.getItem('theme');
            if (localTheme === 'light' || localTheme === 'dark') {
                await applyTheme(localTheme);
                setTheme(localTheme);
            } else if (user && user.theme && (user.theme === 'light' || user.theme === 'dark')) {
                await applyTheme(user.theme);
                setTheme(user.theme);
            } else {
                try {
                    const res = await api.get('/config');
                    const currentTheme = res.data.currentTheme;
                    setTheme(currentTheme === 'dark' || currentTheme === 'light' ? currentTheme : 'dark');
                    await applyTheme(currentTheme);
                } catch (e) {
                    await applyTheme();
                }
            }
        };

        syncTheme();

        const handleThemeChanged = (e: CustomEvent) => {
            if (e.detail && typeof e.detail === 'string') {
                setTheme(e.detail);
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, [user]);

    const toggleTheme = async () => {
        const newTheme = (theme === 'dark') ? 'light' : 'dark';
        try {
            await api.post('/theme', { currentTheme: newTheme });
            setTheme(newTheme);
            await applyTheme(newTheme);
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: newTheme }));
        } catch (e) {
            console.error('Failed to toggle theme', e);
        }
    };
    const navigate = useNavigate();
    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        localStorage.removeItem('theme');
        setUser(null);
        navigate('/login');
    };

    const nameParts = siteName.split(' ');
    const firstPart = nameParts[0];
    const restParts = nameParts.slice(1).join(' ');

    return (
        <nav className="p-4 bg-secondary text-text flex justify-between items-center shadow-md">
            <Link to="/" className="text-2xl font-bold flex items-center gap-2">
                {siteLogo ? (
                    <img src={`/api/getimage?fileName=${siteLogo}`} alt={siteName} className="h-10 w-auto" />
                ) : (
                    <>
                        <span style={{ color: 'var(--site-name-color, var(--accent))' }}>{firstPart}</span> {restParts}
                    </>
                )}
            </Link>
            <div className="flex gap-4 items-center">
                <button onClick={toggleTheme} className="p-2 hover:bg-accent rounded transition hover:text-white" title="Toggle theme">
                    {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                {user ? (
                    <>
                        <span className="hidden sm:inline opacity-70">Hello, {user.username}</span>
                        {(user.role === 'admin' || user.role === 'contributor') && (
                            <Link to="/admin" data-testid="admin-link" className="p-2 hover:bg-accent rounded transition hover:text-white" title="Settings">
                                <Settings size={20} />
                            </Link>
                        )}
                        <button onClick={handleLogout} data-testid="logout-button" className="p-2 hover:bg-accent rounded transition hover:text-white" title="Logout">
                            <LogOut size={20} />
                        </button>
                    </>
                ) : (
                    <Link to="/login" data-testid="login-link" className="p-2 hover:bg-accent rounded transition hover:text-white" title="Login">
                        Login
                    </Link>
                )}
            </div>
        </nav>
    );
};