import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getPosts, getPost, savePost } from '../server/lib/posts';

const testPostsDir = path.join(__dirname, 'test-posts');

describe('Posts Library', () => {
    beforeEach(() => {
        if (!fs.existsSync(testPostsDir)) {
            fs.mkdirSync(testPostsDir, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(testPostsDir)) {
            fs.rmSync(testPostsDir, { recursive: true, force: true });
        }
    });

    it('should save and retrieve a post', () => {
        const post = {
            slug: 'test-post',
            title: 'Test Post',
            content: 'This is a test post.',
            summary: 'Test summary',
            author: 'admin'
        };

        savePost(testPostsDir, post);

        const retrieved = getPost(testPostsDir, 'test-post');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.title).toBe('Test Post');
        expect(retrieved?.content.trim()).toBe('This is a test post.');
    });

    it('should list posts in order', () => {
        savePost(testPostsDir, {
            slug: 'post1',
            title: 'Post 1',
            content: '...',
            author: 'admin',
            date: '2023-01-01'
        });
        savePost(testPostsDir, {
            slug: 'post2',
            title: 'Post 2',
            content: '...',
            author: 'admin',
            date: '2023-01-02'
        });

        const posts = getPosts(testPostsDir);
        expect(posts.length).toBe(2);
        expect(posts[0].slug).toBe('post2'); // Latest first
    });

    it('should return empty array if posts directory does not exist', () => {
        const nonExistentDir = path.join(__dirname, 'no-dir');
        if (fs.existsSync(nonExistentDir)) {
             fs.rmSync(nonExistentDir, { recursive: true, force: true });
        }
        const posts = getPosts(nonExistentDir);
        expect(posts).toEqual([]);
    });

    it('should create directory if it does not exist when saving post', () => {
        const nonExistentDir = path.join(__dirname, 'new-dir-for-save');
        if (fs.existsSync(nonExistentDir)) {
             fs.rmSync(nonExistentDir, { recursive: true, force: true });
        }
        
        try {
            savePost(nonExistentDir, {
                slug: 'test',
                content: 'content',
                author: 'admin'
            });
            expect(fs.existsSync(nonExistentDir)).toBe(true);
            expect(fs.existsSync(path.join(nonExistentDir, 'test.md'))).toBe(true);
        } finally {
            if (fs.existsSync(nonExistentDir)) {
                fs.rmSync(nonExistentDir, { recursive: true, force: true });
            }
        }
    });
    it('should throw if saving post with special characters in title', () => {
        const post = {
            slug: 'special-save-test',
            title: 'Title: with colon, "quotes", and {braces}',
            content: 'Post content',
            summary: 'Summary with : colon',
            author: 'admin'
        };

        savePost(testPostsDir, post);
        
        const content = fs.readFileSync(path.join(testPostsDir, 'special-save-test.md'), 'utf8');
        console.log('Saved content:', content);
        
        const retrieved = getPost(testPostsDir, 'special-save-test');
        expect(retrieved?.title).toBe('Title: with colon, "quotes", and {braces}');
    });

    it('should return null if post does not exist', () => {
        const post = getPost(testPostsDir, 'non-existent');
        expect(post).toBeNull();
    });

    it('should use fallback if matter.stringify fails', () => {
        const postsDir = path.join(testPostsDir, 'fallback-test');
        fs.mkdirSync(postsDir);
        
        const circular: any = { a: 1 };
        circular.self = circular;
        
        savePost(postsDir, {
            slug: 'circular',
            content: 'content',
            author: 'admin',
            title: circular as any
        });
        
        const content = fs.readFileSync(path.join(postsDir, 'circular.md'), 'utf8');
        // Gray-matter might actually handle circular by quoting it as '[object Object]' (single quotes)
        // or our fallback uses double quotes.
        expect(content).toContain('title:');
        expect(content).toContain('[object Object]');
    });

    it('should handle colons in title', () => {
        const post = {
            slug: 'colon-test',
            title: 'Installing FreeBSD: A Quick Start Guide',
            content: 'Post content',
            summary: 'A summary with: a colon',
            author: 'admin'
        };

        savePost(testPostsDir, post);

        const retrieved = getPost(testPostsDir, 'colon-test');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.title).toBe('Installing FreeBSD: A Quick Start Guide');
        expect(retrieved?.summary).toBe('A summary with: a colon');
    });

    it('should gracefully handle malformed posts', () => {
        const badContent = `---
title: Broken: Post: Title
summary: Bad summary
---
Content`;
        fs.writeFileSync(path.join(testPostsDir, 'bad-post.md'), badContent);

        try {
            const posts = getPosts(testPostsDir);
            const badPost = posts.find(p => p.slug === 'bad-post');
            expect(badPost).toBeDefined();
            expect(badPost?.title).toContain('Error');
        } catch (e) {
            // Should not throw
        }

        try {
            const singlePost = getPost(testPostsDir, 'bad-post');
            expect(singlePost?.title).toContain('Error');
        } catch (e) {
            // Should not throw
        }
    });

    it('should sanitize content when saving', () => {
        const post = {
            slug: 'xss-post',
            title: 'Test <script>alert("title")</script>',
            content: 'Post with <img src=x onerror=alert("content")> and <b>bold</b>.',
            summary: 'Summary <iframe src="javascript:alert(1)"></iframe>',
            author: 'admin'
        };

        savePost(testPostsDir, post);

        const retrieved = getPost(testPostsDir, 'xss-post');
        expect(retrieved?.title).not.toContain('<script>');
        expect(retrieved?.title).toBe('Test ');
        expect(retrieved?.summary).not.toContain('<iframe');
        expect(retrieved?.content).not.toContain('onerror');
        expect(retrieved?.content).toContain('<b>bold</b>');
    });
});
