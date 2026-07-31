import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api, applyTheme, getEffectiveThemeMode, setAuthModeCache } from './lib/api';
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

function App() {
    // Synchronous hydrate so refresh on /admin does not flash-redirect to login
    const [user, setUser] = useState<User | null>(() => readStoredUser());
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const [notifications, setNotifications] = useState<AlertType[]>([]);

    useEffect(() => {
        // Theme pack is site-wide; light/dark mode is per-browser (localStorage)
        api.get('/config').then(res => {
            setSiteName(res.data.siteName || 'MDWeb');
            setSiteLogo(res.data.siteLogo);
            setAuthModeCache(res.data.security?.authMode);
            const appearance = res.data.appearance || {};
            applyTheme(res.data.currentTheme || 'dark', {
                mode: getEffectiveThemeMode(appearance.themeMode),
                crtEffects: appearance.crtEffects !== false,
                textGlow: appearance.textGlow !== false
            });
        }).catch(() => {
            /* public config optional at boot */
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
                <Navbar user={user} setUser={setUser} />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                    <Route path="/login" element={
                        user ? <Navigate to="/admin" replace /> : <Login setUser={setUser} />
                    } />
                    <Route path="/admin" element={
                        user ? (
                            <Admin user={user} siteName={siteName} setSiteName={setSiteName} siteLogo={siteLogo} setSiteLogo={setSiteLogo} showAlert={showAlert} showConfirm={showConfirm} />
                        ) : (
                            <Navigate to="/login" replace />
                        )
                    } />
                </Routes>
                <footer className="p-8 text-center opacity-50 text-sm mt-12 border-t border-secondary">
                    © 2026 {siteName}. All rights reserved. Built with Vite + React.
                </footer>
            </div>
            <div className="fixed top-4 right-4 z-[100] pointer-events-none flex flex-col items-end">
                {notifications.map(n => <Notification key={n.id} {...n} onClose={removeNotification} />)}
            </div>
            <Modal isOpen={modal.isOpen} title={modal.title} message={modal.message} type={modal.type} onConfirm={modal.onConfirm} onCancel={() => setModal(prev => ({ ...prev, isOpen: false }))} />
        </Router>
    );
}

export default App;