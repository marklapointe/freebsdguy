import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MdPreview, MdCatalog } from 'md-editor-rt';
import { api, siteConfig, getMdEditorTheme } from '../lib/api';
import { onThemeChanged } from '../lib/theme-events';
import { enhanceCollapsibleLists } from '../lib/collapse-lists';
import { enhanceSortableTables, resolveTableSort, wrapTables } from '../lib/table-sort';
import { addTableTools, closeTablePopup, renderCsvTables } from '../lib/table-tools';
import { Post } from '../types';

export const PostDetail = () => {
    const { slug } = useParams<{ slug: string }>();
    const [post, setPost] = useState<Post | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [id] = useState('preview-only');
    const scrollElement = document.documentElement;
    const bodyRef = useRef<HTMLDivElement>(null);
    const frame = useRef(0);
    const [siteSort, setSiteSort] = useState<boolean | undefined>(undefined);
    const sortOn = useRef(false);
    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
    // Track #1682: close an open table popup on navigation to another post (slug) or unmount.
    // Keyed on the slug, not the post object, so a re-render does not close a popup just opened.
    useEffect(() => () => closeTablePopup(), [slug]);
    const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>(getMdEditorTheme());

    useEffect(() => {
        siteConfig.load().then((cfg) => setSiteSort(cfg.tableSort));
    }, []);

    useEffect(() => {
        setError(null);
        setPost(null);
        if (!slug) {
            setError('Post not found');
            return;
        }
        // Ignore responses that arrive after the slug changed (stale navigation)
        let cancelled = false;
        api.get(`/posts/${encodeURIComponent(slug)}`)
            .then(res => {
                if (cancelled) return;
                setPost(res.data);
                siteConfig.load().then(cfg => {
                    if (cancelled) return;
                    document.title = res.data.title ? `${res.data.title} - ${cfg.siteName}` : cfg.siteName;
                });
            })
            .catch(() => {
                if (!cancelled) setError('Post not found');
            });
        return () => {
            cancelled = true;
        };
    }, [slug]);

    // One resolved flag; the preview callback reads it from a ref so it never sees stale state.
    useEffect(() => {
        sortOn.current = resolveTableSort(siteSort, post?.tablesort);
        if (post && bodyRef.current) enhanceSortableTables(bodyRef.current, sortOn.current);
    }, [siteSort, post]);

    useEffect(() => {
        return onThemeChanged(() => setEditorTheme(getMdEditorTheme()));
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

    const when = post.date ? new Date(post.date) : null;
    const valid = when && !isNaN(when.getTime());
    return (
        <article className="article-shell content-col mx-auto w-full max-w-3xl my-4 sm:my-8">
            <header className="article-header">
                <div className="article-meta">
                    {valid && <time dateTime={when!.toISOString()}>{when!.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>}
                    {post.author && <><span className="dot" aria-hidden="true">•</span><span>{post.author}</span></>}
                </div>
                <h1 className="article-title text-3xl sm:text-4xl font-extrabold text-primary">{post.title}</h1>
                <div className="article-rule" aria-hidden="true"></div>
            </header>

            <div className="article-layout">
                <div className="article-body min-w-0" ref={bodyRef}>
                    <MdPreview
                        id={id}
                        modelValue={post.content}
                        theme={editorTheme}
                        language="en-US"
                        onHtmlChanged={() => {
                            // Track #1682: collapse long "Updates" lists once the preview DOM is in place.
                            if (frame.current) cancelAnimationFrame(frame.current);
                            frame.current = requestAnimationFrame(() => {
                                frame.current = 0;
                                if (bodyRef.current) {
                                    enhanceCollapsibleLists(bodyRef.current);
                                    wrapTables(bodyRef.current);
                                    enhanceSortableTables(bodyRef.current, sortOn.current);
                                    addTableTools(bodyRef.current);
                                    // Track #1682: tables published as CSV render once fetched, then get the same tools.
                                    const body = bodyRef.current;
                                    void renderCsvTables(body).then((n) => {
                                        if (!n) return;
                                        wrapTables(body);
                                        enhanceSortableTables(body, sortOn.current);
                                        addTableTools(body);
                                    });
                                }
                            });
                        }}
                    />
                </div>
                <aside className="article-toc hidden lg:block" aria-labelledby="toc-label">
                    <div className="sticky top-24">
                        <p id="toc-label" className="text-xs font-black uppercase tracking-[0.2em] mb-4">Contents</p>
                        <MdCatalog editorId={id} scrollElement={scrollElement} />
                    </div>
                </aside>
            </div>

            <div className="article-back">
                <Link to="/" className="flex items-center gap-2">
                    <span aria-hidden="true">←</span> Back to home
                </Link>
            </div>
        </article>
    );
};