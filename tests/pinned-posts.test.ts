import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getPosts, savePost } from '../server/lib/posts';

const TEST_POSTS_DIR = path.join(__dirname, 'tmp_posts_pinned');

describe('Pinned Posts Sorting', () => {
    beforeEach(() => {
        if (!fs.existsSync(TEST_POSTS_DIR)) {
            fs.mkdirSync(TEST_POSTS_DIR, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(TEST_POSTS_DIR)) {
            fs.rmSync(TEST_POSTS_DIR, { recursive: true, force: true });
        }
    });

    it('should sort pinned posts first, then by date', () => {
        // Create an old pinned post
        savePost(TEST_POSTS_DIR, {
            slug: 'old-pinned',
            title: 'Old Pinned',
            content: 'Content',
            summary: 'Summary',
            date: '2020-01-01',
            pinned: true,
            author: 'test'
        });

        // Create a new unpinned post
        savePost(TEST_POSTS_DIR, {
            slug: 'new-unpinned',
            title: 'New Unpinned',
            content: 'Content',
            summary: 'Summary',
            date: '2023-01-01',
            pinned: false,
            author: 'test'
        });

        // Create a newer pinned post
        savePost(TEST_POSTS_DIR, {
            slug: 'newer-pinned',
            title: 'Newer Pinned',
            content: 'Content',
            summary: 'Summary',
            date: '2021-01-01',
            pinned: true,
            author: 'test'
        });

        const posts = getPosts(TEST_POSTS_DIR);
        
        expect(posts.length).toBe(3);
        
        // Pinned posts should be first
        expect(posts[0].slug).toBe('newer-pinned'); // Newer pinned post
        expect(posts[1].slug).toBe('old-pinned');   // Older pinned post
        expect(posts[2].slug).toBe('new-unpinned'); // Newest unpinned post (but after pinned)
    });
});
