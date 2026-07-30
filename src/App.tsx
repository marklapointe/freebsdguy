import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api, applyTheme } from './lib/api';
import { Navbar } from './components/Navbar';
import { Home } from './components/Home';
import { PostDetail } from './components/PostDetail';
import { Login } from './components/Login';
import { Modal, Notification } from './components/Modal';
import { User, AlertType } from './types';
import { Admin } from './components/admin/Admin';


function App() {
    const [user, setUser] = useState<User | null>(null);
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const [notifications, setNotifications] = useState<AlertType[]>([]);

    useEffect(() => {
        api.get('/config').then(res => {
            setSiteName(res.data.siteName || 'MDWeb');
            setSiteLogo(res.data.siteLogo);
            if (!user) applyTheme(res.data.currentTheme);
        });
        const token = localStorage.getItem('token');
        const role = localStorage.getItem('role');
        const username = localStorage.getItem('username');
        if (token) {
            const localTheme = localStorage.getItem('theme');
            setUser({ role: role || 'contributor', username: username || 'unknown', theme: (localTheme === 'light' || localTheme === 'dark') ? localTheme : undefined });
        }
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
                    <Route path="/login" element={<Login setUser={setUser} />} />
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