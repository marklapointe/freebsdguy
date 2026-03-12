import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import { Search, LogIn, LogOut, Settings, Trash2, Edit, Plus, Upload, Palette, Layout, Users, FileText, Image as ImageIcon } from 'lucide-react';

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

// Theme context/hook could be better, but let's just fetch and apply
const applyTheme = async () => {
    try {
        const response = await api.get('/theme');
        const theme = response.data;
        const root = document.documentElement;
        Object.keys(theme).forEach(key => {
            root.style.setProperty(key, theme[key]);
        });
    } catch (error) {
        console.error('Failed to load theme', error);
    }
};

const Navbar = ({ user, setUser, siteName }) => {
    const navigate = useNavigate();
    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        setUser(null);
        navigate('/');
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
                {user ? (
                    <>
                        <span className="hidden sm:inline text-gray-300">Hello, {user.username}</span>
                        {(user.role === 'admin' || user.role === 'contributor') && (
                            <Link to="/admin" className="p-2 hover:bg-accent rounded transition" title="Settings">
                                <Settings size={20} />
                            </Link>
                        )}
                        <button onClick={handleLogout} className="p-2 hover:bg-accent rounded transition" title="Logout">
                            <LogOut size={20} />
                        </button>
                    </>
                ) : (
                    <Link to="/login" className="p-2 hover:bg-accent rounded transition" title="Login">
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
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input 
                    type="text" 
                    placeholder="Search posts..." 
                    className="w-full p-3 pl-10 rounded-lg bg-secondary border border-accent text-text focus:outline-none focus:ring-2 focus:ring-accent"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
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
                        <p className="text-gray-300 text-sm mb-4">{new Date(post.date).toLocaleDateString()}</p>
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
                <h1 className="text-4xl font-extrabold mb-4 border-b border-accent pb-4">{post.title}</h1>
                <div className="flex gap-4 text-sm text-gray-400 mb-8">
                    <span>{new Date(post.date).toLocaleDateString()}</span>
                    {post.author && <span>by {post.author}</span>}
                </div>
                <div className="prose prose-invert max-w-none prose-headings:text-primary prose-a:text-accent">
                    <ReactMarkdown>{post.content}</ReactMarkdown>
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
            localStorage.setItem('username', username);
            setUser({ username, role: res.data.role });
            navigate('/');
        } catch (err) {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="flex justify-center items-center min-h-[80vh]">
            <form onSubmit={handleSubmit} className="p-8 bg-secondary rounded-lg shadow-xl w-full max-w-md border border-accent">
                <h2 className="text-3xl font-bold mb-6 text-center">Login</h2>
                {error && <p className="text-red-500 mb-4 text-center">{error}</p>}
                <div className="mb-4">
                    <label className="block mb-2 text-sm font-medium">Username</label>
                    <input 
                        type="text" 
                        className="w-full p-3 rounded bg-bg text-text border border-accent focus:outline-none"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                    />
                </div>
                <div className="mb-6">
                    <label className="block mb-2 text-sm font-medium">Password</label>
                    <input 
                        type="password" 
                        className="w-full p-3 rounded bg-bg text-text border border-accent focus:outline-none"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="w-full p-3 bg-accent rounded font-bold hover:bg-opacity-80 transition shadow-lg">
                    Sign In
                </button>
            </form>
        </div>
    );
};

const Admin = ({ user, siteName, setSiteName }) => {
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
        searchPlacement: 'top'
    });
    const [editingPost, setEditingPost] = useState(null);
    const [newThemeName, setNewThemeName] = useState('');
    const [themeColors, setThemeColors] = useState({
        "--primary": "#1a202c",
        "--secondary": "#2d3748",
        "--accent": "#4a5568",
        "--text": "#ffffff",
        "--bg": "#f7fafc"
    });

    useEffect(() => {
        if (user && user.role === 'admin') {
            fetchUsers();
            fetchThemes();
            fetchConfig();
        }
        fetchPosts();
        fetchImages();
    }, [user]);

    const fetchUsers = () => api.get('/admin/users').then(res => setUsers(res.data));
    const fetchPosts = () => api.get('/posts').then(res => setPosts(res.data));
    const fetchThemes = () => api.get('/admin/themes').then(res => setThemes(res.data));
    const fetchImages = () => api.get('/admin/images').then(res => setImages(res.data));
    const fetchConfig = () => api.get('/config').then(res => setConfig(res.data));

    const handleSaveConfig = () => {
        api.post('/admin/config', config).then(() => {
            setSiteName(config.siteName);
            alert('Settings saved');
        });
    };

    const handleSaveTheme = () => {
        if (!newThemeName) return alert('Theme name required');
        api.post(`/admin/themes/${newThemeName}`, themeColors).then(() => {
            fetchThemes();
            alert('Theme saved');
        });
    };

    const handleDeleteUser = (username) => {
        if (confirm(`Delete user ${username}?`)) {
            api.delete(`/admin/users/${username}`).then(fetchUsers);
        }
    };

    const handleDeletePost = (slug) => {
        if (confirm(`Delete post ${slug}?`)) {
            api.delete(`/posts/${slug}`).then(fetchPosts);
        }
    };

    const handleSavePost = (e) => {
        e.preventDefault();
        api.post('/posts', editingPost).then(() => {
            setEditingPost(null);
            fetchPosts();
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

    if (!user || (user.role !== 'admin' && user.role !== 'contributor')) return <div className="p-8 text-center text-red-500">Access Denied</div>;

    const TabButton = ({ id, icon: Icon, label }) => (
        <button 
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 p-3 rounded-lg transition ${activeTab === id ? 'bg-accent text-white' : 'hover:bg-accent hover:bg-opacity-20'}`}
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
                        
                        {editingPost ? (
                            <form onSubmit={handleSavePost} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input 
                                        type="text" placeholder="Slug (URL-friendly)" 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={editingPost.slug} onChange={e => setEditingPost({...editingPost, slug: e.target.value})}
                                        required 
                                    />
                                    <input 
                                        type="text" placeholder="Title" 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={editingPost.title} onChange={e => setEditingPost({...editingPost, title: e.target.value})}
                                        required 
                                    />
                                </div>
                                <textarea 
                                    placeholder="Summary (short description)" 
                                    className="w-full p-3 bg-bg border border-accent rounded h-20"
                                    value={editingPost.summary} onChange={e => setEditingPost({...editingPost, summary: e.target.value})}
                                />
                                <textarea 
                                    placeholder="Content (Markdown supported)" 
                                    className="w-full p-3 bg-bg border border-accent rounded h-64 font-mono text-sm"
                                    value={editingPost.content} onChange={e => setEditingPost({...editingPost, content: e.target.value})}
                                    required 
                                />
                                <div className="flex gap-4">
                                    <button type="submit" className="bg-accent p-3 px-6 rounded font-bold">Save Post</button>
                                    <button type="button" onClick={() => setEditingPost(null)} className="p-3 px-6 border border-accent rounded font-bold">Cancel</button>
                                </div>
                            </form>
                        ) : (
                            <div className="space-y-4">
                                {posts.map(post => (
                                    <div key={post.slug} className="flex justify-between items-center p-4 bg-bg rounded border border-accent border-opacity-20">
                                        <div>
                                            <h3 className="font-bold">{post.title}</h3>
                                            <p className="text-xs text-gray-400">{post.slug} • {post.date}</p>
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
                        )}
                    </div>
                )}

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
                                    {Object.entries(themeColors).map(([key, value]) => (
                                        <div key={key} className="flex items-center justify-between gap-4">
                                            <label className="text-sm font-medium">{key.replace('--', '')}</label>
                                            <div className="flex gap-2 items-center">
                                                <input 
                                                    type="text" 
                                                    className="w-24 p-1 text-xs bg-bg border border-accent rounded"
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
                                    <input 
                                        type="text" placeholder="Theme Name" 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={newThemeName} onChange={e => setNewThemeName(e.target.value)}
                                    />
                                    <button onClick={handleSaveTheme} className="w-full bg-accent p-3 rounded font-bold">Save New Theme</button>
                                    <button onClick={handleSaveConfig} className="w-full border border-accent p-3 rounded font-bold">Apply Current Selection</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'layout' && (
                    <div className="space-y-8 max-w-2xl mx-auto">
                        <h2 className="text-2xl font-bold mb-6">Site Layout & Post List</h2>
                        <div className="space-y-6">
                            <div>
                                <label className="block mb-2 font-medium">Site Name</label>
                                <input 
                                    type="text" className="w-full p-3 bg-bg border border-accent rounded"
                                    value={config.siteName} onChange={e => setConfig({...config, siteName: e.target.value})}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block mb-2 font-medium">Posts Per Page</label>
                                    <input 
                                        type="number" className="w-full p-3 bg-bg border border-accent rounded"
                                        value={config.pagination} onChange={e => setConfig({...config, pagination: Number(e.target.value)})}
                                    />
                                </div>
                                <div>
                                    <label className="block mb-2 font-medium">Search Placement</label>
                                    <select 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={config.searchPlacement} onChange={e => setConfig({...config, searchPlacement: e.target.value})}
                                    >
                                        <option value="top">Top</option>
                                        <option value="bottom">Bottom</option>
                                        <option value="left">Left</option>
                                        <option value="right">Right</option>
                                        <option value="none">None</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block mb-2 font-medium">Sort By</label>
                                    <select 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={config.sortBy} onChange={e => setConfig({...config, sortBy: e.target.value})}
                                    >
                                        <option value="date">Date</option>
                                        <option value="title">Title</option>
                                        <option value="author">Author</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block mb-2 font-medium">Sort Order</label>
                                    <select 
                                        className="w-full p-3 bg-bg border border-accent rounded"
                                        value={config.sortOrder} onChange={e => setConfig({...config, sortOrder: e.target.value})}
                                    >
                                        <option value="desc">Descending</option>
                                        <option value="asc">Ascending</option>
                                    </select>
                                </div>
                            </div>
                            <button onClick={handleSaveConfig} className="w-full bg-accent p-3 rounded font-bold mt-4 shadow-lg hover:shadow-xl transition">
                                Save All Settings
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
                                <div className="md:col-span-1">
                                    <label className="block mb-2 text-xs font-bold uppercase">Username</label>
                                    <input name="username" type="text" className="w-full p-2 bg-bg border border-accent rounded" required />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="block mb-2 text-xs font-bold uppercase">Password</label>
                                    <input name="password" type="password" className="w-full p-2 bg-bg border border-accent rounded" required />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="block mb-2 text-xs font-bold uppercase">Role</label>
                                    <select name="role" className="w-full p-2 bg-bg border border-accent rounded">
                                        <option value="contributor">Contributor</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                                <button type="submit" className="bg-accent p-2 rounded font-bold">Add User</button>
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
                                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center p-2 text-center">
                                        <p className="text-[10px] text-white truncate w-full mb-2">{img}</p>
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(`![${img}](/api/images/${img})`);
                                                alert('Markdown link copied!');
                                            }}
                                            className="bg-accent text-white p-1 px-2 rounded text-[10px] font-bold"
                                        >
                                            Copy MD
                                        </button>
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
        applyTheme();
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
            setUser({ role, username }); 
        }
    }, []);

    return (
        <Router>
            <div className="min-h-screen bg-bg text-text">
                <Navbar user={user} setUser={setUser} siteName={siteName} />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/post/:slug" element={<PostDetail />} />
                    <Route path="/login" element={<Login setUser={setUser} />} />
                    <Route path="/admin" element={<Admin user={user} siteName={siteName} setSiteName={setSiteName} />} />
                </Routes>
                <footer className="p-8 text-center text-gray-500 text-sm mt-12 border-t border-secondary">
                    © 2026 {siteName}. All rights reserved. Built with Vite + React.
                </footer>
            </div>
        </Router>
    );
}
