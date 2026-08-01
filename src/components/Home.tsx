import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Pin } from 'lucide-react';
import { MdPreview } from 'md-editor-rt';
import { api, getMdEditorTheme } from '../lib/api';
import { onThemeChanged } from '../lib/theme-events';
import { Post } from '../types';

export const Home = () => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [limit, setLimit] = useState(10);
    const [searchPlacement, setSearchPlacement] = useState<string>('top');
    const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>(getMdEditorTheme());
    const [ready, setReady] = useState(false);

    useEffect(() => {
        return onThemeChanged(() => setEditorTheme(getMdEditorTheme()));
    }, []);

    useEffect(() => {
        api.get('/config')
            .then(res => {
                const pageSize = Number(res.data.pagination) || 10;
                setLimit(pageSize);
                const place = res.data.searchPlacement || 'top';
                // left/right → top for now (full sidebar layout later)
                setSearchPlacement(
                    place === 'none' || place === 'bottom' ? place : place === 'top' ? 'top' : 'top'
                );
                return pageSize;
            })
            .catch(() => 10)
            .then(pageSize => {
                setReady(true);
                fetchPosts(0, pageSize);
            });
    }, []);

    const fetchPosts = (newOffset: number, pageSize = limit) => {
        api.get(`/posts?limit=${pageSize}&offset=${newOffset}`).then(res => {
            const list = res.data.posts || (Array.isArray(res.data) ? res.data : []);
            if (newOffset === 0) {
                setPosts(list);
            } else {
                setPosts(prev => [...prev, ...list]);
            }
            setTotal(res.data.total ?? list.length);
            setOffset(newOffset);
        });
    };

    const loadMore = () => {
        fetchPosts(offset + limit);
    };

    const filteredPosts = posts.filter(
        p =>
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            (p.summary || '').toLowerCase().includes(search.toLowerCase())
    );

    const searchBox =
        searchPlacement !== 'none' ? (
            <div className="mb-8 relative" data-testid="public-search">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 opacity-50" size={20} />
                <input
                    id="search-input"
                    type="text"
                    placeholder="Search posts..."
                    className="w-full p-3 pl-10 rounded-lg bg-secondary border border-accent border-opacity-30 text-text focus:outline-none focus:ring-2 focus:ring-accent"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoComplete="off"
                />
            </div>
        ) : null;

    if (!ready) {
        return <div className="container mx-auto p-4 max-w-[85%] opacity-50">Loading…</div>;
    }

    return (
        <div className="container mx-auto p-4 max-w-[85%]">
            {searchPlacement !== 'bottom' && searchBox}
            <div className="grid gap-6">
                {filteredPosts.map(post => (
                    <div
                        key={post.slug}
                        className="p-6 bg-secondary rounded-lg shadow-lg hover:shadow-xl transition border-l-4 border-accent"
                    >
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            {post.pinned && (
                                <span title="Pinned Post">
                                    <Pin size={18} className="text-accent fill-accent" />
                                </span>
                            )}
                            <Link to={`/post/${post.slug}`} className="hover:text-accent">
                                {post.title}
                            </Link>
                        </h2>
                        <p className="opacity-70 text-sm mb-4">
                            {post.date ? new Date(post.date).toLocaleDateString() : ''}
                        </p>
                        <div className="mb-4 prose-sm max-w-none">
                            <MdPreview modelValue={post.summary || ''} theme={editorTheme} language="en-US" />
                        </div>
                        <Link to={`/post/${post.slug}`} className="text-accent font-semibold hover:underline">
                            Read more →
                        </Link>
                    </div>
                ))}
            </div>
            {!search && posts.length < total && (
                <div className="mt-8 text-center">
                    <button
                        onClick={loadMore}
                        className="bg-accent text-on-accent p-3 px-10 rounded-full font-bold hover:bg-opacity-80 transition shadow-lg flex items-center gap-2 group mx-auto"
                    >
                        <Plus size={20} className="group-hover:rotate-90 transition-transform" /> Load More
                    </button>
                </div>
            )}
            {search && filteredPosts.length === 0 && (
                <div className="text-center py-20 opacity-50">
                    <p className="text-xl">No posts matching &quot;{search}&quot;</p>
                </div>
            )}
            {searchPlacement === 'bottom' && searchBox}
        </div>
    );
};
