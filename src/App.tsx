import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import axios from 'axios';
import { MdEditor } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import { Search, LogIn, LogOut, Settings, Trash2, Edit, Plus, Upload, Palette, Layout, Users, FileText, Image as ImageIcon, Copy, Sparkles, Sun, Moon, Cpu, RefreshCw, X } from 'lucide-react';

// API Instance
const api = axios.create({
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
            // Only redirect if we were actually trying to use a token
            const token = localStorage.getItem('token');
            if (token) {
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
    } catch (error) {
        console.error('Failed to load theme', error);
    }
};

const Navbar = ({ user, setUser, siteName }) => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || '');
    useEffect(() => {
        // If we have a theme in user object (from login), use it
        if (user && user.theme) {
            setTheme(user.theme);
            applyTheme(user.theme);
            localStorage.setItem('theme', user.theme);
            return;
        }

        // Otherwise fetch from config or use localStorage
        const localTheme = localStorage.getItem('theme');
        if (localTheme) {
            setTheme(localTheme);
            applyTheme(localTheme);
        } else {
            api.get('/config').then(res => {
                const currentTheme = res.data.currentTheme;
                setTheme(currentTheme);
                applyTheme(currentTheme);
                localStorage.setItem('theme', currentTheme);
            }).catch(() => {
                // fallback to default theme
                applyTheme();
            });
        }
    }, [user]);

    const toggleTheme = async () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        try {
            await api.post('/theme', { currentTheme: newTheme });
            setTheme(newTheme);
            localStorage.setItem('theme', newTheme);
            await applyTheme(newTheme);
        } catch (e) {
            console.error('Failed to toggle theme', e);
        }
    };
    const navigate = useNavigate();
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
        <nav className="p-4 bg-secondary text-text flex justify-between items-center shadow-md">
            <Link to="/" className="text-2xl font-bold flex items-center gap-2">
                <span className="text-accent">{firstPart}</span> {restParts}
            </Link>
            <div className="flex gap-4 items-center">
                                <button onClick={toggleTheme} className="p-2 hover:bg-accent rounded transition hover:text-white" title="Toggle theme">
                                    {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                                </button>
                {user ? (
                    <>
                        <span className="hidden sm:inline opacity-70">Hello, {user.username}</span>
                        {(user.role === 'admin' || user.role === 'contributor') && (
                            <Link to="/admin" className="p-2 hover:bg-accent rounded transition hover:text-white" title="Settings">
                                <Settings size={20} />
                            </Link>
                        )}
                        <button onClick={handleLogout} className="p-2 hover:bg-accent rounded transition hover:text-white" title="Logout">
                            <LogOut size={20} />
                        </button>
                    </>
                ) : (
                    <Link to="/login" className="p-2 hover:bg-accent rounded transition hover:text-white" title="Login">
                        <LogIn size={20} />
                    </Link>
                )}
            </div>
        </nav>
    );
};

const Home = () => {
    const [posts, setPosts] = useState([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        api.get('/posts').then(res => setPosts(res.data));
    }, []);

    const filteredPosts = posts.filter(p => 
        p.title.toLowerCase().includes(search.toLowerCase()) || 
        p.summary.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="container mx-auto p-4 max-w-4xl">
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
        </div>
    );
};

const PostDetail = () => {
    const { slug } = useParams();
    const [post, setPost] = useState(null);

    useEffect(() => {
        api.get(`/posts/${slug}`).then(res => setPost(res.data));
    }, [slug]);

    if (!post) return <div className="p-8 text-center">Loading...</div>;

    return (
        <div className="container mx-auto p-4 max-w-4xl bg-secondary my-8 rounded-lg shadow-2xl overflow-hidden">
            <div className="p-8">
                <h1 className="text-4xl font-extrabold mb-4 border-b border-accent border-opacity-30 pb-4">{post.title}</h1>
                <div className="flex gap-4 text-sm opacity-70 mb-8">
                    <span>{new Date(post.date).toLocaleDateString()}</span>
                    {post.author && <span>by {post.author}</span>}
                </div>
                <div className="prose max-w-none prose-headings:text-primary prose-a:text-accent prose-p:text-text prose-strong:text-text prose-code:text-accent">
                    <ReactMarkdown>{DOMPurify.sanitize(post.content)}</ReactMarkdown>
                </div>
                <div className="mt-12">
                    <Link to="/" className="text-accent hover:underline">← Back to home</Link>
                </div>
            </div>
        </div>
    );
};

