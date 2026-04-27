import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { MdEditor, MdPreview, MdCatalog } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import 'md-editor-rt/lib/preview.css';
import { Search, LogOut, Settings, Trash2, Edit, Plus, Upload, Palette, Layout, Users, FileText, Image as ImageIcon, Copy, Sparkles, Sun, Moon, Cpu, RefreshCw, X, Server, AlertCircle, LucideIcon } from 'lucide-react';

interface Post {
    slug: string;
    title: string;
    date: string;
    author: string;
    summary: string;
    content: string;
    category?: string;
}

interface ImageInfo {
    filename: string;
    originalName: string;
    uploadedAt: number;
    size?: number;
    md5?: string;
}

interface User {
    username: string;
    role: string;
    theme?: string;
}

interface AlertType {
    id: number;
    title: string;
    message: string;
}

// API Instance
export const api = axios.create({
    baseURL: '/api'
});

// Add interceptor to include token
api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Add response interceptor to handle unauthorized errors
api.interceptors.response.use(
    response => response,
    error => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Check if it's a REAL auth error, not a "Forbidden" due to some feature being disabled
            const isAuthError = error.response.data?.message === 'No token' || 
                               error.response.data?.message === 'Failed to authenticate token' ||
                               error.response.data?.message === 'Invalid credentials' ||
                               error.response.data?.message === 'Forbidden';
            
            // Only redirect if we were actually trying to use a token AND it's a real auth error
            const token = localStorage.getItem('token');
            if (token && isAuthError) {
                console.warn('Authentication failed, clearing token and redirecting to login');
                localStorage.removeItem('token');
                localStorage.removeItem('role');
                localStorage.removeItem('username');
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

// Theme context/hook could be better, but let's just fetch and apply
const applyTheme = async (themeName?: string) => {
    try {
        const url = themeName ? `/theme?name=${themeName}` : '/theme';
        const response = await api.get(url);
        const themeData = response.data;
        const root = document.documentElement;
        Object.entries(themeData).forEach(([key, value]) => {
            root.style.setProperty(key, value as string);
        });
        
        // As per user request: "The only thing that needs to preserved in a local storage is wheather the theme is light or dark."
        if (themeName === 'light' || themeName === 'dark') {
            localStorage.setItem('theme', themeName);
        } else if (themeName) {
            // If it's a custom theme name, we should probably clear the light/dark override 
            // so the custom theme takes full effect and isn't overridden by a stale preference.
            localStorage.removeItem('theme');
        }
    } catch (error) {
        console.error('Failed to load theme', error);
    }
};

const Navbar = ({ user, setUser, siteName, siteLogo }: { user: User | null; setUser: (user: User | null) => void; siteName: string; siteLogo?: string }) => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
    useEffect(() => {
        const syncTheme = async () => {
            const localTheme = localStorage.getItem('theme');
            // User requested ONLY light/dark in localStorage.
            if (localTheme === 'light' || localTheme === 'dark') {
                await applyTheme(localTheme);
                setTheme(localTheme);
            } else if (user && user.theme && (user.theme === 'light' || user.theme === 'dark')) {
                // If no local storage but user has a preference, use it
                await applyTheme(user.theme);
                setTheme(user.theme);
            } else {
                // Otherwise fetch from config
                try {
                    const res = await api.get('/config');
                    const currentTheme = res.data.currentTheme;
                    // If we have a local preference, it would have been caught above.
                    // Since it wasn't, we use the site default.
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
        // Toggle between light and dark mode as a user preference
        const newTheme = (theme === 'dark') ? 'light' : 'dark';
        try {
            await api.post('/theme', { currentTheme: newTheme });
            setTheme(newTheme);
            await applyTheme(newTheme);
            // Dispatch event for other components
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
        localStorage.removeItem('theme'); // Clear theme on logout to fallback to global config
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
                    <img src={`/api/images/${siteLogo}`} alt={siteName} className="h-10 w-auto" />
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

const Home = () => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [limit] = useState(10);

    useEffect(() => {
        fetchPosts(0);
    }, []);

    const fetchPosts = (newOffset: number) => {
        api.get(`/posts?limit=${limit}&offset=${newOffset}`).then(res => {
            if (newOffset === 0) {
                setPosts(res.data.posts);
            } else {
                setPosts(prev => [...prev, ...res.data.posts]);
            }
            setTotal(res.data.total);
            setOffset(newOffset);
        });
    };

    const loadMore = () => {
        fetchPosts(offset + limit);
    };

    const filteredPosts = posts.filter(p => 
        p.title.toLowerCase().includes(search.toLowerCase()) || 
        p.summary.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="container mx-auto p-4 max-w-[85%]">
            <div className="mb-8 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 opacity-50" size={20} />
                <input 
                    id="search-input"
                    type="text" 
                    placeholder="Search posts..." 
                    className="w-full p-3 pl-10 rounded-lg bg-secondary border border-accent border-opacity-30 text-text focus:outline-none focus:ring-2 focus:ring-accent"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoComplete="off"
                />
            </div>
            <div className="grid gap-6">
                {filteredPosts.map(post => (
                    <div key={post.slug} className="p-6 bg-secondary rounded-lg shadow-lg hover:shadow-xl transition border-l-4 border-accent">
                        <h2 className="text-2xl font-bold mb-2">
                            <Link to={`/post/${post.slug}`} className="hover:text-accent">
                                {post.title}
                            </Link>
                        </h2>
                        <p className="opacity-70 text-sm mb-4">{new Date(post.date).toLocaleDateString()}</p>
                        <p className="mb-4">{post.summary}</p>
                        <Link to={`/post/${post.slug}`} className="text-accent font-semibold hover:underline">
                            Read more →
                        </Link>
                    </div>
                ))}
            </div>
            {!search && posts.length < total && (
                <div className="mt-12 flex justify-center">
                    <button 
                        onClick={loadMore}
                        className="bg-accent p-3 px-10 rounded-full font-bold hover:bg-opacity-80 transition shadow-lg text-white flex items-center gap-2 group"
                    >
                        <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" /> Load More Posts
                    </button>
                </div>
            )}
            {search && filteredPosts.length === 0 && (
                <div className="text-center py-20 opacity-50">
                    <Search size={48} className="mx-auto mb-4" />
                    <p className="text-xl">No posts matching "{search}"</p>
                </div>
            )}
        </div>
    );
};

const PostDetail = () => {
    const { slug } = useParams<{ slug: string }>();
    const [post, setPost] = useState<Post | null>(null);
    const [id] = useState('preview-only');
    const scrollElement = document.documentElement;
    const [theme, setTheme] = useState((localStorage.getItem('theme') as 'light' | 'dark') || 'dark');

    useEffect(() => {
        api.get(`/posts/${slug}`).then(res => setPost(res.data));
    }, [slug]);

    useEffect(() => {
        const handleThemeChanged = (e: CustomEvent) => {
            if (e.detail && (e.detail === 'light' || e.detail === 'dark')) {
                setTheme(e.detail);
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

    if (!post) return <div className="p-8 text-center text-primary">Loading...</div>;

    return (
        <div className="container mx-auto p-4 max-w-[90%] bg-secondary my-8 rounded-lg shadow-2xl overflow-hidden border border-accent border-opacity-10">
            <div className="p-8">
                <h1 className="text-4xl font-extrabold mb-4 border-b border-accent border-opacity-30 pb-4 text-primary">{post.title}</h1>
                <div className="flex gap-4 text-sm opacity-70 mb-8 text-primary">
                    <span>{new Date(post.date).toLocaleDateString()}</span>
                    {post.author && <span>by {post.author}</span>}
                </div>
                
                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 min-w-0">
                        <MdPreview 
                            id={id} 
                            modelValue={post.content} 
                            theme={theme}
                            language="en-US"
                        />
                    </div>
                    <div className="hidden lg:block w-64 shrink-0 border-l border-accent border-opacity-10 pl-6">
                        <div className="sticky top-8">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] mb-4 text-accent opacity-60">Contents</h3>
                            <MdCatalog editorId={id} scrollElement={scrollElement} />
                        </div>
                    </div>
                </div>

                <div className="mt-12 pt-8 border-t border-accent border-opacity-10">
                    <Link to="/" className="text-accent hover:underline flex items-center gap-2 font-bold transition-all hover:gap-3">
                        <span>←</span> Back to home
                    </Link>
                </div>
            </div>
        </div>
    );
};

const Login = ({ setUser }: { setUser: (user: User | null) => void }) => {
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
                role: res.data.role,
                theme: res.data.theme
            };
            if (res.data.theme && (res.data.theme === 'light' || res.data.theme === 'dark')) {
                localStorage.setItem('theme', res.data.theme);
                applyTheme(res.data.theme);
            } else {
                localStorage.removeItem('theme');
                applyTheme();
            }
            localStorage.setItem('username', userObj.username);
            setUser(userObj);
            navigate('/admin');
        } catch (err) {
            setError('Invalid credentials');
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

const Modal = ({ isOpen, title, message, type, onConfirm, onCancel }: { isOpen: boolean; title: string; message: string; type: string; onConfirm: () => void; onCancel: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-secondary p-6 rounded-xl shadow-2xl border border-accent border-opacity-30 max-w-md w-full text-text">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Sparkles className="text-accent" /> {title || (type === 'confirm' ? 'Confirm Action' : 'Message')}
                </h3>
                <p className="mb-6 opacity-90">{message}</p>
                <div className="flex justify-end gap-3">
                    {type === 'confirm' && (
                        <button 
                            onClick={onCancel} 
                            className="p-2 px-4 rounded hover:bg-bg transition border border-accent border-opacity-30"
                        >
                            Cancel
                        </button>
                    )}
                    <button 
                        onClick={onConfirm} 
                        className="bg-accent p-2 px-6 rounded font-bold hover:bg-opacity-80 transition shadow-lg text-white"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};

const Notification = ({ id, message, title, onClose }: { id: number; message: string; title: string; onClose: (id: number) => void }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose(id);
        }, 5000);
        return () => clearTimeout(timer);
    }, [id, onClose]);

    return (
        <div className="bg-secondary border-l-4 border-accent p-4 rounded shadow-2xl flex justify-between items-start gap-4 w-80 mb-3 pointer-events-auto transition-all duration-300 transform translate-x-0 opacity-100">
            <div className="flex-1">
                {title && <h4 className="font-bold text-accent text-sm mb-1">{title}</h4>}
                <p className="text-sm opacity-90">{message}</p>
            </div>
            <button onClick={() => onClose(id)} className="opacity-50 hover:opacity-100 transition">
                <X size={16} />
            </button>
        </div>
    );
};

const PostModal = ({ 
    isOpen, 
    post, 
    onSave, 
    onCancel, 
    onAutoSummarize, 
    isSummarizing, 
    onAutoEnhance,
    isEnhancing,
    enhancedPreview,
    onApplyEnhancement,
    onDismissEnhancement,
    setPost, 
    aiEnabled, 
    theme = 'dark' 
}: { 
    isOpen: boolean; 
    post: any; 
    onSave: (e: any) => void; 
    onCancel: () => void; 
    onAutoSummarize: () => void; 
    isSummarizing: boolean; 
    onAutoEnhance: () => void;
    isEnhancing: boolean;
    enhancedPreview: string | null;
    onApplyEnhancement: () => void;
    onDismissEnhancement: () => void;
    setPost: (post: any) => void; 
    aiEnabled: boolean;
    theme?: 'light' | 'dark';
}) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-secondary p-6 md:p-8 rounded-xl shadow-2xl border border-accent border-opacity-30 w-full max-w-5xl max-h-[95vh] overflow-y-auto text-text">
                <div className="flex justify-between items-center mb-6 border-b border-accent border-opacity-20 pb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="text-accent" /> {post.slug ? 'Edit Post' : 'New Post'}
                    </h2>
                    <button onClick={onCancel} className="p-2 hover:bg-bg rounded-full transition">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={onSave} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <label htmlFor="post-slug" className="block text-xs font-bold uppercase text-accent">Slug (URL-friendly)</label>
                            <input 
                                id="post-slug"
                                type="text" placeholder="Slug (URL-friendly)" 
                                className="w-full p-3 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50 focus:ring-1 focus:ring-accent outline-none"
                                value={post.slug} onChange={e => setPost({...post, slug: e.target.value})}
                                required 
                                autoComplete="off"
                            />
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="post-title" className="block text-xs font-bold uppercase text-accent">Title</label>
                            <input 
                                id="post-title"
                                type="text" placeholder="Title" 
                                className="w-full p-3 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50 focus:ring-1 focus:ring-accent outline-none"
                                value={post.title} onChange={e => setPost({...post, title: e.target.value})}
                                required 
                                autoComplete="off"
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between items-center">
                            <label htmlFor="post-summary" className="block text-xs font-bold uppercase text-accent">Summary</label>
                            {aiEnabled && (
                                <button 
                                    type="button"
                                    onClick={onAutoSummarize}
                                    className="text-xs flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                                    disabled={isSummarizing || !post.content}
                                >
                                    <Sparkles size={14} /> {isSummarizing ? 'Summarizing...' : 'Auto-Summarize'}
                                </button>
                            )}
                        </div>

                        {isSummarizing && (
                            <div className="mb-2 p-3 bg-accent bg-opacity-5 border border-accent border-dashed rounded-lg animate-in fade-in duration-300">
                                <div className="flex items-center justify-center gap-3">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                        <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                        <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"></div>
                                    </div>
                                    <div className="text-xs font-bold text-accent flex items-center gap-2">
                                        AI is generating summary...
                                    </div>
                                </div>
                            </div>
                        )}

                        <textarea 
                            id="post-summary"
                            placeholder="Summary (short description)" 
                            className="w-full p-3 bg-bg border border-accent rounded h-20 text-text placeholder-text placeholder-opacity-50 focus:ring-1 focus:ring-accent outline-none"
                            value={post.summary} onChange={e => setPost({...post, summary: e.target.value})}
                            autoComplete="off"
                        />
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold uppercase text-accent">Content</label>
                            {aiEnabled && (
                                <button 
                                    type="button"
                                    onClick={onAutoEnhance}
                                    className="text-xs flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                                    disabled={isEnhancing || !post.content}
                                >
                                    <Sparkles size={14} /> {isEnhancing ? 'Enhancing...' : 'Auto-Enhance'}
                                </button>
                            )}
                        </div>

                        {isEnhancing && (
                            <div className="mb-4 p-6 bg-accent bg-opacity-5 border border-accent border-dashed rounded-lg animate-in fade-in duration-300">
                                <div className="flex flex-col items-center justify-center gap-3">
                                    <div className="flex gap-2">
                                        <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                        <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                        <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
                                    </div>
                                    <div className="text-sm font-bold text-accent flex items-center gap-2 uppercase tracking-wider">
                                        <Sparkles className="animate-pulse" size={18} /> Processing Enhancement...
                                    </div>
                                    <p className="text-[10px] opacity-60 italic text-center">AI is analyzing and rewriting your content for better flow and engagement.</p>
                                </div>
                            </div>
                        )}

                        {enhancedPreview && (
                            <div className="mb-4 p-4 bg-accent bg-opacity-5 border border-accent rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-accent flex items-center gap-2">
                                        <Sparkles size={16} /> Enhanced Content Preview
                                    </h4>
                                    <div className="flex gap-2">
                                        <button 
                                            type="button"
                                            onClick={onApplyEnhancement}
                                            className="p-1 px-3 bg-accent text-white rounded text-xs font-bold hover:bg-opacity-80 transition"
                                        >
                                            Apply Changes
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={onDismissEnhancement}
                                            className="p-1 px-3 bg-secondary border border-accent border-opacity-30 rounded text-xs font-bold hover:bg-bg transition"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto p-3 bg-bg rounded text-sm opacity-80 border border-accent border-opacity-10 whitespace-pre-wrap font-mono">
                                    {enhancedPreview}
                                </div>
                                <p className="text-[10px] mt-2 opacity-50 italic">Review the AI-enhanced content above. Clicking 'Apply' will replace your current content.</p>
                            </div>
                        )}

                        <MdEditor
                            modelValue={post.content}
                            onChange={(val) => setPost({...post, content: val})}
                            theme={theme}
                            language="en-US"
                            placeholder="Write your post content here (Markdown supported)..."
                            style={{ height: '500px' }}
                            toolbars={[
                                'bold',
                                'italic',
                                'title',
                                '-',
                                'strikeThrough',
                                'sub',
                                'sup',
                                'quote',
                                'unorderedList',
                                'orderedList',
                                '-',
                                'codeRow',
                                'code',
                                'link',
                                'image',
                                'table',
                                'mermaid',
                                'katex',
                                '-',
                                'revoke',
                                'next',
                                'save',
                                '=',
                                'pageFullscreen',
                                'fullscreen',
                                'preview',
                                'htmlPreview',
                                'catalog',
                                'github'
                            ]}
                        />
                    </div>
                    <div className="flex gap-4 pt-4 border-t border-accent border-opacity-20">
                        <button type="submit" className="bg-accent p-3 px-8 rounded font-bold hover:bg-opacity-80 transition text-white shadow-lg">Save Post</button>
                        <button type="button" onClick={onCancel} className="p-3 px-8 border border-accent rounded font-bold hover:bg-accent hover:bg-opacity-10 transition">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ImagePickerModal = ({ isOpen, images, onSelect, onClose, onUpload }: { isOpen: boolean; images: ImageInfo[]; onSelect: (filename: string) => void; onClose: () => void; onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
            <div className="bg-secondary rounded-2xl shadow-2xl border border-accent border-opacity-30 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="p-6 border-b border-accent border-opacity-20 flex justify-between items-center bg-bg bg-opacity-50">
                    <div>
                        <h2 className="text-2xl font-bold">Select Image</h2>
                        <p className="text-xs opacity-60">Choose an existing image or upload a new one</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="bg-accent bg-opacity-10 text-accent p-2 px-4 rounded-lg font-bold border border-accent border-opacity-30 hover:bg-opacity-20 transition cursor-pointer flex items-center gap-2">
                            <Upload size={18} /> Upload New
                            <input type="file" className="hidden" accept="image/*" onChange={onUpload} />
                        </label>
                        <button onClick={onClose} className="p-2 hover:bg-accent hover:bg-opacity-10 rounded-lg transition text-accent"><X size={28} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {images.map(img => (
                        <div 
                            key={img.filename} 
                            onClick={() => { onSelect(img.filename); onClose(); }}
                            className="group cursor-pointer rounded-xl border border-accent border-opacity-10 p-2 transition hover:border-opacity-100 hover:bg-accent hover:bg-opacity-5 relative"
                        >
                            <div className="aspect-square rounded-lg overflow-hidden bg-bg flex items-center justify-center mb-2 border border-accent border-opacity-5 group-hover:border-opacity-20">
                                <img src={`/api/images/${img.filename}`} alt={img.originalName} className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105" />
                            </div>
                            <p className="text-[10px] font-medium truncate opacity-70 group-hover:opacity-100" title={img.originalName}>{img.originalName}</p>
                            <div className="absolute inset-0 bg-accent bg-opacity-0 group-hover:bg-opacity-5 transition-all rounded-xl pointer-events-none"></div>
                        </div>
                    ))}
                    {images.length === 0 && (
                        <div className="col-span-full py-32 text-center">
                            <ImageIcon className="mx-auto mb-4 opacity-20" size={64} />
                            <p className="opacity-50 font-medium">No images found in your library.</p>
                            <p className="text-xs opacity-30 mt-1">Upload some images to get started!</p>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-accent border-opacity-20 flex justify-end bg-bg bg-opacity-50">
                    <button onClick={onClose} className="p-3 px-8 bg-secondary border border-accent border-opacity-30 rounded-lg font-bold hover:bg-opacity-80 transition">Close</button>
                </div>
            </div>
        </div>
    );
};

const Admin = ({ user, siteName, setSiteName, siteLogo, setSiteLogo, showAlert, showConfirm }: { 
    user: User | null; 
    siteName: string; 
    setSiteName: (name: string) => void; 
    siteLogo?: string;
    setSiteLogo: (logo?: string) => void;
    showAlert: (msg: string, title?: string) => void; 
    showConfirm: (msg: string, onConfirm: () => void, title?: string) => void; 
}) => {
    const [activeTab, setActiveTab] = useState('posts');
    const [isDragging, setIsDragging] = useState(false);
    const [users, setUsers] = useState<any[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [themes, setThemes] = useState<string[]>([]);
    const [images, setImages] = useState<ImageInfo[]>([]);
    const [imagePage, setImagePage] = useState(1);
    const [imagesPerPage, setImagesPerPage] = useState('30');
    const [totalImages, setTotalImages] = useState(0);
    const [showLogoPicker, setShowLogoPicker] = useState(false);
    const [config, setConfig] = useState<any>({
        siteName: siteName,
        siteLogo: siteLogo || 'logo.webp',
        currentTheme: 'dark',
        pagination: 10,
        sortBy: 'date',
        sortOrder: 'desc',
        searchPlacement: 'top',
        aiConfig: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            apiKey: '',
            modelId: 'llama3',
            enabled: true
        },
        service: {
            port: 3001
        }
    });
    const [isWritable, setIsWritable] = useState(true);
    const [editingPost, setEditingPost] = useState<any>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [themeColors, setThemeColors] = useState<Record<string, string> | null>(null);

    const themeLabelMap: Record<string, string> = {
        '--primary': 'Primary',
        '--secondary': 'Secondary',
        '--accent': 'Accent',
        '--text': 'Text',
        '--bg': 'Background',
        '--border': 'Border',
        '--hover': 'Hover',
        '--site-name-color': 'Site Name Text'
    };

    const getThemeLabel = (key: string) => themeLabelMap[key] || key.replace(/^--/, '').charAt(0).toUpperCase() + key.replace(/^--/, '').slice(1);

    useEffect(() => {
        if (themeColors) {
            const root = document.documentElement;
            Object.entries(themeColors).forEach(([key, value]) => {
                root.style.setProperty(key, value as string);
            });
        }
    }, [themeColors]);

    useEffect(() => {
        if (activeTab === 'appearance' || !themeColors) {
            api.get('/theme?name=' + config.currentTheme).then(res => {
                setThemeColors(res.data);
            });
        }
    }, [activeTab, config.currentTheme]);

    useEffect(() => {
        const handleThemeChanged = (e: CustomEvent) => {
            const newTheme = e.detail;
            if (newTheme && typeof newTheme === 'string') {
                setConfig((prev: any) => ({ ...prev, currentTheme: newTheme }));
                api.get('/theme?name=' + newTheme).then(res => {
                    setThemeColors(res.data);
                });
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

    useEffect(() => {
        if (user && user.role === 'admin') {
            fetchUsers();
            fetchThemes();
            fetchConfig();
            fetchConfigStatus();
        }
        fetchPosts();
        fetchImages();
    }, [user]);

    useEffect(() => {
        if (user) fetchImages();
    }, [imagePage, imagesPerPage]);

    const fetchUsers = () => api.get('/admin/users').then(res => { setUsers(res.data); return res; });
    const fetchPosts = () => api.get('/posts').then(res => { setPosts(res.data); return res; });
    const fetchThemes = () => api.get('/admin/themes').then(res => { setThemes(res.data); return res; });
    const fetchImages = () => {
        const limit = imagesPerPage;
        const offset = (imagePage - 1) * (limit === 'all' ? 0 : parseInt(limit));
        return api.get(`/admin/images?limit=${limit}&offset=${offset}`).then(res => { 
            setImages(res.data.images); 
            setTotalImages(res.data.total);
            return res; 
        });
    };
    const fetchConfig = () => api.get('/config').then(res => {
        const data = res.data;
        // Ensure aiConfig exists and has defaults for the UI
        if (!data.aiConfig) {
            data.aiConfig = {
                enabled: false,
                provider: 'ollama',
                baseUrl: 'http://localhost:11434',
                apiKey: '',
                modelId: 'llama3'
            };
        }
        setConfig(data);
        if (data.service?.port) {
            localStorage.setItem('lastPort', data.service.port.toString());
        }
        return res;
    });
    const fetchConfigStatus = () => api.get('/admin/config-status').then(res => { setIsWritable(res.data.isWritable); return res; });

    const fetchAIModels = (p?: string, b?: string, k?: string) => {
        const provider = p || config.aiConfig?.provider || 'ollama';
        const baseUrl = b || config.aiConfig?.baseUrl || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1');
        const apiKey = k !== undefined ? k : (config.aiConfig?.apiKey || '');
        
        console.log(`[AI] fetchAIModels called. Provider: ${provider}, BaseURL: ${baseUrl}, API Key set: ${!!apiKey}`);
        
        if (provider !== 'ollama' || !baseUrl) {
            console.warn('[AI] fetchAIModels aborted: missing provider or baseUrl');
            return;
        }
        
        setIsLoadingModels(true);
        api.get(`/ai/models?provider=${provider}&baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`)
            .then(res => {
                console.log(`[AI] Successfully fetched ${res.data?.length || 0} models`);
                setAvailableModels(res.data);
            })
            .catch(err => {
                console.error('[AI] Failed to fetch models:', err);
                showAlert('Could not connect to Ollama to fetch models. Please check your Base URL.', 'Connection Error');
            })
            .finally(() => setIsLoadingModels(false));
    };

    useEffect(() => {
        if (activeTab === 'ai' && config.aiConfig?.provider === 'ollama' && config.aiConfig?.baseUrl) {
            fetchAIModels();
        }
    }, [activeTab, config.aiConfig?.provider, config.aiConfig?.baseUrl]);

    const handleSaveConfig = () => {
        api.post('/admin/config', config).then(() => {
            const oldPort = parseInt(localStorage.getItem('lastPort') || '5173');
            const newPort = config.service?.port || 5173;
            
            setSiteName(config.siteName);
            setSiteLogo(config.siteLogo || undefined);
            fetchConfig();
            applyTheme(config.currentTheme);
            // Notify other components (like Navbar) that the theme might have changed via selection
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: config.currentTheme }));
            
            if (oldPort !== newPort) {
                showAlert(`Settings saved! Port changed to ${newPort}. You will need to restart the service for this to take effect.`, 'Success');
                localStorage.setItem('lastPort', newPort.toString());
            } else {
                showAlert('Settings saved successfully!', 'Success');
            }
        });
    };

    const handleSaveAIConfig = () => {
        api.post('/admin/ai-config', config.aiConfig).then(() => {
            fetchConfig().then(() => {
                showAlert('AI settings saved successfully!', 'Success');
            });
        });
    };

    const handleSaveTheme = () => {
        api.post(`/admin/themes/${config.currentTheme}`, themeColors).then(() => {
            fetchThemes();
            showAlert(`${config.currentTheme.charAt(0).toUpperCase() + config.currentTheme.slice(1)} theme colors saved!`, 'Success');
        });
    };

    const handleDeleteUser = (username: string) => {
        showConfirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`, () => {
            api.delete(`/admin/users/${username}`).then(fetchUsers);
        }, 'Delete User');
    };

    const handleDeletePost = (slug: string) => {
        showConfirm(`Are you sure you want to delete post "${slug}"? This action cannot be undone.`, () => {
            api.delete(`/posts/${slug}`).then(fetchPosts);
        }, 'Delete Post');
    };

    const handleDeleteImage = (filename: string) => {
        showConfirm(`Are you sure you want to delete image "${filename}"? This action cannot be undone.`, () => {
            api.delete(`/admin/images/${filename}`).then(fetchImages);
        }, 'Delete Image');
    };

    const handleSavePost = (e: React.FormEvent) => {
        e.preventDefault();
        api.post('/posts', editingPost).then(() => {
            setEditingPost(null);
            fetchPosts();
            fetchImages();
        });
    };

    const uploadFiles = async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        let successCount = 0;
        let failCount = 0;
        let duplicateCount = 0;

        for (const file of fileArray) {
            if (!file.type.startsWith('image/')) continue;
            
            let force = false;
            let uploadSuccess = false;

            while (!uploadSuccess) {
                const formData = new FormData();
                formData.append('image', file);
                
                try {
                    const res = await api.post(`/admin/upload${force ? '?force=true' : ''}`, formData);
                    if (res.data.duplicated) {
                        duplicateCount++;
                    } else {
                        successCount++;
                    }
                    uploadSuccess = true;
                } catch (error: any) {
                    if (error.response?.status === 409) {
                        const confirmUpload = confirm(`An image named "${file.name}" already exists with different content. Do you want to upload it anyway as a new file?`);
                        if (confirmUpload) {
                            force = true;
                        } else {
                            uploadSuccess = true; // Skip this file
                        }
                    } else {
                        console.error('Upload failed for', file.name, error);
                        failCount++;
                        uploadSuccess = true;
                    }
                }
            }
        }

        if (successCount > 0 || duplicateCount > 0) {
            if (imagePage === 1) {
                fetchImages();
            } else {
                setImagePage(1);
            }
            
            if (failCount === 0) {
                if (duplicateCount > 0 && successCount === 0) {
                    showAlert(`Image${duplicateCount > 1 ? 's' : ''} already existed and ${duplicateCount > 1 ? 'were' : 'was'} skipped.`, 'Info');
                } else if (duplicateCount > 0) {
                    showAlert(`Uploaded ${successCount} new image${successCount > 1 ? 's' : ''} (${duplicateCount} already existed).`, 'Success');
                } else {
                    showAlert(`Successfully uploaded ${successCount} image${successCount > 1 ? 's' : ''}.`, 'Success');
                }
            } else {
                showAlert(`Uploaded ${successCount} images (${duplicateCount} skipped), but ${failCount} failed.`, 'Partial Success');
            }
        } else if (failCount > 0) {
            showAlert(`Failed to upload ${failCount} image${failCount > 1 ? 's' : ''}.`, 'Upload Failed');
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            uploadFiles(e.target.files);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    };

    const handleAutoSummarize = async () => {
        if (!editingPost || !editingPost.content) return;
        setIsSummarizing(true);
        try {
            const provider = config.aiConfig?.provider || 'ollama';
            const baseUrl = config.aiConfig?.baseUrl || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1');
            const modelId = config.aiConfig?.modelId || (provider === 'ollama' ? 'llama3' : 'gpt-3.5-turbo');

            const res = await api.post('/ai/summarize', { 
                content: editingPost.content,
                provider,
                baseUrl,
                modelId
            });
            if (res.data.summary) {
                setEditingPost({ ...editingPost, summary: res.data.summary });
            } else {
                showAlert('AI returned an empty summary. This might happen if the model is not responding correctly.', 'Warning');
            }
        } catch (error) {
            console.error('Summarization error:', error);
            const errorMsg = (error as any).response?.data?.message || 'Failed to generate summary. Please check your AI configuration on the backend.';
            showAlert(errorMsg, 'Error');
        } finally {
            setIsSummarizing(false);
        }
    };

    const handleAutoEnhance = async () => {
        if (!editingPost || !editingPost.content) return;
        setIsEnhancing(true);
        try {
            const provider = config.aiConfig?.provider || 'ollama';
            const baseUrl = config.aiConfig?.baseUrl || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1');
            const modelId = config.aiConfig?.modelId || (provider === 'ollama' ? 'llama3' : 'gpt-3.5-turbo');

            const res = await api.post('/ai/enhance', { 
                content: editingPost.content,
                provider,
                baseUrl,
                modelId
            });
            if (res.data.enhanced) {
                setEnhancedPreview(res.data.enhanced);
            } else {
                showAlert('AI returned an empty response. This might happen if the model is not responding correctly.', 'Warning');
            }
        } catch (error) {
            console.error('Enhancement error:', error);
            const errorMsg = (error as any).response?.data?.message || 'Failed to enhance content. Please check your AI configuration on the backend.';
            showAlert(errorMsg, 'Error');
        } finally {
            setIsEnhancing(false);
        }
    };

    if (!user || (user.role !== 'admin' && user.role !== 'contributor')) return <div className="p-8 text-center text-red-500">Access Denied</div>;

    const TabButton = ({ id, icon: Icon, label }: { id: string; icon: LucideIcon; label: string }) => (
        <button 
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 p-3 rounded-lg transition ${activeTab === id ? 'bg-accent text-white' : 'hover:bg-accent hover:bg-opacity-10'}`}
        >
            <Icon size={20} />
            <span className="hidden md:inline">{label}</span>
        </button>
    );

    return (
        <div className="container mx-auto p-4 max-w-6xl">
            <h1 className="text-3xl font-bold mb-8 flex items-center gap-2 justify-center">
                <Settings /> Settings Menu
            </h1>

            <div className="flex flex-wrap gap-2 mb-8 bg-secondary p-2 rounded-xl shadow-lg border border-accent border-opacity-30">
                <TabButton id="posts" icon={FileText} label="Posts" />
                {user.role === 'admin' && (
                    <>
                        <TabButton id="appearance" icon={Palette} label="Appearance" />
                        <TabButton id="layout" icon={Layout} label="Layout" />
                        <TabButton id="ai" icon={Cpu} label="AI Settings" />
                        <TabButton id="service" icon={Server} label="Service" />
                        <TabButton id="users" icon={Users} label="Users" />
                    </>
                )}
                <TabButton id="images" icon={ImageIcon} label="Images" />
            </div>

            <div className="bg-secondary p-8 rounded-xl shadow-2xl border border-accent border-opacity-30 min-h-[500px]">
                {!isWritable && (
                    <div className="mb-8 p-6 bg-red-500 bg-opacity-10 border-2 border-red-500 rounded-xl flex items-center gap-4 animate-pulse">
                        <AlertCircle className="text-red-500 flex-shrink-0" size={32} />
                        <div>
                            <h3 className="text-xl font-bold text-red-500">Settings Read-Only</h3>
                            <p className="text-sm opacity-90">The configuration file is not writable. Any changes you make in this menu will not be saved to the disk.</p>
                        </div>
                    </div>
                )}
                {activeTab === 'posts' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold">Manage Posts</h2>
                            <button 
                                onClick={() => setEditingPost({ slug: '', title: '', content: '', summary: '', date: new Date().toISOString().split('T')[0] })}
                                className="bg-accent p-2 px-4 rounded font-bold flex items-center gap-2 hover:bg-opacity-80 transition"
                            >
                                <Plus size={18} /> New Post
                            </button>
                        </div>
                        
                        <div className="space-y-4">
                            {posts.map(post => (
                                <div key={post.slug} className="flex justify-between items-center p-4 bg-bg rounded border border-accent border-opacity-20">
                                    <div>
                                        <h3 className="font-bold">{post.title}</h3>
                                        <p className="text-xs opacity-70">{post.slug} • {post.date}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => {
                                            api.get(`/posts/${post.slug}`).then(res => setEditingPost(res.data));
                                        }} className="p-2 hover:bg-accent rounded transition text-accent hover:text-white" title="Edit Post">
                                            <Edit size={18} />
                                        </button>
                                        {user.role === 'admin' && (
                                            <button onClick={() => handleDeletePost(post.slug)} className="p-2 hover:bg-red-500 rounded transition text-red-500 hover:text-white" title="Delete Post">
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <PostModal 
                    isOpen={!!editingPost}
                    post={editingPost || {}}
                    onSave={handleSavePost}
                    onCancel={() => { setEditingPost(null); setEnhancedPreview(null); }}
                    onAutoSummarize={handleAutoSummarize}
                    isSummarizing={isSummarizing}
                    onAutoEnhance={handleAutoEnhance}
                    isEnhancing={isEnhancing}
                    enhancedPreview={enhancedPreview}
                    onApplyEnhancement={() => {
                        if (enhancedPreview) {
                            setEditingPost({ ...editingPost, content: enhancedPreview });
                            setEnhancedPreview(null);
                        }
                    }}
                    onDismissEnhancement={() => setEnhancedPreview(null)}
                    setPost={setEditingPost}
                    aiEnabled={config.aiConfig?.enabled}
                    theme={config.currentTheme}
                />

                <ImagePickerModal 
                    isOpen={showLogoPicker}
                    images={images}
                    onSelect={(filename) => setConfig({...config, siteLogo: filename})}
                    onClose={() => setShowLogoPicker(false)}
                    onUpload={handleFileUpload}
                />

                {activeTab === 'appearance' && (
                    <div className="space-y-8">
                        <div>
                            <h2 className="text-2xl font-bold mb-4">Theme Selection</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {themes.map(t => (
                                    <button 
                                        key={t}
                                        onClick={() => setConfig({...config, currentTheme: t})}
                                        className={`p-4 rounded-lg border-2 transition ${config.currentTheme === t ? 'border-accent bg-accent bg-opacity-10' : 'border-accent border-opacity-20 hover:border-opacity-100'}`}
                                    >
                                        {t.charAt(0).toUpperCase() + t.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-2xl font-bold mb-4">Theme Editor</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold uppercase text-accent mb-2">Color Variables</h3>
                                    {['--primary', '--secondary', '--accent', '--text', '--bg', '--border', '--hover', '--site-name-color'].map(key => (
                                        <div key={key} className="flex items-center justify-between gap-4">
                                            <label className="text-sm font-medium">{getThemeLabel(key)}</label>
                                            <div className="flex gap-2 items-center">
                                                <input 
                                                    type="text" 
                                                    className="w-24 p-1 text-xs bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                                    value={themeColors?.[key] || ''} 
                                                    onChange={e => setThemeColors({...themeColors, [key]: e.target.value})}
                                                />
                                                <input 
                                                    type="color" 
                                                    value={themeColors?.[key] || '#000000'} 
                                                    onChange={e => setThemeColors({...themeColors, [key]: e.target.value})}
                                                    className="w-10 h-10 border-0 bg-transparent cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-4">
                                    <button onClick={handleSaveTheme} className="w-full bg-accent p-3 rounded font-bold text-white shadow-md hover:bg-opacity-90 transition">Save {config.currentTheme.charAt(0).toUpperCase() + config.currentTheme.slice(1)} Theme Colors</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'layout' && (
                    <div className="space-y-8 max-w-2xl mx-auto">
                        <h2 className="text-2xl font-bold mb-6">Site Layout & Post List</h2>
                        <div className="space-y-6">
                            <div className="space-y-1">
                                <label htmlFor="site-name" className="block text-xs font-bold uppercase text-accent">Site Name</label>
                                <input 
                                    id="site-name"
                                    type="text" className="w-full p-3 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                    value={config.siteName} onChange={e => setConfig({...config, siteName: e.target.value})}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="space-y-1">
                                <label htmlFor="site-logo" className="block text-xs font-bold uppercase text-accent">Site Logo</label>
                                <div className="flex gap-2">
                                    <div className="flex-1 p-3 bg-bg border border-accent border-opacity-30 rounded text-text flex items-center justify-between group overflow-hidden">
                                        <div className="flex items-center gap-3 truncate">
                                            {config.siteLogo ? (
                                                <div className="h-8 w-8 rounded overflow-hidden bg-secondary flex items-center justify-center border border-accent border-opacity-20">
                                                    <img src={`/api/images/${config.siteLogo}`} className="max-h-full max-w-full object-contain" alt="Logo preview" />
                                                </div>
                                            ) : (
                                                <div className="h-8 w-8 rounded bg-accent bg-opacity-10 flex items-center justify-center border border-accent border-opacity-20 text-accent">
                                                    <ImageIcon size={16} />
                                                </div>
                                            )}
                                            <span className="truncate text-sm font-medium">{config.siteLogo || 'No logo selected'}</span>
                                        </div>
                                        <button 
                                            onClick={() => setConfig({...config, siteLogo: ''})}
                                            className={`p-1 hover:bg-red-500 hover:bg-opacity-10 rounded text-red-500 transition-opacity ${config.siteLogo ? 'opacity-100' : 'opacity-0'}`}
                                            title="Clear logo"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => setShowLogoPicker(true)}
                                        className="p-3 bg-accent text-white rounded font-bold hover:bg-opacity-90 transition flex items-center gap-2 whitespace-nowrap"
                                    >
                                        <Plus size={18} /> Select Image
                                    </button>
                                </div>
                                <p className="text-[10px] opacity-50 italic">If set, this image will be used in the header instead of the site name text. Defaults to logo.webp if available.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label htmlFor="pagination" className="block text-xs font-bold uppercase text-accent">Posts Per Page</label>
                                    <input 
                                        id="pagination"
                                        type="number" className="w-full p-3 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                        value={config.pagination} onChange={e => setConfig({...config, pagination: Number(e.target.value)})}
                                        autoComplete="off"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="search-placement" className="block text-xs font-bold uppercase text-accent">Search Placement</label>
                                    <select 
                                        id="search-placement"
                                        className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        value={config.searchPlacement} onChange={e => setConfig({...config, searchPlacement: e.target.value})}
                                    >
                                        <option value="top" className="bg-secondary text-text">Top</option>
                                        <option value="bottom" className="bg-secondary text-text">Bottom</option>
                                        <option value="left" className="bg-secondary text-text">Left</option>
                                        <option value="right" className="bg-secondary text-text">Right</option>
                                        <option value="none" className="bg-secondary text-text">None</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label htmlFor="sort-by" className="block text-xs font-bold uppercase text-accent">Sort By</label>
                                    <select 
                                        id="sort-by"
                                        className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        value={config.sortBy} onChange={e => setConfig({...config, sortBy: e.target.value})}
                                    >
                                        <option value="date" className="bg-secondary text-text">Date</option>
                                        <option value="title" className="bg-secondary text-text">Title</option>
                                        <option value="author" className="bg-secondary text-text">Author</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="sort-order" className="block text-xs font-bold uppercase text-accent">Sort Order</label>
                                    <select 
                                        id="sort-order"
                                        className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        value={config.sortOrder} onChange={e => setConfig({...config, sortOrder: e.target.value})}
                                    >
                                        <option value="desc" className="bg-secondary text-text">Descending</option>
                                        <option value="asc" className="bg-secondary text-text">Ascending</option>
                                    </select>
                                </div>
                            </div>
                            <button onClick={handleSaveConfig} className="w-full bg-accent p-3 rounded font-bold mt-4 shadow-lg hover:bg-opacity-90 transition text-white">
                                Save All Settings
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'ai' && (
                    <div className="max-w-2xl mx-auto">
                        <h2 className="text-2xl font-bold mb-6">AI Summarization Settings</h2>
                        <form onSubmit={(e) => { e.preventDefault(); handleSaveAIConfig(); }} className="space-y-4 bg-bg p-6 rounded-lg border border-accent border-opacity-20">
                            <div className="flex items-center gap-2 mb-4">
                                <input 
                                    id="ai-enabled"
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-accent text-accent focus:ring-accent bg-secondary"
                                    checked={config.aiConfig?.enabled || false}
                                    onChange={e => {
                                        const isChecked = e.target.checked;
                                        setConfig((prev: any) => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', baseUrl: '', apiKey: '', modelId: '' }), enabled: isChecked}}));
                                    }}
                                />
                                <label htmlFor="ai-enabled" className="text-sm font-bold uppercase text-accent cursor-pointer">Enable AI Features</label>
                            </div>
                            
                            {!config.aiConfig?.enabled && (
                                <p className="text-sm opacity-70 italic mb-4">
                                    AI features are currently disabled. Enable them to configure provider and model settings.
                                </p>
                            )}

                            <div className={`space-y-4 transition-opacity ${!config.aiConfig?.enabled ? 'opacity-30 pointer-events-none' : ''}`}>
                                <div className="space-y-1">
                                    <label htmlFor="ai-provider" className="block text-xs font-bold uppercase text-accent">Provider</label>
                                    <select 
                                        id="ai-provider"
                                        className="w-full p-3 bg-secondary border border-accent rounded text-text"
                                        value={config.aiConfig?.provider || 'ollama'} 
                                        onChange={e => {
                                            const newProvider = e.target.value;
                                            const defaults = newProvider === 'ollama' 
                                                ? { baseUrl: 'http://localhost:11434', modelId: 'llama3' }
                                                : { baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-3.5-turbo' };
                                            
                                            setConfig({
                                                ...config, 
                                                aiConfig: {
                                                    ...(config.aiConfig || { baseUrl: '', apiKey: '', modelId: '', enabled: true }), 
                                                    provider: newProvider as 'ollama' | 'openai',
                                                    baseUrl: defaults.baseUrl,
                                                    modelId: defaults.modelId
                                                }
                                            });
                                        }}
                                    >
                                        <option value="ollama">Ollama (Local)</option>
                                        <option value="openai">OpenAI (Cloud)</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="ai-base-url" className="block text-xs font-bold uppercase text-accent">Base URL</label>
                                    <input 
                                        id="ai-base-url"
                                        type="text" placeholder={config.aiConfig?.provider === 'ollama' ? "http://localhost:11434" : "https://api.openai.com/v1"}
                                        className="w-full p-3 bg-secondary border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                        value={config.aiConfig?.baseUrl || ''} 
                                        onChange={e => {
                                            const newVal = e.target.value;
                                            setConfig((prev: any) => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', apiKey: '', modelId: '', enabled: true }), baseUrl: newVal}}));
                                        }}
                                        autoComplete="off"
                                    />
                                    <p className="text-[10px] opacity-60">Ollama default: http://localhost:11434 | OpenAI default: https://api.openai.com/v1</p>
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="ai-model-id" className="block text-xs font-bold uppercase text-accent">Model ID</label>
                                    <div className="flex gap-2">
                                        {config.aiConfig?.provider === 'ollama' ? (
                                            <select 
                                                id="ai-model-id"
                                                className="flex-1 p-3 bg-secondary border border-accent rounded text-text"
                                                value={config.aiConfig?.modelId || ''} 
                                                onChange={e => {
                                                    const newVal = e.target.value;
                                                    setConfig((prev: any) => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', baseUrl: '', apiKey: '', enabled: true }), modelId: newVal}}));
                                                }}
                                            >
                                                <option value="" className="bg-secondary">Select a model...</option>
                                                {availableModels.map(model => (
                                                    <option key={model} value={model} className="bg-secondary text-text">{model}</option>
                                                ))}
                                                {config.aiConfig?.modelId && !availableModels.includes(config.aiConfig.modelId) && (
                                                    <option value={config.aiConfig.modelId} className="bg-secondary text-text">{config.aiConfig.modelId} (Saved)</option>
                                                )}
                                            </select>
                                        ) : (
                                            <input 
                                                id="ai-model-id"
                                                type="text" 
                                                placeholder="gpt-3.5-turbo"
                                                className="flex-1 p-3 bg-secondary border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                                value={config.aiConfig?.modelId || ''} 
                                                onChange={e => {
                                                    const newVal = e.target.value;
                                                    setConfig((prev: any) => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'openai', baseUrl: '', apiKey: '', enabled: true }), modelId: newVal}}));
                                                }}
                                                autoComplete="off"
                                            />
                                        )}
                                        {config.aiConfig?.provider === 'ollama' && (
                                            <button 
                                                id="ai-refresh-models"
                                                type="button"
                                                onClick={(e) => {
                                                    console.log('[AI] Refresh button clicked');
                                                    e.preventDefault();
                                                    // Using values from current config state directly ensures we get the latest values
                                                    fetchAIModels(
                                                        config.aiConfig?.provider,
                                                        config.aiConfig?.baseUrl,
                                                        config.aiConfig?.apiKey
                                                    );
                                                }}
                                                className="p-2 bg-secondary border border-accent rounded hover:bg-opacity-80 transition flex items-center justify-center"
                                                title="Refresh models"
                                                disabled={isLoadingModels}
                                            >
                                                <RefreshCw className={isLoadingModels ? "animate-spin" : ""} size={20} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="ai-api-key" className="block text-xs font-bold uppercase text-accent">API Key (Optional for Ollama)</label>
                                    <input 
                                        id="ai-api-key"
                                        type="password" placeholder="sk-..." 
                                        className="w-full p-3 bg-secondary border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                        value={config.aiConfig?.apiKey || ''} 
                                        onChange={e => {
                                            const newVal = e.target.value;
                                            setConfig((prev: any) => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', baseUrl: '', modelId: '', enabled: true }), apiKey: newVal}}));
                                        }}
                                        autoComplete="new-password"
                                    />
                                </div>
                            </div>
                            <button type="submit" className="bg-accent p-3 px-6 rounded font-bold w-full mt-4">Save AI Configuration</button>
                        </form>
                    </div>
                )}

                {activeTab === 'service' && (
                    <div className="max-w-2xl mx-auto">
                        <h2 className="text-2xl font-bold mb-6">Service Settings</h2>
                        <div className="space-y-6 bg-bg p-6 rounded-lg border border-accent border-opacity-20">
                            <div className="space-y-1">
                                <label htmlFor="service-port" className="block text-xs font-bold uppercase text-accent">TCP Port</label>
                                <input 
                                    id="service-port"
                                    type="number" className="w-full p-3 bg-secondary border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                    value={config.service?.port || 5173} 
                                    onChange={e => {
                                        const newVal = parseInt(e.target.value, 10);
                                        setConfig((prev: any) => ({...prev, service: {...(prev.service || {}), port: newVal}}));
                                    }}
                                    autoComplete="off"
                                    disabled={!isWritable}
                                />
                                <p className="text-[10px] opacity-60">Specify the port the application should listen on. Defaults to 5173.</p>
                            </div>
                            <button 
                                onClick={handleSaveConfig} 
                                className={`w-full bg-accent p-3 rounded font-bold shadow-lg hover:bg-opacity-90 transition text-white ${!isWritable ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={!isWritable}
                            >
                                Save Service Settings
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'users' && (
                    <div className="space-y-8">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold">User Management</h2>
                        </div>
                        
                        <div className="grid gap-4">
                            {users.map(u => (
                                <div key={u.username} className="flex justify-between items-center p-4 bg-bg rounded border border-accent border-opacity-20">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center font-bold">
                                            {u.username[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-bold">{u.username}</p>
                                            <p className="text-xs text-accent uppercase tracking-wider">{u.role}</p>
                                        </div>
                                    </div>
                                    {u.role !== 'admin' && (
                                        <button onClick={() => handleDeleteUser(u.username)} className="p-2 text-red-500 hover:bg-red-500 hover:text-white rounded transition">
                                            <Trash2 size={20} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="mt-12 p-6 border border-accent border-opacity-30 rounded-lg">
                            <h3 className="text-xl font-bold mb-4">Create New User</h3>
                            <form onSubmit={(e) => {
                                e.preventDefault();
                                const fd = new FormData(e.target);
                                const data = Object.fromEntries(fd);
                                api.post('/admin/users', data).then(() => {
                                    fetchUsers();
                                    e.target.reset();
                                });
                            }} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div className="md:col-span-1 space-y-1">
                                    <label htmlFor="new-username" className="block text-xs font-bold uppercase text-accent">Username</label>
                                    <input id="new-username" name="username" type="text" className="w-full p-2 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50" placeholder="Username" required autoComplete="off" />
                                </div>
                                <div className="md:col-span-1 space-y-1">
                                    <label htmlFor="new-password" className="block text-xs font-bold uppercase text-accent">Password</label>
                                    <input id="new-password" name="password" type="password" className="w-full p-2 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50" placeholder="Password" required autoComplete="new-password" />
                                </div>
                                <div className="md:col-span-1 space-y-1">
                                    <label htmlFor="new-role" className="block text-xs font-bold uppercase text-accent">Role</label>
                                    <select id="new-role" name="role" className="w-full p-2 bg-bg border border-accent rounded text-text">
                                        <option value="contributor" className="bg-secondary text-text">Contributor</option>
                                        <option value="admin" className="bg-secondary text-text">Admin</option>
                                    </select>
                                </div>
                                <button type="submit" className="bg-accent p-2 rounded font-bold text-white shadow-md hover:bg-opacity-90 transition">Add User</button>
                            </form>
                        </div>
                    </div>
                )}

                {activeTab === 'images' && (
                    <div 
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`min-h-[400px] rounded-xl transition-all duration-300 ${isDragging ? 'bg-accent bg-opacity-10 border-2 border-dashed border-accent p-4' : ''}`}
                    >
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-4">
                                <h2 className="text-2xl font-bold">Image Manager</h2>
                                <div className="flex items-center gap-2 bg-secondary p-1 px-3 rounded text-xs border border-accent border-opacity-20">
                                    <span className="opacity-60">Show:</span>
                                    <select 
                                        value={imagesPerPage} 
                                        onChange={(e) => {
                                            setImagesPerPage(e.target.value);
                                            setImagePage(1);
                                        }}
                                        className="bg-transparent font-bold outline-none cursor-pointer"
                                    >
                                        <option value="30" className="bg-secondary">30</option>
                                        <option value="50" className="bg-secondary">50</option>
                                        <option value="100" className="bg-secondary">100</option>
                                        <option value="all" className="bg-secondary">All</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {isDragging && <span className="text-accent font-bold animate-pulse flex items-center mr-4">Drop images here...</span>}
                                <label className="bg-accent p-2 px-4 rounded font-bold flex items-center gap-2 hover:bg-opacity-80 transition cursor-pointer shadow-md">
                                    <Upload size={18} /> Upload Image
                                    <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*" multiple />
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {images.map(img => (
                                <div key={img.filename} className="group relative bg-bg rounded overflow-hidden border border-accent border-opacity-20 aspect-square">
                                    <img src={`/api/images/${img.filename}`} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center p-2 text-center gap-2">
                                        <p className="text-[10px] text-white font-bold truncate w-full px-1" title={img.originalName}>{img.originalName}</p>
                                        <p className="text-[8px] text-white opacity-60 truncate w-full px-1">{img.filename}</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => {
                                                    navigator.clipboard.writeText(`![${img.originalName}](/api/images/${img.filename})`);
                                                    showAlert('Markdown link copied to clipboard!');
                                                }}
                                                className="bg-accent text-white p-1 px-2 rounded text-[10px] font-bold flex items-center gap-1"
                                                title="Copy Markdown Link"
                                            >
                                                <Copy size={10} /> MD
                                            </button>
                                            {editingPost && (
                                                <button 
                                                    onClick={() => {
                                                        const imgLink = `\n![${img.originalName}](/api/images/${img.filename})\n`;
                                                        setEditingPost({
                                                            ...editingPost,
                                                            content: editingPost.content + imgLink
                                                        });
                                                        showAlert('Image successfully injected into the editor!');
                                                    }}
                                                    className="bg-blue-600 text-white p-1 px-2 rounded text-[10px] font-bold"
                                                >
                                                    Inject
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => handleDeleteImage(img.filename)}
                                                className="bg-red-600 text-white p-1 px-2 rounded text-[10px] font-bold flex items-center gap-1"
                                                title="Delete Image"
                                            >
                                                <Trash2 size={10} /> Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {images.length === 0 && <p className="text-center text-gray-500 mt-8">No images uploaded yet.</p>}
                        
                        {images.length > 0 && imagesPerPage !== 'all' && (
                            <div className="flex justify-center items-center gap-4 mt-8">
                                <button 
                                    disabled={imagePage === 1}
                                    onClick={() => setImagePage(p => Math.max(1, p - 1))}
                                    className="p-2 px-4 bg-secondary border border-accent border-opacity-20 rounded disabled:opacity-30 hover:bg-accent hover:bg-opacity-10 transition"
                                >
                                    Previous
                                </button>
                                <span className="font-bold">Page {imagePage} of {Math.max(1, Math.ceil(totalImages / parseInt(imagesPerPage)))}</span>
                                <button 
                                    disabled={imagePage >= Math.ceil(totalImages / parseInt(imagesPerPage))}
                                    onClick={() => setImagePage(p => p + 1)}
                                    className="p-2 px-4 bg-secondary border border-accent border-opacity-20 rounded disabled:opacity-30 hover:bg-accent hover:bg-opacity-10 transition"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function App() {
    const [user, setUser] = useState<User | null>(null);
    const [siteName, setSiteName] = useState('MDWeb');
    const [siteLogo, setSiteLogo] = useState<string | undefined>(undefined);
    const [notifications, setNotifications] = useState<AlertType[]>([]);

    useEffect(() => {
        const initTheme = async () => {
            const localTheme = localStorage.getItem('theme');
            // Strict check: only light/dark from localStorage
            if (localTheme === 'light' || localTheme === 'dark') {
                await applyTheme(localTheme);
            } else {
                try {
                    const res = await api.get('/config');
                    if (res.data.currentTheme) {
                        await applyTheme(res.data.currentTheme);
                    } else {
                        await applyTheme();
                    }
                } catch (e) {
                    await applyTheme();
                }
            }
        };
        
        initTheme();

        api.get('/config').then(res => {
            if (res.data.siteName) {
                setSiteName(res.data.siteName);
                document.title = res.data.siteName;
            }
            if (res.data.siteLogo) {
                setSiteLogo(res.data.siteLogo);
            }
        });
        const token = localStorage.getItem('token');
        const role = localStorage.getItem('role');
        const username = localStorage.getItem('username');
        if (token) {
            const localTheme = localStorage.getItem('theme');
            setUser({ 
                role: role || 'contributor', 
                username: username || 'unknown', 
                theme: (localTheme === 'light' || localTheme === 'dark') ? localTheme : undefined 
            }); 
        }
    }, []);

    const [modal, setModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: string;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert',
        onConfirm: () => {}
    });

    const showAlert = (message: string, title = '') => {
        const id = Date.now();
        setNotifications((prev: AlertType[]) => [...prev, { id, message, title }]);
    };

    const removeNotification = (id: number) => {
        setNotifications((prev: AlertType[]) => prev.filter(n => n.id !== id));
    };

    const showConfirm = (message: string, onConfirm: () => void, title = '') => {
        setModal({
            isOpen: true,
            title,
            message,
            type: 'confirm',
            onConfirm: () => {
                onConfirm();
                setModal((prev: any) => ({ ...prev, isOpen: false }));
            }
        });
    };

    return (
        <Router>
            <div className="min-h-screen bg-bg text-text">
                <Navbar user={user} setUser={setUser} siteName={siteName} siteLogo={siteLogo} />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                    <Route path="/login" element={<Login setUser={setUser} />} />
                    <Route path="/admin" element={<Admin user={user} siteName={siteName} setSiteName={setSiteName} siteLogo={siteLogo} setSiteLogo={setSiteLogo} showAlert={showAlert} showConfirm={showConfirm} />} />
                </Routes>
                <footer className="p-8 text-center opacity-50 text-sm mt-12 border-t border-secondary">
                    © 2026 {siteName}. All rights reserved. Built with Vite + React.
                </footer>
            </div>
            <div className="fixed top-4 right-4 z-[100] pointer-events-none flex flex-col items-end">
                {notifications.map(n => (
                    <Notification key={n.id} {...n} onClose={removeNotification} />
                ))}
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
