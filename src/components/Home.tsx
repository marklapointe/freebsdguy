import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Pin } from 'lucide-react';
import { MdPreview } from 'md-editor-rt';
import { api, applyTheme } from '../lib/api';
import { Post } from '../types';

export const Home = () => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [limit] = useState(10);
    const [theme, setTheme] = useState<'light' | 'dark'>(localStorage.getItem('theme') as 'light' | 'dark' || 'dark');

    useEffect(() => {
        const handleThemeChanged = (e: CustomEvent) => {
            if (e.detail && (e.detail === 'light' || e.detail === 'dark')) {
                setTheme(e.detail);
            }
        };
        window.addEventListener('themeChanged' as any, handleThemeChanged);
        return () => window.removeEventListener('themeChanged' as any, handleThemeChanged);
    }, []);

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
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            {post.pinned && <span title="Pinned Post"><Pin size={18} className="text-accent fill-accent" /></span>}
                            <Link to={`/post/${post.slug}`} className="hover:text-accent">
                                {post.title}
                            </Link>
                        </h2>
                        <p className="opacity-70 text-sm mb-4">{new Date(post.date).toLocaleDateString()}</p>
                        <div className="mb-4 prose-sm max-w-none">
                            <MdPreview
                                modelValue={post.summary}
                                theme={theme}
                                language="en-US"
                            />
                        </div>
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