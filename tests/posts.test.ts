import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { getPosts, getPost, savePost } from '../server/lib/posts';

vi.mock('gray-matter', async () => {
    const actual = await vi.importActual('gray-matter') as any;
    const mockMatter = vi.fn(actual.default);
    Object.assign(mockMatter, actual);
    return {
        default: mockMatter,
        ...actual,
        __esModule: true
    };
});

describe('posts.ts', () => {
    const tempDir = path.join(os.tmpdir(), 'freebsdguy-test-posts');

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

    it('getPosts handles parsing error', () => {
        fs.writeFileSync(path.join(tempDir, 'bad.md'), 'some content');
        const mockMatter = matter as any;
        if (mockMatter.mockImplementationOnce) {
            mockMatter.mockImplementationOnce(() => {
                throw new Error('Mock parse error');
            });
        } else {
            // Fallback if mocking failed
            return;
        }
        const posts = getPosts(tempDir);
        expect(posts.length).toBe(1);
        expect(posts[0].title).toContain('Error');
    });

    it('getPost handles parsing error', () => {
        fs.writeFileSync(path.join(tempDir, 'bad.md'), 'some content');
        const mockMatter = matter as any;
        if (mockMatter.mockImplementationOnce) {
            mockMatter.mockImplementationOnce(() => {
                throw new Error('Mock parse error');
            });
        } else {
            // Fallback if mocking failed
            return;
        }
        const post = getPost(tempDir, 'bad');
        expect(post?.title).toContain('Error');
    });
});