const Login = ({ setUser }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
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
                        type="password" 
                        className="w-full p-3 rounded bg-bg text-text border border-accent focus:outline-none"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                    />
                </div>
                <button type="submit" className="w-full p-3 bg-accent rounded font-bold hover:bg-opacity-80 transition shadow-lg text-white">
                    Sign In
                </button>
            </form>
        </div>
    );
};

const Modal = ({ isOpen, title, message, type, onConfirm, onCancel }) => {
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

const PostModal = ({ isOpen, post, onSave, onCancel, onAutoSummarize, isSummarizing, setPost }) => {
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
                            <button 
                                type="button"
                                onClick={onAutoSummarize}
                                className="text-xs flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                                disabled={isSummarizing || !post.content}
                            >
                                <Sparkles size={14} /> {isSummarizing ? 'Summarizing...' : 'Auto-Summarize'}
                            </button>
                        </div>
                        <textarea 
                            id="post-summary"
                            placeholder="Summary (short description)" 
                            className="w-full p-3 bg-bg border border-accent rounded h-20 text-text placeholder-text placeholder-opacity-50 focus:ring-1 focus:ring-accent outline-none"
                            value={post.summary} onChange={e => setPost({...post, summary: e.target.value})}
                            autoComplete="off"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase text-accent mb-2">Content</label>
                        <MdEditor
                            modelValue={post.content}
                            onChange={(val) => setPost({...post, content: val})}
                            theme={document.documentElement.style.getPropertyValue('--bg').trim() === '#ffffff' ? 'light' : 'dark'}
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

const Admin = ({ user, siteName, setSiteName, showAlert, showConfirm }) => {
    const [activeTab, setActiveTab] = useState('posts');
    const [users, setUsers] = useState([]);
    const [posts, setPosts] = useState([]);
    const [themes, setThemes] = useState([]);
    const [images, setImages] = useState([]);
    const [config, setConfig] = useState({
        siteName: siteName,
        currentTheme: 'default',
        pagination: 10,
        sortBy: 'date',
        sortOrder: 'desc',
        searchPlacement: 'top',
        aiConfig: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            apiKey: '',
            modelId: 'llama3'
        }
    });
    const [editingPost, setEditingPost] = useState(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [newThemeName, setNewThemeName] = useState('');
    const [themeColors, setThemeColors] = useState({
        "--primary": "#3b82f6",
        "--secondary": "#1f2937",
        "--accent": "#ef4444",
        "--text": "#f3f4f6",
        "--bg": "#111827"
    });

    useEffect(() => {
        api.get('/theme').then(res => {
            setThemeColors(res.data);
        });
    }, []);

    useEffect(() => {
        if (user && user.role === 'admin') {
            fetchUsers();
            fetchThemes();
            fetchConfig();
        }
        fetchPosts();
        fetchImages();
    }, [user]);

    const fetchUsers = () => api.get('/admin/users').then(res => { setUsers(res.data); return res; });
    const fetchPosts = () => api.get('/posts').then(res => { setPosts(res.data); return res; });
    const fetchThemes = () => api.get('/admin/themes').then(res => { setThemes(res.data); return res; });
    const fetchImages = () => api.get('/admin/images').then(res => { setImages(res.data); return res; });
    const fetchConfig = () => api.get('/config').then(res => { setConfig(res.data); return res; });

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
        if (activeTab === 'ai' && config.aiConfig?.provider === 'ollama' && availableModels.length === 0 && config.aiConfig?.baseUrl) {
            fetchAIModels();
        }
    }, [activeTab]);

    const handleSaveConfig = () => {
        api.post('/admin/config', config).then(() => {
            setSiteName(config.siteName);
            fetchConfig();
            showAlert('Settings saved successfully!', 'Success');
        });
    };

    const handleSaveAIConfig = () => {
        api.post('/admin/config', config).then(() => {
            fetchConfig().then(() => {
                showAlert('AI settings saved successfully!', 'Success');
            });
        });
    };

    const handleSaveTheme = () => {
        if (!newThemeName) return showAlert('Theme name is required', 'Error');
        api.post(`/admin/themes/${newThemeName}`, themeColors).then(() => {
            fetchThemes();
            showAlert('Theme saved successfully!', 'Success');
        });
    };

    const handleDeleteUser = (username) => {
        showConfirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`, () => {
            api.delete(`/admin/users/${username}`).then(fetchUsers);
        }, 'Delete User');
    };

    const handleDeletePost = (slug) => {
        showConfirm(`Are you sure you want to delete post "${slug}"? This action cannot be undone.`, () => {
            api.delete(`/posts/${slug}`).then(fetchPosts);
        }, 'Delete Post');
    };

    const handleSavePost = (e) => {
        e.preventDefault();
        api.post('/posts', editingPost).then(() => {
            setEditingPost(null);
            fetchPosts();
            fetchImages();
        });
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('image', file);
        api.post('/admin/upload', formData).then(() => {
            fetchImages();
        });
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
            setEditingPost({ ...editingPost, summary: res.data.summary });
        } catch (error) {
            console.error('Summarization error:', error);
            const errorMsg = error.response?.data?.message || 'Failed to generate summary. Please check your AI configuration on the backend.';
            showAlert(errorMsg, 'Error');
        } finally {
            setIsSummarizing(false);
        }
    };

    if (!user || (user.role !== 'admin' && user.role !== 'contributor')) return <div className="p-8 text-center text-red-500">Access Denied</div>;

    const TabButton = ({ id, icon: Icon, label }) => (
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
                        <TabButton id="users" icon={Users} label="Users" />
                    </>
                )}
                <TabButton id="images" icon={ImageIcon} label="Images" />
            </div>

            <div className="bg-secondary p-8 rounded-xl shadow-2xl border border-accent border-opacity-30 min-h-[500px]">
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
                                        }} className="p-2 hover:bg-accent rounded transition text-accent hover:text-white">
                                            <Edit size={18} />
                                        </button>
                                        {user.role === 'admin' && (
                                            <button onClick={() => handleDeletePost(post.slug)} className="p-2 hover:bg-red-500 rounded transition text-red-500 hover:text-white">
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
                    onCancel={() => setEditingPost(null)}
                    onAutoSummarize={handleAutoSummarize}
                    isSummarizing={isSummarizing}
                    setPost={setEditingPost}
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
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-2xl font-bold mb-4">Theme Editor</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold uppercase text-accent mb-2">Color Variables</h3>
                                    {Object.entries(themeColors).map(([key, value]) => (
                                        <div key={key} className="flex items-center justify-between gap-4">
                                            <label className="text-sm font-medium">{key}</label>
                                            <div className="flex gap-2 items-center">
                                                <input 
                                                    type="text" 
                                                    className="w-24 p-1 text-xs bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                                    value={value} 
                                                    onChange={e => setThemeColors({...themeColors, [key]: e.target.value})}
                                                />
                                                <input 
                                                    type="color" 
                                                    value={value} 
                                                    onChange={e => setThemeColors({...themeColors, [key]: e.target.value})}
                                                    className="w-10 h-10 border-0 bg-transparent cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label htmlFor="theme-name" className="block text-xs font-bold uppercase text-accent">New Theme Name</label>
                                        <input 
                                            id="theme-name"
                                            type="text" placeholder="Theme Name" 
                                            className="w-full p-3 bg-bg border border-accent rounded text-text placeholder-text placeholder-opacity-50"
                                            value={newThemeName} onChange={e => setNewThemeName(e.target.value)}
                                            autoComplete="off"
                                        />
                                    </div>
                                    <button onClick={handleSaveTheme} className="w-full bg-accent p-3 rounded font-bold text-white shadow-md hover:bg-opacity-90 transition">Save New Theme</button>
                                    <button onClick={handleSaveConfig} className="w-full border border-accent p-3 rounded font-bold hover:bg-accent hover:bg-opacity-10 transition">Apply Current Selection</button>
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
                                                ...(config.aiConfig || { baseUrl: '', apiKey: '', modelId: '' }), 
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
                                        setConfig(prev => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', apiKey: '', modelId: '' }), baseUrl: newVal}}));
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
                                                setConfig(prev => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', baseUrl: '', apiKey: '' }), modelId: newVal}}));
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
                                                setConfig(prev => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'openai', baseUrl: '', apiKey: '' }), modelId: newVal}}));
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
                                        setConfig(prev => ({...prev, aiConfig: {...(prev.aiConfig || { provider: 'ollama', baseUrl: '', modelId: '' }), apiKey: newVal}}));
                                    }}
                                    autoComplete="new-password"
                                />
                            </div>
                            <button type="submit" className="bg-accent p-3 px-6 rounded font-bold w-full mt-4">Save AI Configuration</button>
                        </form>
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
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold">Image Manager</h2>
                            <label className="bg-accent p-2 px-4 rounded font-bold flex items-center gap-2 hover:bg-opacity-80 transition cursor-pointer">
                                <Upload size={18} /> Upload Image
                                <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*" />
                            </label>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {images.map(img => (
                                <div key={img} className="group relative bg-bg rounded overflow-hidden border border-accent border-opacity-20 aspect-square">
                                    <img src={`/api/images/${img}`} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center p-2 text-center gap-2">
                                        <p className="text-[10px] text-white truncate w-full">{img}</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => {
                                                    navigator.clipboard.writeText(`![${img}](/api/images/${img})`);
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
                                                        const imgLink = `\n![${img}](/api/images/${img})\n`;
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
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {images.length === 0 && <p className="text-center text-gray-500 mt-8">No images uploaded yet.</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function App() {
    const [user, setUser] = useState(null);
    const [siteName, setSiteName] = useState('Generic Blog');

    useEffect(() => {
        const localTheme = localStorage.getItem('theme');
        if (localTheme) {
            applyTheme(localTheme);
        } else {
            applyTheme();
        }
        api.get('/config').then(res => {
            if (res.data.siteName) {
                setSiteName(res.data.siteName);
                document.title = res.data.siteName;
            }
        });
        const token = localStorage.getItem('token');
        const role = localStorage.getItem('role');
        const username = localStorage.getItem('username');
        if (token) {
            setUser({ role, username, theme: localTheme }); 
        }
    }, []);

    const [modal, setModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert',
        onConfirm: () => {}
    });

    const showAlert = (message, title = '') => {
        setModal({
            isOpen: true,
            title,
            message,
            type: 'alert',
            onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
        });
    };

    const showConfirm = (message, onConfirm, title = '') => {
        setModal({
            isOpen: true,
            title,
            message,
            type: 'confirm',
            onConfirm: () => {
                onConfirm();
                setModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    return (
        <Router>
            <div className="min-h-screen bg-bg text-text">
                <Navbar user={user} setUser={setUser} siteName={siteName} />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                    <Route path="/login" element={<Login setUser={setUser} />} />
                    <Route path="/admin" element={<Admin user={user} siteName={siteName} setSiteName={setSiteName} showAlert={showAlert} showConfirm={showConfirm} />} />
                </Routes>
                <footer className="p-8 text-center opacity-50 text-sm mt-12 border-t border-secondary">
                    © 2026 {siteName}. All rights reserved. Built with Vite + React.
                </footer>
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
