import React from 'react';
import { X, FileText, Pin, Sparkles } from 'lucide-react';
import { MdEditor, MdPreview } from 'md-editor-rt';

interface PostModalProps {
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
}

export const PostModal = ({
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
}: PostModalProps) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-secondary rounded-xl shadow-2xl border border-accent border-opacity-30 w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden text-text">
                <div className="flex justify-between items-center p-6 md:p-8 border-b border-accent border-opacity-20 pb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="text-accent" /> {post.slug ? 'Edit Post' : 'New Post'}
                    </h2>
                    <button onClick={onCancel} className="p-2 hover:bg-bg rounded-full transition">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={onSave} className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
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
                    <div className="flex items-center gap-2 py-2">
                        <input
                            id="post-pinned"
                            type="checkbox"
                            className="w-4 h-4 accent-accent"
                            checked={post.pinned || false}
                            onChange={e => setPost({...post, pinned: e.target.checked})}
                        />
                        <label htmlFor="post-pinned" className="text-sm font-bold text-accent cursor-pointer flex items-center gap-1">
                            <Pin size={14} /> Pin to Top of Home Page
                        </label>
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
                                <div className="max-h-60 overflow-y-auto p-1 bg-bg rounded text-sm border border-accent border-opacity-10">
                                    <MdPreview
                                        modelValue={enhancedPreview}
                                        theme={theme}
                                        language="en-US"
                                    />
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
                                'github'
                            ]}
                        />
                    </div>
                </div>
                <div className="p-6 md:p-8 border-t border-accent border-opacity-20 flex gap-4 bg-bg bg-opacity-30">
                        <button type="submit" className="bg-accent p-3 px-8 rounded font-bold hover:bg-opacity-80 transition text-white shadow-lg">Save Post</button>
                        <button type="button" onClick={onCancel} className="p-3 px-8 border border-accent rounded font-bold hover:bg-accent hover:bg-opacity-10 transition">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
};