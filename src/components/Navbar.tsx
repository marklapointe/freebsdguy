import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Palette, LogOut, Settings, ChevronDown } from 'lucide-react';
import { api, applyTheme, siteConfig, fetchThemeCatalog, type ThemeMeta } from '../lib/api';
import { User } from '../types';

interface NavbarProps {
    user: User | null;
    setUser: (user: User | null) => void;
}

export const Navbar = ({ user, setUser }: NavbarProps) => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
    const [catalog, setCatalog] = useState<ThemeMeta[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
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
        fetchThemeCatalog().then(setCatalog);
    }, [location]);

    useEffect(() => {
        const syncTheme = async () => {
            const localTheme = localStorage.getItem('theme');
            if (localTheme) {
                await applyTheme(localTheme);
                setTheme(localTheme);
                return;
            }
            if (user?.theme) {
                await applyTheme(user.theme);
                setTheme(user.theme);
                return;
            }
            try {
                const res = await api.get('/config');
                const currentTheme = res.data.currentTheme || 'dark';
                setTheme(currentTheme);
                await applyTheme(currentTheme);
            } catch {
                await applyTheme('dark');
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

    const selectTheme = async (id: string) => {
        try {
            if (user) {
                await api.post('/theme', { currentTheme: id });
            }
        } catch (e) {
            console.error('Failed to persist theme', e);
        }
        setTheme(id);
        await applyTheme(id);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: id }));
        setPickerOpen(false);
    };

    const cycleTheme = async () => {
        if (!catalog.length) return;
        const idx = catalog.findIndex(t => t.id === theme);
        const next = catalog[(idx + 1) % catalog.length]!;
        await selectTheme(next.id);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        localStorage.removeItem('theme');
        localStorage.removeItem('mdEditorTheme');
        setUser(null);
        navigate('/login');
    };

    const nameParts = siteName.split(' ');
    const firstPart = nameParts[0];
    const restParts = nameParts.slice(1).join(' ');
    const currentLabel = catalog.find(t => t.id === theme)?.label || theme;

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
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setPickerOpen(o => !o)}
                        onDoubleClick={cycleTheme}
                        data-testid="theme-picker-button"
                        className="flex items-center gap-1 p-2 hover:bg-accent rounded transition hover:text-white max-w-[10rem] sm:max-w-xs"
                        title="Pick theme (double-click to cycle)"
                    >
                        <Palette size={20} />
                        <span className="hidden sm:inline text-sm truncate">{currentLabel}</span>
                        <ChevronDown size={14} className="opacity-60" />
                    </button>
                    {pickerOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                            <div
                                data-testid="theme-picker-menu"
                                className="absolute right-0 mt-1 w-64 max-h-80 overflow-y-auto bg-secondary border border-border rounded-lg shadow-xl z-50 p-2"
                            >
                                <p className="text-xs opacity-50 px-2 py-1 mb-1">Themes ({catalog.length})</p>
                                <div className="grid grid-cols-1 gap-1">
                                    {catalog.map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            data-testid={`theme-option-${t.id}`}
                                            onClick={() => selectTheme(t.id)}
                                            className={`text-left px-3 py-2 rounded text-sm flex items-center gap-2 transition ${
                                                t.id === theme ? 'bg-accent text-white' : 'hover:bg-hover'
                                            }`}
                                        >
                                            <span
                                                className="w-4 h-4 rounded-sm border border-border shrink-0"
                                                style={{
                                                    background: `linear-gradient(135deg, var(--accent), var(--primary))`
                                                }}
                                            />
                                            <span className="truncate">{t.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
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
