import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Settings, Sun, Moon } from 'lucide-react';
import {
    api,
    applyTheme,
    getEffectiveThemeMode,
    getPublicConfig,
    siteConfig,
    toggleThemeMode,
    type ThemeMode
} from '../lib/api';
import { onThemeChanged, onThemeModeChanged } from '../lib/theme-events';
import { User } from '../types';

interface NavbarProps {
    user: User | null;
    setUser: (user: User | null) => void;
}

/**
 * Theme pack is site-wide (admin Appearance). Light/dark mode of that pack is
 * per-browser and switchable here for every visitor.
 */
export const Navbar = ({ user, setUser }: NavbarProps) => {
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getEffectiveThemeMode());
    const navigate = useNavigate();

    useEffect(() => {
        // Shared, memoized /config (App issues the same request; this reuses it)
        const apply = (cfg: { siteName: string; siteLogo?: string }) => {
            setSiteName(cfg.siteName);
            setSiteLogo(cfg.siteLogo);
            document.title = cfg.siteName;
        };
        siteConfig.load().then(apply);
        // Admin "Save Settings" → siteConfig.refresh() → live header update (review finding #10)
        return siteConfig.subscribe(apply);
    }, []);

    useEffect(() => {
        // App.tsx paints the site theme on cold load; here we only track the mode for the
        // toggle icon, and re-apply on theme-changed events (admin preview/save).
        siteConfig.load().then(cfg => {
            setThemeMode(getEffectiveThemeMode(cfg.appearance?.themeMode));
        });

        const loadSiteTheme = async () => {
            try {
                const data = await getPublicConfig(true);
                const currentTheme = data.currentTheme || 'dark';
                const appearance = data.appearance || {};
                const mode = getEffectiveThemeMode(appearance.themeMode);
                setThemeMode(mode);
                await applyTheme(currentTheme, {
                    mode,
                    crtEffects: appearance.crtEffects !== false,
                    textGlow: appearance.textGlow !== false
                });
            } catch {
                await applyTheme('dark', { mode: getEffectiveThemeMode('dark') });
            }
        };

        const offTheme = onThemeChanged(async detail => {
            if (detail && typeof detail === 'string') {
                await applyTheme(detail, { mode: getEffectiveThemeMode() });
            } else {
                await loadSiteTheme();
            }
        });
        const offMode = onThemeModeChanged(detail => {
            if (detail === 'light' || detail === 'dark') {
                setThemeMode(detail);
            }
        });
        return () => {
            offTheme();
            offMode();
        };
    }, []);

    const handleToggleMode = async () => {
        const next = await toggleThemeMode();
        setThemeMode(next);
    };

    const handleLogout = async () => {
        try {
            await api.post('/logout');
        } catch {
            /* still clear client */
        }
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
                <button
                    type="button"
                    onClick={handleToggleMode}
                    data-testid="theme-mode-toggle"
                    className="p-2 hover:bg-accent rounded transition hover:text-on-accent"
                    title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                    {themeMode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                {user ? (
                    <>
                        <span className="hidden sm:inline opacity-70">Hello, {user.username}</span>
                        {(user.role === 'admin' || user.role === 'contributor') && (
                            <Link to="/admin" data-testid="admin-link" className="p-2 hover:bg-accent rounded transition hover:text-on-accent" title="Settings">
                                <Settings size={20} />
                            </Link>
                        )}
                        <button onClick={handleLogout} data-testid="logout-button" className="p-2 hover:bg-accent rounded transition hover:text-on-accent" title="Logout">
                            <LogOut size={20} />
                        </button>
                    </>
                ) : (
                    <Link to="/login" data-testid="login-link" className="p-2 hover:bg-accent rounded transition hover:text-on-accent" title="Login">
                        Login
                    </Link>
                )}
            </div>
        </nav>
    );
};
