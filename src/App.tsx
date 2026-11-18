import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api, applyTheme, getEffectiveThemeMode, getPublicConfig, setAuthModeCache, siteConfig } from './lib/api';
import { Navbar } from './components/Navbar';
import { Home } from './components/Home';
import { PostDetail } from './components/PostDetail';
import { Login } from './components/Login';
import { Modal, Notification } from './components/Modal';
import { User, AlertType } from './types';
import { Admin } from './components/admin/Admin';

/** Restore session on first paint — JWT needs token; session mode may only have role/username. */
function readStoredUser(): User | null {
    try {
        const role = localStorage.getItem('role');
        const username = localStorage.getItem('username');
        const token = localStorage.getItem('token');
        // Session cookie mode stores role/username without a client token
        if (!role && !token) return null;
        if (!role && !username) return null;
        return {
            role: role || 'contributor',
            username: username || 'unknown'
        };
    } catch {
        return null;
    }
}

function expandFooterPlaceholders(template: string, siteName: string): string {
    const year = String(new Date().getFullYear());
    return template.replace(/\{year\}/g, year).replace(/\{siteName\}/g, siteName || 'MDWeb');
}

/**
 * Web-login entry point state. 'unknown' until the public config says whether
 * the login page exists, so nothing that leads to a login page is rendered
 * before that answer is known.
 */
type WebLoginState = 'unknown' | 'on' | 'off';

/** Shown where the login page would be, but the web login is disabled. */
function NotFound() {
    return (
        <div data-testid="not-found" className="p-8 text-center">
            Page not found
        </div>
    );
}

function App() {
    // Synchronous hydrate so refresh on /admin does not flash-redirect to login
    const [user, setUser] = useState<User | null>(() => readStoredUser());
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const [footer, setFooter] = useState({
        show: true,
        copyrightText: '© {year} {siteName}. All rights reserved.',
        creditText: ''
    });
    const [notifications, setNotifications] = useState<AlertType[]>([]);
    // Whether the web login exists at all (config kill switch); unknown until /config arrives
    const [webLogin, setWebLogin] = useState<WebLoginState>('unknown');

    useEffect(() => {
        // Theme pack is site-wide; light/dark mode is per-browser (localStorage)
        const applyPublic = (data: Record<string, any>) => {
            // Decided first: the login entry point gates whole pages, so it must not
            // depend on the cosmetic calls below succeeding.
            setWebLogin(data.security?.disableWebLogin === true ? 'off' : 'on');
            setSiteName(data.siteName || 'MDWeb');
            setSiteLogo(data.siteLogo);
            setAuthModeCache(data.security?.authMode);
            if (data.footer) {
                setFooter({
                    show: data.footer.show !== false,
                    copyrightText:
                        typeof data.footer.copyrightText === 'string'
                            ? data.footer.copyrightText
                            : '© {year} {siteName}. All rights reserved.',
                    creditText: typeof data.footer.creditText === 'string' ? data.footer.creditText : ''
                });
            }
        };
        // One shared /config request for the whole cold load (Navbar/Home reuse it)
        getPublicConfig().then(data => {
            applyPublic(data);
            const appearance = data.appearance || {};
            applyTheme(data.currentTheme || 'dark', {
                mode: getEffectiveThemeMode(appearance.themeMode),
                crtEffects: appearance.crtEffects !== false,
                textGlow: appearance.textGlow !== false
            });
        }, () => {
            // The public config is optional at boot, but a failed fetch is not an
            // answer about the login entry point: the web login is on unless the
            // config explicitly says otherwise, so fall back to on instead of
            // leaving /login (and the Login link) blank forever. Never undo a
            // decision that was already taken (a later refresh must not re-enable
            // a login the config has switched off).
            setWebLogin(prev => (prev === 'unknown' ? 'on' : prev));
        }).catch(() => {
            // Cosmetic failures after the login decision must not touch webLogin.
        });
        // Admin saves (siteConfig.refresh) push name/logo/footer here without a reload
        const offSite = siteConfig.subscribe(() => {
            getPublicConfig().then(applyPublic).catch(() => {});
        });
        // Session mode: refresh identity from cookie if localStorage is thin
        api.get('/me')
            .then(res => {
                if (res.data?.username) {
                    localStorage.setItem('username', res.data.username);
                    localStorage.setItem('role', res.data.role || 'contributor');
                    setUser({ username: res.data.username, role: res.data.role || 'contributor' });
                    if (res.data.authMode) setAuthModeCache(res.data.authMode);
                }
            })
            .catch(() => {
                /* not logged in */
            });
        return offSite;
    }, []);

    const [modal, setModal] = useState<{ isOpen: boolean; title: string; message: string; type: string; onConfirm: () => void }>({ isOpen: false, title: '', message: '', type: 'alert', onConfirm: () => {} });

    const showAlert = (message: string, title = '') => {
        const id = Date.now();
        setNotifications((prev: AlertType[]) => [...prev, { id, message, title }]);
    };

    const removeNotification = (id: number) => {
        setNotifications((prev: AlertType[]) => prev.filter(n => n.id !== id));
    };

    const showConfirm = (message: string, onConfirm: () => void, title = '') => {
        setModal({ isOpen: true, title, message, type: 'confirm', onConfirm: () => { onConfirm(); setModal((prev: any) => ({ ...prev, isOpen: false })); } });
    };

    return (
        <Router>
            <div className="min-h-screen bg-bg text-text">
                <Navbar user={user} setUser={setUser} loginEnabled={webLogin === 'on'} />
                <main id="main" tabIndex={-1}>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                    {/* The kill switch removes the login page itself; 'unknown' waits
                        for the config so no login form is flashed before that answer. */}
                    <Route path="/login" element={
                        user ? (
                            <Navigate to="/admin" replace />
                        ) : webLogin === 'off' ? (
                            <NotFound />
                        ) : webLogin === 'on' ? (
                            <Login setUser={setUser} />
                        ) : null
                    } />
                    <Route path="/admin" element={
                        user ? (
                            <Admin user={user} siteName={siteName} setSiteName={setSiteName} siteLogo={siteLogo} setSiteLogo={setSiteLogo} showAlert={showAlert} showConfirm={showConfirm} />
                        ) : webLogin === 'off' ? (
                            <NotFound />
                        ) : webLogin === 'on' ? (
                            <Navigate to="/login" replace />
                        ) : null
                    } />
                </Routes>
                </main>
                {footer.show && (footer.copyrightText || footer.creditText) && (
                    <footer
                        data-testid="site-footer"
                        className="site-footer p-8 text-center opacity-50 text-sm mt-12 border-t border-secondary space-y-1"
                    >
                        {footer.copyrightText ? (
                            <p data-testid="footer-copyright">
                                {expandFooterPlaceholders(footer.copyrightText, siteName)}
                            </p>
                        ) : null}
                        {footer.creditText ? (
                            <p data-testid="footer-credit">{expandFooterPlaceholders(footer.creditText, siteName)}</p>
                        ) : null}
                    </footer>
                )}
            </div>
            <div className="fixed top-4 right-4 z-[100] pointer-events-none flex flex-col items-end">
                {notifications.map(n => <Notification key={n.id} {...n} onClose={removeNotification} />)}
            </div>
            <Modal
                isOpen={modal.isOpen}
                title={modal.title}
                message={modal.message}
                type={modal.type}
                onConfirm={modal.onConfirm}
                onCancel={() => setModal(prev => ({ ...prev, isOpen: false }))}
            />
        </Router>
    );
}


export default App;