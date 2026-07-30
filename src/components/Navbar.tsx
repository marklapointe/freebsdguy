import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { api, applyTheme, siteConfig } from '../lib/api';
import { User } from '../types';

interface NavbarProps {
    user: User | null;
    setUser: (user: User | null) => void;
}

/**
 * Themes are site-wide and admin-only (Appearance settings).
 * Navbar only loads/applies the current site theme — no picker for visitors or contributors.
 */
export const Navbar = ({ user, setUser }: NavbarProps) => {
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        siteConfig.load().then(cfg => {
            setSiteName(cfg.siteName);
            setSiteLogo(cfg.siteLogo);
            document.title = cfg.siteName;
        });
    }, [location]);

    useEffect(() => {
        const loadSiteTheme = async () => {
            try {
                const res = await api.get('/config');
                const currentTheme = res.data.currentTheme || 'dark';
                await applyTheme(currentTheme);
            } catch {
                await applyTheme('dark');
            }
        };

        loadSiteTheme();

        const handleThemeChanged = async (e: CustomEvent) => {
            if (e.detail && typeof e.detail === 'string') {
                await applyTheme(e.detail);
            } else {
                await loadSiteTheme();
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        setUser(null);
        navigate('/login');
    };

    const nameParts = siteName.split(' ');
    const firstPart = nameParts[0];
    const restParts = nameParts.slice(1).join(' ');

    return (
        <nav className="p-4 bg-secondary text-text flex justify-between items-center shadow-md relative z-50">
            <Link to="/" className="text-2xl font-bold flex items-center gap-2">
                {siteLogo ? (
                    <img src={`/api/getimage?fileName=${siteLogo}`} alt={siteName} className="h-10 w-auto" />
                ) : (
                    <>
                        <span style={{ color: 'var(--site-name-color, var(--accent))' }}>{firstPart}</span> {restParts}
                    </>
                )}
            </Link>
            <div className="flex gap-2 sm:gap-4 items-center">
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
