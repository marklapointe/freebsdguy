import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MdPreview, MdCatalog } from 'md-editor-rt';
import { api } from '../lib/api';
import { Post } from '../types';

export const PostDetail = () => {
    const { slug } = useParams<{ slug: string }>();
    const [post, setPost] = useState<Post | null>(null);
    const [id] = useState('preview-only');
    const scrollElement = document.documentElement;
    const [theme, setTheme] = useState<'light' | 'dark'>(localStorage.getItem('theme') as 'light' | 'dark' || 'dark');

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