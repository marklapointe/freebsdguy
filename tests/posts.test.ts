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
            const files = fs.readdirSync(testPostsDir);
            for (const file of files) {
                fs.unlinkSync(path.join(testPostsDir, file));
            }
            fs.rmdirSync(testPostsDir);
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

    it('should return null for non-existent post', () => {
        const retrieved = getPost(testPostsDir, 'ghost');
        expect(retrieved).toBeNull();
    });
});
