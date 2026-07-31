import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { getPosts, getPost, savePost } from '../server/lib/posts';

vi.mock('gray-matter', async () => {
    const actual = await vi.importActual('gray-matter') as any;
    const mockMatter = vi.fn(actual.default);
    // keep stringify and other props on the mock fn without overwriting default export
    mockMatter.stringify = actual.default.stringify.bind(actual.default);
    mockMatter.clearFrontMatterCache = actual.default.clearFrontMatterCache;
    return {
        ...actual,
        default: mockMatter,
        __esModule: true
    };
});

describe('posts.ts', () => {
    const tempDir = path.join(os.tmpdir(), 'mdweb-test-posts');

    beforeEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('getPosts returns empty array if directory does not exist', () => {
        const posts = getPosts(path.join(tempDir, 'nonexistent'));
        expect(posts).toEqual([]);
    });

    it('savePost and getPost works', () => {
        const post = {
            slug: 'test-post',
            title: 'Test Post',
            content: '# Hello World',
            summary: 'A test post',
            author: 'admin',
            date: '2023-01-01'
        };
        savePost(tempDir, post);
        
        const loaded = getPost(tempDir, 'test-post');
        expect(loaded).toMatchObject({
            slug: 'test-post',
            title: 'Test Post',
            content: '# Hello World\n',
            summary: 'A test post',
            author: 'admin',
            date: '2023-01-01'
        });
    });

    it('getPosts returns all posts in directory', () => {
        savePost(tempDir, { slug: 'post1', title: 'Post 1', content: 'C1', author: 'A', date: '2023-01-01' });
        savePost(tempDir, { slug: 'post2', title: 'Post 2', content: 'C2', author: 'A', date: '2023-01-02' });
        
        const posts = getPosts(tempDir);
        expect(posts.length).toBe(2);
        // Sorted by date descending
        expect(posts[0].slug).toBe('post2');
    });

    it('getPost returns null if post does not exist', () => {
        expect(getPost(tempDir, 'ghost')).toBeNull();
    });

    it('getPost returns full markdown body for demo-style posts (frontmatter + body)', () => {
        // Mirrors shipped showcase posts: YAML frontmatter then markdown body
        const raw = `---
title: The Markdown Kitchen Sink
summary: A short teaser
date: 2026-07-29
author: MDWeb
pinned: true
---

# The Markdown Kitchen Sink

If Markdown were a diner, this post would order **everything on the menu**.

## Lists

- Coffee
- Kernel rebuild
`;
        fs.writeFileSync(path.join(tempDir, 'kitchen-sink-markdown.md'), raw);
        const loaded = getPost(tempDir, 'kitchen-sink-markdown');
        expect(loaded).toBeTruthy();
        expect(loaded!.title).toBe('The Markdown Kitchen Sink');
        expect(loaded!.summary).toBe('A short teaser');
        expect(loaded!.pinned).toBe(true);
        // Body must be present for the admin editor — not empty / undefined
        expect(typeof loaded!.content).toBe('string');
        expect(loaded!.content.length).toBeGreaterThan(20);
        expect(loaded!.content).toContain('# The Markdown Kitchen Sink');
        expect(loaded!.content).toContain('everything on the menu');
        // Frontmatter must not be embedded as the only "content"
        expect(loaded!.content.trimStart().startsWith('---')).toBe(false);
    });

    it('getPosts list items do not include full body (metadata only)', () => {
        savePost(tempDir, {
            slug: 'meta-only',
            title: 'Meta',
            content: '# Long body that should not appear in list\n\nMore text.',
            summary: 'sum',
            author: 'admin',
            date: '2026-01-01'
        });
        const list = getPosts(tempDir);
        const item = list.find(p => p.slug === 'meta-only');
        expect(item).toBeTruthy();
        expect(item!.title).toBe('Meta');
        // List DTO has no content field (or empty) — editor must fetch by slug
        expect((item as any).content).toBeUndefined();
    });

    it('getPost body is not clobbered when frontmatter has extra keys', () => {
        const raw = `---
title: Extra Keys
summary: sum
date: 2026-01-02
author: MDWeb
content: SHOULD_NOT_WIN
---

# Real body

Paragraph.
`;
        fs.writeFileSync(path.join(tempDir, 'extra-keys.md'), raw);
        const loaded = getPost(tempDir, 'extra-keys');
        expect(loaded!.content).toContain('# Real body');
        expect(loaded!.content).not.toContain('SHOULD_NOT_WIN');
    });

    it('getPost handles path traversal attempt', () => {
        expect(getPost(tempDir, '../passwd')).toBeNull();
    });

    it('getPosts handles missing title or date', () => {
        fs.writeFileSync(path.join(tempDir, 'missing.md'), '---\nauthor: me\n---\ncontent');
        // We'll need to mock matter again or just rely on default behavior
        // Since we didn't mock it for this test yet (using actual)
        const posts = getPosts(tempDir);
        expect(posts.length).toBe(1);
    });

    it('savePost creates directory if it does not exist', () => {
        const deepDir = path.join(tempDir, 'a', 'b', 'c');
        savePost(deepDir, { slug: 'deep', title: 'Deep', content: 'Deep', author: 'A' });
        expect(fs.existsSync(path.join(deepDir, 'deep.md'))).toBe(true);
    });

    it('getPosts handles parsing error', async () => {
        fs.writeFileSync(path.join(tempDir, 'bad.md'), 'some content');
        const actual = await vi.importActual<any>('gray-matter');
        const mockMatter = matter as any;
        expect(typeof mockMatter.mockImplementationOnce).toBe('function');
        mockMatter.mockImplementationOnce(() => {
            throw new Error('Mock parse error');
        });
        const posts = getPosts(tempDir);
        expect(posts.length).toBe(1);
        expect(posts[0].title).toContain('Error');
        expect(posts[0].author).toBe('system');
        // ensure subsequent calls still work via default mock (actual)
        mockMatter.mockImplementation((input: any, opts?: any) => actual.default(input, opts));
        Object.assign(mockMatter, actual);
    });

    it('getPost handles parsing error', async () => {
        fs.writeFileSync(path.join(tempDir, 'bad.md'), 'some content');
        const actual = await vi.importActual<any>('gray-matter');
        const mockMatter = matter as any;
        mockMatter.mockImplementationOnce(() => {
            throw new Error('Mock parse error');
        });
        const post = getPost(tempDir, 'bad');
        expect(post?.title).toContain('Error');
        expect(post?.author).toBe('system');
        expect(post?.content).toMatch(/parsing error/i);
        mockMatter.mockImplementation((input: any, opts?: any) => actual.default(input, opts));
        Object.assign(mockMatter, actual);
    });
});
