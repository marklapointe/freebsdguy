/**
 * Editing posts: list is metadata-only; full body comes from GET /api/posts/:slug.
 * Regression for empty editor when opening showcase / auto-seeded posts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { loadConfig, configPath } from '../server/lib/config.ts';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

function postsDir(): string {
    const cfg = loadConfig();
    const base = path.dirname(configPath());
    return path.isAbsolute(cfg.postsDir) ? cfg.postsDir : path.resolve(base, cfg.postsDir);
}

function writeDemoStylePost(dir: string, slug: string, body: string) {
    fs.mkdirSync(dir, { recursive: true });
    const raw = `---
title: Demo ${slug}
summary: Auto-generated showcase summary
date: 2026-07-29
author: MDWeb
---

${body}
`;
    fs.writeFileSync(path.join(dir, `${slug}.md`), raw, 'utf8');
}

describe('Edit post content (list vs detail)', () => {
    const slug = `edit-test-${Date.now()}`;
    const body = `# Hello editor\n\nThis is the **full** markdown body that must appear when editing.\n`;

    beforeAll(() => {
        writeDemoStylePost(postsDir(), slug, body);
    });

    it('GET /api/posts list omits body content', async () => {
        const res = await request(app).get('/api/posts?limit=100');
        expect(res.status).toBe(200);
        const list = res.body.posts || res.body;
        const item = list.find((p: { slug: string }) => p.slug === slug);
        expect(item, 'seeded post should appear in list').toBeTruthy();
        expect(item.title).toBe(`Demo ${slug}`);
        expect(item.content).toBeUndefined();
    });

    it('GET /api/posts/:slug returns full content for editor', async () => {
        const res = await request(app).get(`/api/posts/${slug}`);
        expect(res.status).toBe(200);
        expect(res.body.slug).toBe(slug);
        expect(typeof res.body.content).toBe('string');
        expect(res.body.content).toContain('Hello editor');
        expect(res.body.content).toContain('full');
        expect(res.body.content.trimStart().startsWith('---')).toBe(false);
        expect(res.body.content.length).toBeGreaterThan(10);
    });

    it('editor payload can be assembled from detail fetch (not list item alone)', async () => {
        const listRes = await request(app).get('/api/posts?limit=100');
        const list = listRes.body.posts || listRes.body;
        const meta = list.find((p: { slug: string }) => p.slug === slug);
        expect(meta).toBeTruthy();

        // Simulate Admin handleEditPost: always re-fetch by slug
        const detail = await request(app).get(`/api/posts/${meta.slug}`);
        const editingPost = {
            ...meta,
            content: typeof detail.body.content === 'string' ? detail.body.content : ''
        };
        expect(editingPost.content).toContain('Hello editor');
        expect(editingPost.title).toBeTruthy();
    });

    it('shipped-style demo posts under server/posts have non-empty bodies via getPost', async () => {
        const shipped = path.resolve(process.cwd(), 'server/posts');
        if (!fs.existsSync(shipped)) return;
        const files = fs.readdirSync(shipped).filter(f => f.endsWith('.md'));
        expect(files.length).toBeGreaterThan(0);
        const { getPost } = await import('../server/lib/posts.ts');
        for (const f of files) {
            const s = f.replace(/\.md$/, '');
            const p = getPost(shipped, s);
            expect(p, s).toBeTruthy();
            expect(typeof p!.content, `${s} content type`).toBe('string');
            // welcome may be short; still must be defined body after frontmatter
            expect(p!.content.length, `${s} empty body`).toBeGreaterThan(0);
        }
    });
});
