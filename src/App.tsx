import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { api, applyTheme } from './lib/api';
import { Navbar } from './components/Navbar';
import { Home } from './components/Home';
import { PostDetail } from './components/PostDetail';
import { Login } from './components/Login';
import { Modal, Notification } from './components/Modal';
import { PostModal } from './components/PostModal';
import { ImagePickerModal, ImagePreviewModal } from './components/ImageModals';
import { User, AlertType, Post, ImageInfo } from './types';
import {
    Eye, Trash2, Edit, Plus, Upload, Palette,
    Users, FileText, Image as ImageIcon, Cpu,
    Server, Pin, CheckSquare, Square, RefreshCw
} from 'lucide-react';

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
    const [users, setUsers] = useState<any[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [images, setImages] = useState<ImageInfo[]>([]);
    const imagePage = 1;
    const imagesPerPage: string = '30';
    const [showLogoPicker, setShowLogoPicker] = useState(false);
    const [pickerImages, setPickerImages] = useState<ImageInfo[]>([]);
    const [previewImage, setPreviewImage] = useState<ImageInfo | null>(null);
    const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [config, setConfig] = useState<any>({
        siteName: siteName,
        siteLogo: siteLogo || 'logo.webp',
        currentTheme: 'dark',
        pagination: 10,
        sortBy: 'date',
        sortOrder: 'desc',
        searchPlacement: 'top',
        aiConfig: { provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', modelId: 'llama3', enabled: true },
        service: { port: 3001 }
    });
    const [editingPost, setEditingPost] = useState<any>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);
    const [modelsList, setModelsList] = useState<string[]>([]);
    const [themeColors, setThemeColors] = useState<Record<string, string> | null>(null);

    const themeLabelMap: Record<string, string> = {
        '--primary': 'Primary', '--secondary': 'Secondary', '--accent': 'Accent',
        '--text': 'Text', '--bg': 'Background', '--border': 'Border',
        '--hover': 'Hover', '--site-name-color': 'Site Name Text'
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
            api.get('/theme?name=' + config.currentTheme).then(res => setThemeColors(res.data));
        }
    }, [activeTab, config.currentTheme]);

    useEffect(() => {
        const handleThemeChanged = (e: CustomEvent) => {
            const newTheme = e.detail;
            if (newTheme && typeof newTheme === 'string') {
                setConfig((prev: any) => ({ ...prev, currentTheme: newTheme }));
                api.get('/theme?name=' + newTheme).then(res => setThemeColors(res.data));
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

    useEffect(() => {
        if (user && user.role === 'admin') {
            fetchUsers().catch(err => console.error('Failed to fetch users:', err));
            fetchThemes().catch(err => console.error('Failed to fetch themes:', err));
            fetchConfig().catch(err => console.error('Failed to fetch config:', err));
            fetchConfigStatus().catch(err => console.error('Failed to fetch config status:', err));
        }
        fetchPosts().catch(err => console.error('Failed to fetch posts:', err));
        fetchImages().catch(err => console.error('Failed to fetch images:', err));
    }, [user]);

    useEffect(() => {
        if (showLogoPicker) {
            api.get('/admin/images?limit=all').then(res => setPickerImages(res.data.images));
        }
    }, [showLogoPicker]);

    const fetchUsers = () => api.get('/admin/users').then(res => { setUsers(res.data); return res; });
    const fetchPosts = () => api.get('/posts').then(res => { setPosts(res.data); return res; });
    const fetchThemes = () => api.get('/admin/themes').then(res => { return res; });
    const fetchImages = () => {
        const limit = imagesPerPage;
        const offset = (imagePage - 1) * (limit === 'all' ? 0 : parseInt(limit));
        return api.get(`/admin/images?limit=${limit}&offset=${offset}`).then(res => {
            setImages(res.data.images);
            return res;
        });
    };
    const fetchConfig = () => api.get('/config').then(res => {
        const data = res.data;
        const defaultAiConfig = { enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', modelId: 'llama3' };
        const defaultSecurity = { apiRateLimitWindow: 15 * 60 * 1000, apiRateLimitMax: 100, loginRateLimitWindow: 15 * 60 * 1000, loginRateLimitMax: 10, disableAI: false, disableImages: false, disablePublicSearch: false };
        data.aiConfig = { ...defaultAiConfig, ...data.aiConfig };
        data.security = { ...defaultSecurity, ...data.security };
        setConfig(data);
        if (data.service?.port) localStorage.setItem('lastPort', data.service.port.toString());
        return res;
    });
    const fetchConfigStatus = () => api.get('/admin/config-status').then(res => { return res; });

    const fetchAIModels = (p?: string, b?: string, k?: string) => {
        const provider = p || config.aiConfig?.provider || 'ollama';
        const baseUrl = b || config.aiConfig?.baseUrl || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1');
        const apiKey = k !== undefined ? k : (config.aiConfig?.apiKey || '');
        if (provider !== 'ollama' || !baseUrl) {
            setModelsList([]);
            return;
        }
        api.get(`/ai/models?provider=${provider}&baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`)
            .then(res => {
                setModelsList(res.data || []);
            })
            .catch(_err => {
                setModelsList([]);
                showAlert('Could not connect to Ollama to fetch models. Please check your Base URL.', 'Connection Error');
            });
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
            fetchConfig().then(() => showAlert('AI settings saved successfully!', 'Success'));
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
            api.delete(`/admin/images/${filename}`).then(() => {
                fetchImages();
                if (showLogoPicker) api.get('/admin/images?limit=all').then(res => setPickerImages(res.data.images));
                if (config.siteLogo === filename) setConfig((prev: any) => ({...prev, siteLogo: ''}));
                if (selectedImages.has(filename)) {
                    const newSelection = new Set(selectedImages);
                    newSelection.delete(filename);
                    setSelectedImages(newSelection);
                }
            });
        }, 'Delete Image');
    };

    const toggleImageSelection = (filename: string) => {
        const newSelection = new Set(selectedImages);
        if (newSelection.has(filename)) newSelection.delete(filename);
        else newSelection.add(filename);
        setSelectedImages(newSelection);
    };

    const handleBulkDelete = () => {
        if (selectedImages.size === 0) return;
        showConfirm(`Are you sure you want to delete ${selectedImages.size} images? This action cannot be undone.`, () => {
            api.post('/admin/images/delete-bulk', { filenames: Array.from(selectedImages) }).then(res => {
                showAlert(res.data.message, 'Success');
                const deletedFilenames = Array.from(selectedImages);
                setSelectedImages(new Set());
                setIsSelectionMode(false);
                fetchImages();
                if (showLogoPicker) api.get('/admin/images?limit=all').then(res => setPickerImages(res.data.images));
                if (deletedFilenames.includes(config.siteLogo || '')) setConfig((prev: any) => ({...prev, siteLogo: ''}));
            });
        }, 'Bulk Delete');
    };

    const handleSavePost = (e: React.FormEvent) => {
        e.preventDefault();
        const postData = {
            slug: editingPost.slug,
            title: editingPost.title,
            content: editingPost.content,
            summary: editingPost.summary,
            date: editingPost.date || new Date().toISOString(),
            pinned: editingPost.pinned
        };
        api.post('/posts', postData).then(() => {
            fetchPosts();
            setEditingPost(null);
            setEnhancedPreview(null);
            showAlert('Post saved successfully!', 'Success');
        });
    };

    const handleAutoSummarize = () => {
        if (!config.aiConfig?.enabled || !editingPost.content) return;
        setIsSummarizing(true);
        api.post('/ai/summarize', {
            content: editingPost.content,
            provider: config.aiConfig.provider,
            baseUrl: config.aiConfig.baseUrl,
            modelId: config.aiConfig.modelId,
            apiKey: config.aiConfig.apiKey
        }).then(res => {
            setEditingPost((prev: any) => ({ ...prev, summary: res.data.summary }));
        }).catch(err => showAlert('Failed to generate summary: ' + err.message, 'Error')).finally(() => setIsSummarizing(false));
    };

    const handleAutoEnhance = () => {
        if (!config.aiConfig?.enabled || !editingPost.content) return;
        setIsEnhancing(true);
        api.post('/ai/enhance', {
            content: editingPost.content,
            provider: config.aiConfig.provider,
            baseUrl: config.aiConfig.baseUrl,
            modelId: config.aiConfig.modelId,
            apiKey: config.aiConfig.apiKey
        }).then(res => setEnhancedPreview(res.data.enhanced)).catch(err => showAlert('Failed to enhance content: ' + err.message, 'Error')).finally(() => setIsEnhancing(false));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const formData = new FormData();
        formData.append('image', file);
        api.post('/admin/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(_res => {
            showAlert('Image uploaded successfully!', 'Success');
            fetchImages();
            if (showLogoPicker) api.get('/admin/images?limit=all').then(res => setPickerImages(res.data.images));
        }).catch(err => showAlert('Failed to upload image: ' + err.message, 'Error'));
        e.target.value = '';
    };

    const handleNewPost = () => {
        setEditingPost({ slug: '', title: '', content: '', summary: '', date: '', pinned: false });
        setEnhancedPreview(null);
    };

    const handleEditPost = (post: Post) => {
        setEditingPost({ ...post });
        setEnhancedPreview(null);
    };

    const handleLogoSelect = (filename: string) => {
        setConfig((prev: any) => ({ ...prev, siteLogo: filename }));
        setSiteLogo(filename);
        setShowLogoPicker(false);
        showAlert('Logo updated successfully!', 'Success');
    };

    if (!user) return <div className="p-8 text-center">Loading...</div>;

    return (
        <div className="min-h-screen bg-bg text-text">
            <div className="flex">
                <div className="w-64 min-h-screen bg-secondary border-r border-accent border-opacity-20 p-4 flex flex-col">
                    <div className="mb-6">
                        <h2 className="text-xs font-black uppercase tracking-wider opacity-50 mb-3">Content</h2>
                        <nav className="space-y-1">
                            <button onClick={() => setActiveTab('posts')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'posts' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><FileText size={18} /> Posts</button>
                            <button onClick={() => setActiveTab('images')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'images' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><ImageIcon size={18} /> Images</button>
                            <button onClick={handleNewPost} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition hover:bg-bg text-accent"><Plus size={18} /> New Post</button>
                        </nav>
                    </div>
                    {user.role === 'admin' && (
                        <div className="mb-6">
                            <h2 className="text-xs font-black uppercase tracking-wider opacity-50 mb-3">Admin</h2>
                            <nav className="space-y-1">
                                <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'settings' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><Server size={18} /> Settings</button>
                                <button onClick={() => setActiveTab('appearance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'appearance' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><Palette size={18} /> Appearance</button>
                                <button onClick={() => setActiveTab('users')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'users' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><Users size={18} /> Users</button>
                                <button onClick={() => setActiveTab('ai')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'ai' ? 'bg-accent text-white' : 'hover:bg-bg'}`}><Cpu size={18} /> AI Settings</button>
                            </nav>
                        </div>
                    )}
                </div>
                <div className="flex-1 p-8">
                    {activeTab === 'posts' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Posts</h1>
                            <div className="grid gap-4">
                                {posts.map(post => (
                                    <div key={post.slug} className="p-4 bg-secondary rounded-lg border border-accent border-opacity-20 flex justify-between items-center">
                                        <div>
                                            <h3 className="font-bold flex items-center gap-2">{post.pinned && <Pin size={14} className="text-accent" />}{post.title}</h3>
                                            <p className="text-sm opacity-50">{new Date(post.date).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleEditPost(post)} className="p-2 hover:bg-accent rounded transition"><Edit size={18} /></button>
                                            <button onClick={() => handleDeletePost(post.slug)} className="p-2 hover:bg-red-500 rounded transition"><Trash2 size={18} /></button>
                                        </div>
                                    </div>
                                ))}
                                {posts.length === 0 && <p className="text-center opacity-50 py-12">No posts yet. Create your first post!</p>}
                            </div>
                        </div>
                    )}
                    {activeTab === 'images' && (
                        <div className="max-w-3xl">
                            <div className="flex justify-between items-center mb-6">
                                <h1 className="text-3xl font-bold">Images</h1>
                                <div className="flex gap-2">
                                    {isSelectionMode && <button onClick={handleBulkDelete} className="bg-red-500 text-white px-4 py-2 rounded font-bold disabled:opacity-50" disabled={selectedImages.size === 0}>Delete ({selectedImages.size})</button>}
                                    <button onClick={() => setIsSelectionMode(!isSelectionMode)} className="bg-secondary px-4 py-2 rounded font-bold">{isSelectionMode ? 'Cancel' : 'Select'}</button>
                                    <label className="bg-accent text-white px-4 py-2 rounded font-bold cursor-pointer flex items-center gap-2"><Upload size={18} /> Upload<input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} /></label>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                {images.map(img => (
                                    <div key={img.filename} className={`bg-secondary rounded-lg border border-accent border-opacity-20 p-2 relative group ${isSelectionMode ? 'cursor-pointer' : ''}`}>
                                        {isSelectionMode && (
                                            <button onClick={() => toggleImageSelection(img.filename)} className="absolute top-2 left-2 z-10">
                                                {selectedImages.has(img.filename) ? <CheckSquare size={20} className="text-accent" /> : <Square size={20} />}
                                            </button>
                                        )}
                                        <img src={`/api/getimage?fileName=${img.filename}`} alt={img.originalName} className="w-full h-32 object-contain rounded" onError={(e: any) => { e.target.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%3E%3C/svg%3E'; e.target.className += ' opacity-30'; }} />
                                        <p className="text-xs truncate mt-2">{img.originalName}</p>
                                        {!isSelectionMode && (
                                            <div className="absolute inset-0 z-10 opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto pointer-events-none transition-all flex items-center justify-center gap-2 rounded">
                                                <button onClick={() => setPreviewImage(img)} className="p-2 bg-accent text-white rounded-full z-20"><Eye size={18} /></button>
                                                <button onClick={() => handleDeleteImage(img.filename)} className="p-2 bg-red-500 text-white rounded-full z-20"><Trash2 size={18} /></button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {images.length === 0 && <p className="text-center opacity-50 py-12">No images yet. Upload your first image!</p>}
                        </div>
                    )}
                    {activeTab === 'settings' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Settings</h1>
                            <div className="bg-secondary rounded-lg p-6 space-y-6">
                                <div>
                                    <label className="block text-sm font-bold mb-2">Site Name</label>
                                    <input type="text" value={config.siteName || ''} onChange={e => setConfig((prev: any) => ({ ...prev, siteName: e.target.value }))} className="w-full p-3 bg-bg border border-accent rounded text-text" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Site Logo</label>
                                    <div className="flex items-center gap-4">
                                        {config.siteLogo && <img src={`/api/getimage?fileName=${config.siteLogo}`} alt="Logo" className="h-12 w-auto" />}
                                        <button onClick={() => setShowLogoPicker(true)} className="bg-accent text-white px-4 py-2 rounded font-bold">Choose Image</button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Service Port</label>
                                    <input type="number" value={config.service?.port || 3001} onChange={e => setConfig((prev: any) => ({ ...prev, service: { ...prev.service, port: parseInt(e.target.value) } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" />
                                </div>
                                <button onClick={handleSaveConfig} className="bg-accent text-white px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">Save Settings</button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'appearance' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Appearance</h1>
                            <div className="bg-secondary rounded-lg p-6 space-y-6">
                                <div>
                                    <label className="block text-sm font-bold mb-2">Theme</label>
                                    <select value={config.currentTheme} onChange={e => setConfig((prev: any) => ({ ...prev, currentTheme: e.target.value }))} className="w-full p-3 bg-bg border border-accent rounded text-text">
                                        <option value="light">Light</option>
                                        <option value="dark">Dark</option>
                                    </select>
                                </div>
                                {themeColors && (
                                    <div className="grid grid-cols-2 gap-4">
                                        {Object.entries(themeColors).map(([key, value]) => (
                                            <div key={key} className="flex items-center gap-4">
                                                <input type="color" value={value as string} onChange={e => setThemeColors((prev: any) => ({ ...prev, [key]: e.target.value }))} className="w-12 h-12 rounded cursor-pointer" />
                                                <div>
                                                    <p className="font-bold text-sm">{getThemeLabel(key)}</p>
                                                    <p className="text-xs opacity-50">{key}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button onClick={handleSaveTheme} className="bg-accent text-white px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">Save Theme</button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'users' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Users</h1>
                            <div className="bg-secondary rounded-lg p-6">
                                <table className="w-full">
                                    <thead><tr className="text-left border-b border-accent"><th className="pb-3">Username</th><th className="pb-3">Role</th><th className="pb-3">Actions</th></tr></thead>
                                    <tbody>
                                        {users.map(u => (
                                            <tr key={u.username} className="border-b border-accent border-opacity-20">
                                                <td className="py-3">{u.username} {u.username === user.username && '(You)'}</td>
                                                <td className="py-3"><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-accent' : 'bg-secondary'}`}>{u.role}</span></td>
                                                <td className="py-3">{u.username !== user.username && <button onClick={() => handleDeleteUser(u.username)} className="text-red-500 hover:underline">Delete</button>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {activeTab === 'ai' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">AI Settings</h1>
                            <div className="bg-secondary rounded-lg p-6 space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold">AI Features</h3>
                                        <p className="text-sm opacity-50">Enable AI-powered features like auto-summarize and enhance</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={config.aiConfig?.enabled || false} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, enabled: e.target.checked } }))} className="sr-only peer" />
                                        <div className="w-11 h-6 bg-bg rounded-full peer peer-checked:bg-accent transition"></div>
                                        <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition"></div>
                                    </label>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Provider</label>
                                    <select value={config.aiConfig?.provider || 'ollama'} onChange={e => { setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, provider: e.target.value } })); if (e.target.value === 'openai') setModelsList([]); }} className="w-full p-3 bg-bg border border-accent rounded text-text">
                                        <option value="ollama">Ollama (Local)</option>
                                        <option value="openai">OpenAI</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Base URL</label>
                                    <input type="text" value={config.aiConfig?.baseUrl || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, baseUrl: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" placeholder="http://localhost:11434" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">
                                        Model ID
                                        {config.aiConfig?.provider === 'ollama' && (
                                            <button onClick={() => fetchAIModels()} className="ml-2 p-1 hover:bg-accent hover:bg-opacity-20 rounded transition" title="Refresh models">
                                                <RefreshCw className="w-4 h-4 inline" />
                                            </button>
                                        )}
                                    </label>
                                    {config.aiConfig?.provider === 'ollama' ? (
                                        modelsList.length > 0 ? (
                                            <select value={config.aiConfig?.modelId || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, modelId: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text">
                                                <option value="">Select a model...</option>
                                                {modelsList.map(model => (
                                                    <option key={model} value={model}>{model}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="space-y-2">
                                                <input type="text" value={config.aiConfig?.modelId || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, modelId: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" placeholder="No models found - enter manually" />
                                            </div>
                                        )
                                    ) : (
                                        <input type="text" value={config.aiConfig?.modelId || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, modelId: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" placeholder="gpt-4, gpt-3.5-turbo, etc." />
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">API Key (for OpenAI)</label>
                                    <input type="password" value={config.aiConfig?.apiKey || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, apiKey: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" />
                                </div>
                                <button onClick={handleSaveAIConfig} className="bg-accent text-white px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">Save AI Settings</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <PostModal
                isOpen={!!editingPost}
                post={editingPost || {}}
                setPost={setEditingPost}
                onSave={handleSavePost}
                onCancel={() => { setEditingPost(null); setEnhancedPreview(null); }}
                onAutoSummarize={handleAutoSummarize}
                isSummarizing={isSummarizing}
                onAutoEnhance={handleAutoEnhance}
                isEnhancing={isEnhancing}
                enhancedPreview={enhancedPreview}
                onApplyEnhancement={() => { setEditingPost((prev: any) => ({ ...prev, content: enhancedPreview })); setEnhancedPreview(null); }}
                onDismissEnhancement={() => setEnhancedPreview(null)}
                aiEnabled={config.aiConfig?.enabled || false}
            />
            <ImagePickerModal isOpen={showLogoPicker} images={pickerImages} onSelect={handleLogoSelect} onClose={() => setShowLogoPicker(false)} onUpload={handleImageUpload} onPreview={(img) => setPreviewImage(img)} />
            <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
        </div>
    );
};

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
                    <Route path="/admin" element={<Admin user={user} siteName={siteName} setSiteName={setSiteName} siteLogo={siteLogo} setSiteLogo={setSiteLogo} showAlert={showAlert} showConfirm={showConfirm} />} />
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