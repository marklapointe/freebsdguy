import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MdPreview, MdCatalog } from 'md-editor-rt';
import { api, siteConfig, getMdEditorTheme } from '../lib/api';
import { Post } from '../types';

export const PostDetail = () => {
    const { slug } = useParams<{ slug: string }>();
    const [post, setPost] = useState<Post | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [id] = useState('preview-only');
    const scrollElement = document.documentElement;
    const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>(getMdEditorTheme());

    useEffect(() => {
        siteConfig.load();
    }, []);

    useEffect(() => {
        setError(null);
        setPost(null);
        if (!slug) {
            setError('Post not found');
            return;
        }
        api.get(`/posts/${slug}`)
            .then(res => {
                setPost(res.data);
                siteConfig.load().then(cfg => {
                    document.title = res.data.title ? `${res.data.title} - ${cfg.siteName}` : cfg.siteName;
                });
            })
            .catch(() => {
                setError('Post not found');
            });
    }, [slug]);

    useEffect(() => {
        const handleThemeChanged = () => setEditorTheme(getMdEditorTheme());
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

    if (error) {
        return (
            <div className="p-8 text-center text-primary" data-testid="post-not-found">
                {error}
                <div className="mt-4">
                    <Link to="/" className="text-accent hover:underline font-bold">
                        ← Back to home
                    </Link>
                </div>
            </div>
        );
    }

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
                            theme={editorTheme}
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