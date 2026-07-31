import React, { useEffect, useState } from 'react';
import {
    api,
    applyTheme,
    fetchThemeCatalog,
    getEffectiveThemeMode,
    getMdEditorTheme,
    type ThemeMeta
} from '../../lib/api';
import { PostModal } from '../PostModal';
import { ImagePickerModal, ImagePreviewModal } from '../ImageModals';
import { User, Post, ImageInfo } from '../../types';
import {
    Eye, Trash2, Edit, Plus, Upload, Palette,
    Users, FileText, Image as ImageIcon, Cpu,
    Server, Pin, CheckSquare, Square, RefreshCw, Shield
} from 'lucide-react';

export type AdminProps = {
    user: User | null;
    siteName: string;
    setSiteName: (name: string) => void;
    siteLogo?: string;
    setSiteLogo: (logo?: string) => void;
    showAlert: (msg: string, title?: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, title?: string) => void;
};

export const Admin = ({ user, siteName, setSiteName, siteLogo, setSiteLogo, showAlert, showConfirm }: AdminProps) => {
    const [activeTab, setActiveTab] = useState('posts');
    const [users, setUsers] = useState<any[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [images, setImages] = useState<ImageInfo[]>([]);
    const [imagePage, setImagePage] = useState(1);
    const [imagesPerPage, setImagesPerPage] = useState<string>('30');
    const [imagesTotal, setImagesTotal] = useState(0);
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
        appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
        aiConfig: { provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', modelId: 'llama3', enabled: true },
        service: { port: 3001 }
    });
    const [editingPost, setEditingPost] = useState<any>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);
    const [modelsList, setModelsList] = useState<string[]>([]);
    const [themeColors, setThemeColors] = useState<Record<string, string> | null>(null);
    const [themeCatalog, setThemeCatalog] = useState<ThemeMeta[]>([]);
    const [themesLoading, setThemesLoading] = useState(false);
    const [themesError, setThemesError] = useState<string | null>(null);
    const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>(getMdEditorTheme());
    const [newUser, setNewUser] = useState({ username: '', password: '', role: 'contributor' });
    const [showAdvancedSession, setShowAdvancedSession] = useState(false);

    const themeLabelMap: Record<string, string> = {
        '--primary': 'Primary', '--secondary': 'Secondary', '--accent': 'Accent',
        '--text': 'Text', '--bg': 'Background', '--border': 'Border',
        '--hover': 'Hover', '--site-name-color': 'Site Name Text'
    };

    const getThemeLabel = (key: string) => themeLabelMap[key] || key.replace(/^--/, '').charAt(0).toUpperCase() + key.replace(/^--/, '').slice(1);

    const cssColorEntries = (colors: Record<string, string> | null) =>
        Object.entries(colors || {}).filter(([k, v]) => k.startsWith('--') && typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v));

    useEffect(() => {
        if (themeColors) {
            const root = document.documentElement;
            Object.entries(themeColors).forEach(([key, value]) => {
                if (key.startsWith('--') && typeof value === 'string') {
                    root.style.setProperty(key, value);
                }
            });
        }
    }, [themeColors]);

    useEffect(() => {
        if (activeTab === 'appearance' || !themeColors) {
            const mode = getEffectiveThemeMode(config.appearance?.themeMode);
            api.get(
                `/theme?name=${encodeURIComponent(config.currentTheme)}&mode=${mode}`
            ).then(res => setThemeColors(res.data));
        }
    }, [activeTab, config.currentTheme, config.appearance?.themeMode]);

    useEffect(() => {
        const handleThemeChanged = (e: CustomEvent) => {
            const newTheme = e.detail;
            if (newTheme && typeof newTheme === 'string') {
                setConfig((prev: any) => ({ ...prev, currentTheme: newTheme }));
                setEditorTheme(getMdEditorTheme());
                const mode = getEffectiveThemeMode(config.appearance?.themeMode);
                api.get(`/theme?name=${encodeURIComponent(newTheme)}&mode=${mode}`).then(res =>
                    setThemeColors(res.data)
                );
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, [config.appearance?.themeMode]);

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

    // Always re-load full catalog when opening Appearance (public /themes is the source of truth)
    useEffect(() => {
        if (activeTab === 'appearance' && user?.role === 'admin') {
            fetchThemes().catch(err => console.error('Failed to fetch themes:', err));
        }
    }, [activeTab, user]);

    useEffect(() => {
        if (showLogoPicker) {
            api.get('/admin/images?limit=all').then(res => setPickerImages(res.data.images));
        }
    }, [showLogoPicker]);

    const fetchUsers = () => api.get('/admin/users').then(res => { setUsers(res.data); return res; });
    const fetchPosts = () => api.get('/posts').then(res => {
        const data = res.data;
        setPosts(Array.isArray(data) ? data : (data?.posts || []));
        return res;
    });
    const fetchThemes = async () => {
        setThemesLoading(true);
        setThemesError(null);
        try {
            // Prefer public catalog (same data as admin) so a flaky admin auth path cannot hide presets
            let data: ThemeMeta[] = await fetchThemeCatalog();
            if (!data.length) {
                const res = await api.get('/admin/themes');
                const raw = res.data;
                if (Array.isArray(raw) && raw.length && typeof raw[0] === 'object') {
                    data = raw as ThemeMeta[];
                } else if (Array.isArray(raw)) {
                    data = (raw as string[]).map(id => ({ id, label: id, mdEditorTheme: 'dark' as const }));
                }
            }
            if (data.length) {
                setThemeCatalog(data);
            } else {
                setThemeCatalog([]);
                setThemesError('Theme catalog response was empty');
            }
        } catch (err) {
            console.error('Failed to fetch themes:', err);
            setThemesError('Could not load theme catalog');
        } finally {
            setThemesLoading(false);
        }
    };
    const fetchImages = () => {
        const limit = imagesPerPage;
        const offset = (imagePage - 1) * (limit === 'all' ? 0 : parseInt(limit, 10));
        return api.get(`/admin/images?limit=${limit}&offset=${offset}`).then(res => {
            setImages(res.data.images);
            setImagesTotal(res.data.total || 0);
            return res;
        });
    };

    useEffect(() => {
        if (user) fetchImages().catch(err => console.error('Failed to fetch images:', err));
    }, [imagePage, imagesPerPage, user]);
    const fetchConfig = () => api.get('/config').then(res => {
        const data = res.data;
        const defaultAiConfig = { enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', modelId: 'llama3' };
        const defaultSecurity = {
            authMode: 'jwt' as const,
            sessionTtlSeconds: 86400,
            disableAI: false,
            disableImages: false,
            disablePublicSearch: false
        };
        const defaultAppearance = { themeMode: 'dark' as const, crtEffects: true, textGlow: true };
        const defaultFooter = {
            show: true,
            copyrightText: '© {year} {siteName}. All rights reserved.',
            creditText: ''
        };
        data.aiConfig = { ...defaultAiConfig, ...data.aiConfig };
        data.security = { ...defaultSecurity, ...data.security };
        data.appearance = { ...defaultAppearance, ...data.appearance };
        data.footer = { ...defaultFooter, ...data.footer };
        setConfig(data);
        if (data.service?.port) localStorage.setItem('lastPort', data.service.port.toString());
        return res;
    });

    const previewTheme = (themeId: string, appearanceOverride?: Partial<{ themeMode: string; crtEffects: boolean; textGlow: boolean }>) => {
        const appearance = { ...config.appearance, ...appearanceOverride };
        // Admin preview uses the site default mode (not the visitor localStorage override)
        const mode = appearance.themeMode === 'light' ? 'light' : 'dark';
        applyTheme(themeId, {
            mode,
            crtEffects: appearance.crtEffects !== false,
            textGlow: appearance.textGlow !== false
        });
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: themeId }));
    };
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
        api.post('/admin/config', config)
            .then(() => {
                const oldPort = parseInt(localStorage.getItem('lastPort') || '5173');
                const newPort = config.service?.port || 5173;
                setSiteName(config.siteName);
                setSiteLogo(config.siteLogo || undefined);
                fetchConfig();
                previewTheme(config.currentTheme);
                if (oldPort !== newPort) {
                    showAlert(`Settings saved! Port changed to ${newPort}. You will need to restart the service for this to take effect.`, 'Success');
                    localStorage.setItem('lastPort', newPort.toString());
                } else {
                    showAlert('Settings saved successfully!', 'Success');
                }
            })
            .catch((err: unknown) => {
                const ax = err as { response?: { data?: { message?: string } } };
                const msg = ax.response?.data?.message || 'Failed to save settings (is config.json writable by the service user?)';
                showAlert(msg, 'Save failed');
            });
    };

    const handleSaveAIConfig = () => {
        api.post('/admin/ai-config', config.aiConfig).then(() => {
            fetchConfig().then(() => showAlert('AI settings saved successfully!', 'Success'));
        });
    };

    const handleSaveTheme = () => {
        api.post(`/admin/themes/${config.currentTheme}`, themeColors)
            .then(() => {
                fetchThemes();
                showAlert(`${config.currentTheme.charAt(0).toUpperCase() + config.currentTheme.slice(1)} theme colors saved!`, 'Success');
            })
            .catch((err: unknown) => {
                const ax = err as { response?: { data?: { message?: string } } };
                showAlert(ax.response?.data?.message || 'Failed to save theme colors', 'Save failed');
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
                            <button onClick={() => setActiveTab('posts')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'posts' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><FileText size={18} /> Posts</button>
                            <button onClick={() => setActiveTab('images')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'images' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><ImageIcon size={18} /> Images</button>
                            <button onClick={handleNewPost} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition hover:bg-bg text-accent"><Plus size={18} /> New Post</button>
                        </nav>
                    </div>
                    {user.role === 'admin' && (
                        <div className="mb-6">
                            <h2 className="text-xs font-black uppercase tracking-wider opacity-50 mb-3">Admin</h2>
                            <nav className="space-y-1">
                                <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'settings' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><Server size={18} /> Site</button>
                                <button onClick={() => setActiveTab('appearance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'appearance' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><Palette size={18} /> Appearance</button>
                                <button onClick={() => setActiveTab('users')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'users' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><Users size={18} /> Users</button>
                                <button onClick={() => setActiveTab('ai')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'ai' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><Cpu size={18} /> AI Settings</button>
                                <button onClick={() => setActiveTab('security')} data-testid="admin-security-tab" className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'security' ? 'bg-accent text-on-accent' : 'hover:bg-bg'}`}><Shield size={18} /> Security</button>
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
                                            <button onClick={() => handleEditPost(post)} className="p-2 hover:bg-accent hover:text-on-accent rounded transition"><Edit size={18} /></button>
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
                                    <label className="bg-accent text-on-accent px-4 py-2 rounded font-bold cursor-pointer flex items-center gap-2"><Upload size={18} /> Upload<input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} /></label>
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
                                                <button onClick={() => setPreviewImage(img)} className="p-2 bg-accent text-on-accent rounded-full z-20"><Eye size={18} /></button>
                                                <button onClick={() => handleDeleteImage(img.filename)} className="p-2 bg-red-500 text-white rounded-full z-20"><Trash2 size={18} /></button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {images.length === 0 && <p className="text-center opacity-50 py-12">No images yet. Upload your first image!</p>}
                            {imagesTotal > 0 && (
                                <div className="flex items-center justify-between mt-6 gap-4">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span>Per page</span>
                                        <select
                                            value={imagesPerPage}
                                            onChange={e => { setImagesPerPage(e.target.value); setImagePage(1); }}
                                            className="p-2 bg-bg border border-accent rounded"
                                        >
                                            <option value="12">12</option>
                                            <option value="30">30</option>
                                            <option value="60">60</option>
                                            <option value="all">All</option>
                                        </select>
                                        <span className="opacity-60">{imagesTotal} total</span>
                                    </div>
                                    {imagesPerPage !== 'all' && (
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                disabled={imagePage <= 1}
                                                onClick={() => setImagePage(p => Math.max(1, p - 1))}
                                                className="px-3 py-2 bg-secondary rounded disabled:opacity-40"
                                            >Prev</button>
                                            <span className="px-2 py-2 text-sm">Page {imagePage} / {Math.max(1, Math.ceil(imagesTotal / parseInt(imagesPerPage, 10)))}</span>
                                            <button
                                                type="button"
                                                disabled={imagePage * parseInt(imagesPerPage, 10) >= imagesTotal}
                                                onClick={() => setImagePage(p => p + 1)}
                                                className="px-3 py-2 bg-secondary rounded disabled:opacity-40"
                                            >Next</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'settings' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6" data-testid="site-settings-heading">Site</h1>
                            <p className="text-sm opacity-60 mb-4">
                                Branding, home page list, and footer. Everything here is saved as plain JSON in your config file.
                            </p>
                            <div className="bg-secondary rounded-lg p-6 space-y-8" data-testid="site-settings-panel">
                                <section className="space-y-4">
                                    <h2 className="text-lg font-bold border-b border-border pb-2">Identity</h2>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Site name</label>
                                        <input
                                            data-testid="site-name-input"
                                            type="text"
                                            value={config.siteName || ''}
                                            onChange={e => setConfig((prev: any) => ({ ...prev, siteName: e.target.value }))}
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        />
                                        <p className="text-xs opacity-50 mt-1">Shown in the header and browser title.</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Site logo</label>
                                        <div className="flex items-center gap-4">
                                            {config.siteLogo && (
                                                <img src={`/api/getimage?fileName=${config.siteLogo}`} alt="Logo" className="h-12 w-auto" />
                                            )}
                                            <button type="button" onClick={() => setShowLogoPicker(true)} className="bg-accent text-on-accent px-4 py-2 rounded font-bold">
                                                Choose image
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <h2 className="text-lg font-bold border-b border-border pb-2">Home page</h2>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Posts per page</label>
                                        <input
                                            data-testid="site-pagination-input"
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={config.pagination ?? 10}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    pagination: parseInt(e.target.value, 10) || 10
                                                }))
                                            }
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        />
                                        <p className="text-xs opacity-50 mt-1">How many posts load at a time on the public home page.</p>
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Sort posts by</label>
                                            <select
                                                data-testid="site-sortby-select"
                                                value={config.sortBy || 'date'}
                                                onChange={e => setConfig((prev: any) => ({ ...prev, sortBy: e.target.value }))}
                                                className="w-full p-3 bg-bg border border-accent rounded text-text"
                                            >
                                                <option value="date">Date</option>
                                                <option value="title">Title</option>
                                                <option value="author">Author</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Sort order</label>
                                            <select
                                                data-testid="site-sortorder-select"
                                                value={config.sortOrder || 'desc'}
                                                onChange={e => setConfig((prev: any) => ({ ...prev, sortOrder: e.target.value }))}
                                                className="w-full p-3 bg-bg border border-accent rounded text-text"
                                            >
                                                <option value="desc">Newest / Z–A first</option>
                                                <option value="asc">Oldest / A–Z first</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Search box</label>
                                        <select
                                            data-testid="site-search-placement"
                                            value={
                                                config.searchPlacement === 'bottom' || config.searchPlacement === 'none'
                                                    ? config.searchPlacement
                                                    : 'top'
                                            }
                                            onChange={e => setConfig((prev: any) => ({ ...prev, searchPlacement: e.target.value }))}
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        >
                                            <option value="top">Top of home page</option>
                                            <option value="bottom">Bottom of home page</option>
                                            <option value="none">Hidden</option>
                                        </select>
                                        <p className="text-xs opacity-50 mt-1">Public search can also be disabled entirely under Security.</p>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <h2 className="text-lg font-bold border-b border-border pb-2">Footer &amp; copyright</h2>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            data-testid="footer-show-toggle"
                                            checked={config.footer?.show !== false}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    footer: { ...prev.footer, show: e.target.checked }
                                                }))
                                            }
                                        />
                                        <span className="text-sm font-bold">Show site footer</span>
                                    </label>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Copyright line</label>
                                        <input
                                            data-testid="footer-copyright-input"
                                            type="text"
                                            value={config.footer?.copyrightText ?? '© {year} {siteName}. All rights reserved.'}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    footer: { ...prev.footer, copyrightText: e.target.value }
                                                }))
                                            }
                                            placeholder="© {year} {siteName}. All rights reserved."
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        />
                                        <p className="text-xs opacity-50 mt-1">
                                            Use <code className="opacity-80">{'{year}'}</code> and{' '}
                                            <code className="opacity-80">{'{siteName}'}</code>. Leave empty to remove this line.
                                        </p>
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            <button
                                                type="button"
                                                className="text-xs px-2 py-1 rounded border border-border hover:bg-hover"
                                                onClick={() =>
                                                    setConfig((prev: any) => ({
                                                        ...prev,
                                                        footer: {
                                                            ...prev.footer,
                                                            copyrightText: '© {year} {siteName}. All rights reserved.'
                                                        }
                                                    }))
                                                }
                                            >
                                                Reset default
                                            </button>
                                            <button
                                                type="button"
                                                data-testid="footer-clear-copyright"
                                                className="text-xs px-2 py-1 rounded border border-border hover:bg-hover"
                                                onClick={() =>
                                                    setConfig((prev: any) => ({
                                                        ...prev,
                                                        footer: { ...prev.footer, copyrightText: '' }
                                                    }))
                                                }
                                            >
                                                Clear copyright
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Extra credit line (optional)</label>
                                        <input
                                            data-testid="footer-credit-input"
                                            type="text"
                                            value={config.footer?.creditText || ''}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    footer: { ...prev.footer, creditText: e.target.value }
                                                }))
                                            }
                                            placeholder="e.g. Hosted on FreeBSD"
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        />
                                    </div>
                                    <div className="p-3 rounded border border-border bg-bg text-sm opacity-80" data-testid="footer-preview">
                                        <p className="text-xs font-bold opacity-50 mb-1">Preview</p>
                                        {config.footer?.show === false ? (
                                            <p className="italic opacity-50">(footer hidden)</p>
                                        ) : (
                                            <>
                                                {(config.footer?.copyrightText ?? '© {year} {siteName}. All rights reserved.') && (
                                                    <p>
                                                        {(config.footer?.copyrightText ??
                                                            '© {year} {siteName}. All rights reserved.')
                                                            .replace(/\{year\}/g, String(new Date().getFullYear()))
                                                            .replace(/\{siteName\}/g, config.siteName || 'MDWeb')}
                                                    </p>
                                                )}
                                                {config.footer?.creditText ? (
                                                    <p>
                                                        {String(config.footer.creditText)
                                                            .replace(/\{year\}/g, String(new Date().getFullYear()))
                                                            .replace(/\{siteName\}/g, config.siteName || 'MDWeb')}
                                                    </p>
                                                ) : null}
                                                {!config.footer?.copyrightText && !config.footer?.creditText && config.footer?.show !== false && (
                                                    <p className="italic opacity-50">(no lines — footer will not render)</p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <h2 className="text-lg font-bold border-b border-border pb-2">Service</h2>
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Listen port</label>
                                        <input
                                            type="number"
                                            value={config.service?.port || 5173}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    service: { ...prev.service, port: parseInt(e.target.value, 10) }
                                                }))
                                            }
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        />
                                        <p className="text-xs text-amber-500/90 mt-1">
                                            Changing the port requires restarting the mdweb service to take effect.
                                        </p>
                                    </div>
                                </section>

                                <details className="rounded border border-border p-4">
                                    <summary className="font-bold cursor-pointer">Advanced paths</summary>
                                    <p className="text-xs opacity-60 mt-2 mb-4">
                                        Wrong paths make the site look empty. Prefer FreeBSD defaults under{' '}
                                        <code>/var/db/mdweb</code>.
                                    </p>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Posts directory</label>
                                            <input
                                                data-testid="site-posts-dir"
                                                type="text"
                                                value={config.postsDir || ''}
                                                onChange={e => setConfig((prev: any) => ({ ...prev, postsDir: e.target.value }))}
                                                className="w-full p-3 bg-bg border border-accent rounded text-text font-mono text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Themes directory</label>
                                            <input
                                                data-testid="site-theme-dir"
                                                type="text"
                                                value={config.themeDir || ''}
                                                onChange={e => setConfig((prev: any) => ({ ...prev, themeDir: e.target.value }))}
                                                className="w-full p-3 bg-bg border border-accent rounded text-text font-mono text-sm"
                                            />
                                        </div>
                                    </div>
                                </details>

                                <button
                                    type="button"
                                    data-testid="site-save-button"
                                    onClick={handleSaveConfig}
                                    className="bg-accent text-on-accent px-6 py-3 rounded font-bold hover:bg-opacity-80 transition"
                                >
                                    Save site settings
                                </button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'appearance' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Appearance</h1>
                            <p className="text-sm opacity-60 mb-4">
                                Theme pack is site-wide. Visitors can switch light/dark for that pack in the navbar;
                                the default mode and CRT/glow effects are set here.
                            </p>
                            <div className="bg-secondary rounded-lg p-6 space-y-6">
                                <div>
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                        <label className="block text-sm font-bold">
                                            Theme preset ({themesLoading ? 'loading…' : `${themeCatalog.length} available`})
                                            {config.currentTheme && (
                                                <span className="font-normal opacity-60 ml-2">— {config.currentTheme}</span>
                                            )}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => fetchThemes()}
                                            className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-hover"
                                            title="Reload theme catalog"
                                        >
                                            <RefreshCw size={14} /> Reload
                                        </button>
                                    </div>
                                    {themesError && (
                                        <p className="text-sm text-red-400 mb-2">{themesError}</p>
                                    )}
                                    <p className="text-xs opacity-50 mb-2">
                                        Pick a pack from the grid below.
                                        {themeCatalog.length > 0 && themeCatalog.length < 10 && (
                                            <span className="text-amber-400"> Only {themeCatalog.length} loaded — click Reload if you expect more.</span>
                                        )}
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Default light / dark</label>
                                        <select
                                            data-testid="admin-theme-mode"
                                            value={config.appearance?.themeMode === 'light' ? 'light' : 'dark'}
                                            onChange={e => {
                                                const themeMode = e.target.value === 'light' ? 'light' : 'dark';
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    appearance: { ...prev.appearance, themeMode }
                                                }));
                                                previewTheme(config.currentTheme, { themeMode });
                                            }}
                                            className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        >
                                            <option value="dark">Dark</option>
                                            <option value="light">Light</option>
                                        </select>
                                        <p className="text-xs opacity-50 mt-1">
                                            Used when a visitor has not chosen a mode yet.
                                        </p>
                                    </div>
                                    <label className="flex items-start gap-3 p-3 rounded border border-border cursor-pointer hover:bg-hover">
                                        <input
                                            type="checkbox"
                                            data-testid="admin-crt-effects"
                                            checked={config.appearance?.crtEffects !== false}
                                            onChange={e => {
                                                const crtEffects = e.target.checked;
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    appearance: { ...prev.appearance, crtEffects }
                                                }));
                                                previewTheme(config.currentTheme, { crtEffects });
                                            }}
                                            className="mt-1"
                                        />
                                        <span>
                                            <span className="font-bold text-sm block">CRT effects</span>
                                            <span className="text-xs opacity-60">Scanlines, vignette, flicker on retro packs</span>
                                        </span>
                                    </label>
                                    <label className="flex items-start gap-3 p-3 rounded border border-border cursor-pointer hover:bg-hover">
                                        <input
                                            type="checkbox"
                                            data-testid="admin-text-glow"
                                            checked={config.appearance?.textGlow !== false}
                                            onChange={e => {
                                                const textGlow = e.target.checked;
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    appearance: { ...prev.appearance, textGlow }
                                                }));
                                                previewTheme(config.currentTheme, { textGlow });
                                            }}
                                            className="mt-1"
                                        />
                                        <span>
                                            <span className="font-bold text-sm block">Text glow</span>
                                            <span className="text-xs opacity-60">Phosphor bloom on headings and links</span>
                                        </span>
                                    </label>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[28rem] overflow-y-auto pr-1">
                                    {themeCatalog.map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            data-testid={`theme-card-${t.id}`}
                                            onClick={() => {
                                                setConfig((prev: any) => ({ ...prev, currentTheme: t.id }));
                                                previewTheme(t.id);
                                            }}
                                            className={`p-3 rounded border text-left text-sm transition ${
                                                config.currentTheme === t.id
                                                    ? 'border-accent bg-accent text-on-accent'
                                                    : 'border-border hover:bg-hover'
                                            }`}
                                        >
                                            <span className="font-bold block truncate">{t.label}</span>
                                            <span className="text-xs opacity-60">{t.id}</span>
                                        </button>
                                    ))}
                                </div>
                                {!themesLoading && themeCatalog.length === 0 && (
                                    <p className="text-sm opacity-70">No themes found. Check server themeDir and restart mdweb.</p>
                                )}
                                {themeColors && (
                                    <div className="grid grid-cols-2 gap-4">
                                        {cssColorEntries(themeColors).map(([key, value]) => (
                                            <div key={key} className="flex items-center gap-4">
                                                <input
                                                    type="color"
                                                    value={value as string}
                                                    onChange={e => setThemeColors((prev: any) => ({ ...prev, [key]: e.target.value }))}
                                                    className="w-12 h-12 rounded cursor-pointer"
                                                />
                                                <div>
                                                    <p className="font-bold text-sm">{getThemeLabel(key)}</p>
                                                    <p className="text-xs opacity-50">{key}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-3">
                                    <button onClick={handleSaveConfig} className="bg-primary text-on-primary px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">
                                        Set as site theme
                                    </button>
                                    <button onClick={handleSaveTheme} className="bg-accent text-on-accent px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">
                                        Save color overrides
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'security' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6" data-testid="security-settings-heading">Security</h1>
                            <p className="text-sm opacity-60 mb-4">
                                JWT is the default. Switch to classical session cookies if your environment strips
                                Authorization headers or JWT secrets are awkward to manage. Changing mode forces everyone to log in again.
                            </p>
                            <div className="bg-secondary rounded-lg p-6 space-y-6" data-testid="security-settings-panel">
                                <div>
                                    <label className="block text-sm font-bold mb-2">Authentication mode</label>
                                    <select
                                        data-testid="auth-mode-select"
                                        value={config.security?.authMode === 'session' ? 'session' : 'jwt'}
                                        onChange={e =>
                                            setConfig((prev: any) => ({
                                                ...prev,
                                                security: {
                                                    ...prev.security,
                                                    authMode: e.target.value === 'session' ? 'session' : 'jwt'
                                                }
                                            }))
                                        }
                                        className="w-full p-3 bg-bg border border-accent rounded text-text"
                                    >
                                        <option value="jwt">JWT Bearer (recommended)</option>
                                        <option value="session">Session cookie (classical)</option>
                                    </select>
                                    <p className="text-xs opacity-50 mt-1">
                                        Env override: <code className="opacity-80">MDWEB_AUTH_MODE=jwt|session</code>
                                    </p>
                                </div>
                                {config.security?.authMode === 'session' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Session lifetime (hours)</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={168}
                                                data-testid="session-ttl-hours"
                                                value={Math.round((config.security?.sessionTtlSeconds || 86400) / 3600)}
                                                onChange={e => {
                                                    const hours = Math.max(1, Math.min(168, parseInt(e.target.value, 10) || 24));
                                                    setConfig((prev: any) => ({
                                                        ...prev,
                                                        security: {
                                                            ...prev.security,
                                                            sessionTtlSeconds: hours * 3600
                                                        }
                                                    }));
                                                }}
                                                className="w-full p-3 bg-bg border border-accent rounded text-text"
                                            />
                                        </div>
                                        <details
                                            open={showAdvancedSession}
                                            onToggle={e => setShowAdvancedSession((e.target as HTMLDetailsElement).open)}
                                        >
                                            <summary className="text-sm font-bold cursor-pointer">Advanced cookie name</summary>
                                            <input
                                                data-testid="session-cookie-name"
                                                type="text"
                                                value={config.security?.sessionCookieName || 'mdweb.sid'}
                                                onChange={e =>
                                                    setConfig((prev: any) => ({
                                                        ...prev,
                                                        security: { ...prev.security, sessionCookieName: e.target.value }
                                                    }))
                                                }
                                                className="w-full mt-2 p-3 bg-bg border border-accent rounded text-text font-mono text-sm"
                                            />
                                        </details>
                                    </div>
                                )}
                                <div className="space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={!!config.security?.disablePublicSearch}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    security: { ...prev.security, disablePublicSearch: e.target.checked }
                                                }))
                                            }
                                        />
                                        <span className="text-sm font-bold">Disable public search</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={!!config.security?.disableImages}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    security: { ...prev.security, disableImages: e.target.checked }
                                                }))
                                            }
                                        />
                                        <span className="text-sm font-bold">Disable image uploads</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={!!config.security?.disableAI}
                                            onChange={e =>
                                                setConfig((prev: any) => ({
                                                    ...prev,
                                                    security: { ...prev.security, disableAI: e.target.checked }
                                                }))
                                            }
                                        />
                                        <span className="text-sm font-bold">Disable AI features</span>
                                    </label>
                                </div>
                                <p className="text-xs opacity-60">
                                    Auth secret configured:{' '}
                                    <strong>{config.security?.authSecretSet === false ? 'no' : 'yes / unknown'}</strong>
                                    {' '}(set <code>JWT_SECRET</code> or <code>SESSION_SECRET</code> in mdweb.env)
                                </p>
                                <button
                                    type="button"
                                    data-testid="security-save-button"
                                    onClick={() => {
                                        showConfirm(
                                            'Saving security settings may require all users to log in again. Continue?',
                                            () => handleSaveConfig(),
                                            'Confirm security save'
                                        );
                                    }}
                                    className="bg-accent text-on-accent px-6 py-3 rounded font-bold hover:bg-opacity-80 transition"
                                >
                                    Save security settings
                                </button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'users' && user.role === 'admin' && (
                        <div>
                            <h1 className="text-3xl font-bold mb-6">Users</h1>
                            <div className="bg-secondary rounded-lg p-6 mb-6 space-y-4" data-testid="user-create-panel">
                                <h2 className="font-bold">Add user</h2>
                                <div className="grid sm:grid-cols-3 gap-3">
                                    <input
                                        data-testid="new-user-username"
                                        type="text"
                                        placeholder="Username"
                                        value={newUser.username}
                                        onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                                        className="p-3 bg-bg border border-accent rounded text-text"
                                    />
                                    <input
                                        data-testid="new-user-password"
                                        type="password"
                                        placeholder="Password (min 8)"
                                        value={newUser.password}
                                        onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                                        className="p-3 bg-bg border border-accent rounded text-text"
                                    />
                                    <select
                                        data-testid="new-user-role"
                                        value={newUser.role}
                                        onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                                        className="p-3 bg-bg border border-accent rounded text-text"
                                    >
                                        <option value="contributor">Contributor</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    data-testid="new-user-submit"
                                    className="bg-accent text-on-accent px-4 py-2 rounded font-bold"
                                    onClick={() => {
                                        api.post('/admin/users', newUser)
                                            .then(() => {
                                                setNewUser({ username: '', password: '', role: 'contributor' });
                                                fetchUsers();
                                                showAlert('User created', 'Success');
                                            })
                                            .catch((err: unknown) => {
                                                const ax = err as { response?: { data?: { message?: string } } };
                                                showAlert(ax.response?.data?.message || 'Failed to create user', 'Error');
                                            });
                                    }}
                                >
                                    Create user
                                </button>
                            </div>
                            <div className="bg-secondary rounded-lg p-6">
                                <table className="w-full">
                                    <thead><tr className="text-left border-b border-accent"><th className="pb-3">Username</th><th className="pb-3">Role</th><th className="pb-3">Actions</th></tr></thead>
                                    <tbody>
                                        {users.map(u => (
                                            <tr key={u.username} className="border-b border-accent border-opacity-20">
                                                <td className="py-3">{u.username} {u.username === user.username && '(You)'}</td>
                                                <td className="py-3"><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-accent text-on-accent' : 'bg-secondary text-text'}`}>{u.role}</span></td>
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
                            <h1 className="text-3xl font-bold mb-6" data-testid="ai-settings-heading">AI Settings</h1>
                            <div className="bg-secondary rounded-lg p-6 space-y-6" data-testid="ai-settings-panel">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold">AI Features</h3>
                                        <p className="text-sm opacity-50">Enable AI-powered features like auto-summarize and enhance</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input data-testid="ai-enabled-toggle" type="checkbox" checked={config.aiConfig?.enabled || false} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, enabled: e.target.checked } }))} className="sr-only peer" />
                                        <div className="w-11 h-6 bg-bg rounded-full peer peer-checked:bg-accent transition"></div>
                                        <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition"></div>
                                    </label>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Provider</label>
                                    <select data-testid="ai-provider-select" value={config.aiConfig?.provider || 'ollama'} onChange={e => { setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, provider: e.target.value } })); if (e.target.value === 'openai') setModelsList([]); }} className="w-full p-3 bg-bg border border-accent rounded text-text">
                                        <option value="ollama">Ollama (Local)</option>
                                        <option value="openai">OpenAI</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Base URL</label>
                                    <input data-testid="ai-baseurl-input" type="text" value={config.aiConfig?.baseUrl || ''} onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, baseUrl: e.target.value } }))} className="w-full p-3 bg-bg border border-accent rounded text-text" placeholder="http://localhost:11434" />
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
                                    <input
                                        type="password"
                                        value={config.aiConfig?.apiKey || ''}
                                        onChange={e => setConfig((prev: any) => ({ ...prev, aiConfig: { ...prev.aiConfig, apiKey: e.target.value } }))}
                                        placeholder={config.aiConfig?.apiKeySet ? 'Key is set — leave blank to keep' : 'API key'}
                                        className="w-full p-3 bg-bg border border-accent rounded text-text"
                                        autoComplete="off"
                                    />
                                </div>
                                <button data-testid="ai-save-button" onClick={handleSaveAIConfig} className="bg-accent text-on-accent px-6 py-3 rounded font-bold hover:bg-opacity-80 transition">Save AI Settings</button>
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
                theme={editorTheme}
            />
            <ImagePickerModal isOpen={showLogoPicker} images={pickerImages} onSelect={handleLogoSelect} onClose={() => setShowLogoPicker(false)} onUpload={handleImageUpload} onPreview={(img) => setPreviewImage(img)} />
            <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
        </div>
    );
};
