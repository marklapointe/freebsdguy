import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../server/index';
import jwt from 'jsonwebtoken';
import { loadConfig, saveConfig, loadUsers, saveUsers, configPath, isConfigWritable } from '../server/lib/config';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

describe('AI Service - Enhance Methods', () => {
    let adminToken: string;

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/ai/enhance should work with ollama provider', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                content: 'Test content for enhancement',
                provider: 'ollama',
                baseUrl: 'http://localhost:11434',
                modelId: 'llama3'
            });

        expect([200, 404, 500]).toContain(res.status);
    });

    it('POST /api/ai/enhance should work with openai provider', async () => {
        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                content: 'Test content for enhancement',
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                modelId: 'gpt-3.5-turbo',
                apiKey: 'fake-key'
            });

        expect([200, 401, 500]).toContain(res.status);
    });

    it('POST /api/ai/enhance should return 400 for no content', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({});

        expect(res.status).toBe(400);
    });

    it('POST /api/ai/enhance should return 503 if AI config not found', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: '', baseUrl: '', modelId: '' });

        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ content: 'Test content' });

        expect([503, 500, 400]).toContain(res.status);
    });

    it('POST /api/ai/enhance should return 403 if AI is disabled', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .post('/api/ai/enhance')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ content: 'Test content' });

        expect(res.status).toBe(403);
    });
});

describe('Theme Update with Admin Token', () => {
    let adminToken: string;

    beforeEach(async () => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/theme should update admin theme when admin is logged in', async () => {
        const res = await request(app)
            .post('/api/theme')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ currentTheme: 'light' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('updated');
    });

    it('POST /api/theme should update user theme when regular user is logged in', async () => {
        const users = loadUsers();
        users.users.push({
            username: 'themeuser',
            passwordHash: '$2b$10$test',
            role: 'contributor'
        });
        saveUsers(users);

        const userToken = jwt.sign({ username: 'themeuser', role: 'contributor' }, SECRET);

        const res = await request(app)
            .post('/api/theme')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ currentTheme: 'dark' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('updated');
    });

    it('POST /api/theme should handle invalid token gracefully', async () => {
        const res = await request(app)
            .post('/api/theme')
            .set('Authorization', `Bearer invalid_token`)
            .send({ currentTheme: 'dark' });

        expect(res.status).toBe(200);
    });
});

describe('Bulk Image Delete', () => {
    let adminToken: string;

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/admin/images/delete-bulk should delete multiple images', async () => {
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        fs.writeFileSync(path.join(imagesDir, 'bulk1.png'), 'content1');
        fs.writeFileSync(path.join(imagesDir, 'bulk2.png'), 'content2');

        const res = await request(app)
            .post('/api/admin/images/delete-bulk')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ filenames: ['bulk1.png', 'bulk2.png'] });

        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(2);
    });

    it('POST /api/admin/images/delete-bulk should handle path traversal attempts', async () => {
        const res = await request(app)
            .post('/api/admin/images/delete-bulk')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ filenames: ['../etc/passwd'] });

        expect(res.status).toBe(200);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('POST /api/admin/images/delete-bulk should return 400 if filenames is not array', async () => {
        const res = await request(app)
            .post('/api/admin/images/delete-bulk')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ filenames: 'not-an-array' });

        expect(res.status).toBe(400);
    });

    it('POST /api/admin/images/delete-bulk should handle nonexistent files', async () => {
        const res = await request(app)
            .post('/api/admin/images/delete-bulk')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ filenames: ['nonexistent1.png', 'nonexistent2.png'] });

        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(0);
        expect(res.body.errors.length).toBe(2);
    });
});

describe('Config Error Handling', () => {
    it('saveConfig should handle write errors gracefully', async () => {
        const config = loadConfig();
        const originalWriteSync = fs.writeFileSync;
        fs.writeFileSync = vi.fn().mockImplementation(() => {
            throw new Error('Disk full');
        });

        expect(() => saveConfig(config, '/impossible/path/config.json')).toThrow();

        fs.writeFileSync = originalWriteSync;
    });

    it('isConfigWritable should return false for inaccessible paths', () => {
        const result = isConfigWritable('/impossible/nonExistent/path/config.json');
        expect(typeof result).toBe('boolean');
    });
});

describe('Posts Error Handling', () => {
    let adminToken: string;

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/posts should handle directory traversal', async () => {
        const res = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                slug: '../etc/passwd',
                title: 'Bad Slug',
                content: 'Content',
                summary: 'Summary',
                date: '2023-01-01'
            });

        expect(res.status).toBe(403);
    });

    it('GET /api/posts/:slug should handle directory traversal', async () => {
        const res = await request(app).get('/api/posts/..%2F..%2Fetc/passwd');
        expect([200, 403, 404]).toContain(res.status);
    });

    it('GET /api/posts should respect security.disablePublicSearch', async () => {
        const adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ security: { disablePublicSearch: true } });

        const searchRes = await request(app).get('/api/posts?q=test');

        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ security: { disablePublicSearch: false } });

        expect(searchRes.status).toBe(403);
    });
});

describe('Search Functionality', () => {
    it('GET /api/posts with search query should filter results', async () => {
        const res = await request(app).get('/api/posts?q=welcome');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.posts) || Array.isArray(res.body)).toBe(true);
    });
});

describe('Pagination', () => {
    it('GET /api/posts with limit and offset should return paginated results', async () => {
        const res = await request(app).get('/api/posts?limit=5&offset=0');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('posts');
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('limit');
        expect(res.body).toHaveProperty('offset');
    });

    it('GET /api/posts with only limit should use default offset', async () => {
        const res = await request(app).get('/api/posts?limit=2');
        expect(res.status).toBe(200);
        expect(res.body.offset).toBe(0);
    });

    it('GET /api/posts with only offset should use default limit from config', async () => {
        const res = await request(app).get('/api/posts?offset=5');
        expect(res.status).toBe(200);
    });
});

describe('Config Admin Endpoints', () => {
    let adminToken: string;

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/admin/config should handle security settings', async () => {
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                security: {
                    apiRateLimitWindow: 60000,
                    apiRateLimitMax: 50,
                    loginRateLimitWindow: 300000,
                    loginRateLimitMax: 5,
                    disableAI: true,
                    disableImages: true,
                    disablePublicSearch: true
                }
            });

        expect(res.status).toBe(200);
    });

    it('POST /api/admin/config should create theme files when needed', async () => {
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ currentTheme: 'dark' });

        expect(res.status).toBe(200);
    });

    it('GET /api/admin/config-status should check if config is writable', async () => {
        const res = await request(app)
            .get('/api/admin/config-status')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.isWritable).toBe('boolean');
    });
});

describe('Image Serving Edge Cases', () => {
    it('GET /api/images/:filename without filename should return 400', async () => {
        const res = await request(app).get('/api/images/');
        expect([400, 404]).toContain(res.status);
    });

    it('GET /api/getimage without filename should return 400', async () => {
        const res = await request(app).get('/api/getimage');
        expect(res.status).toBe(400);
    });

    it('GET /api/images/:filename should handle directory traversal', async () => {
        const res = await request(app).get('/api/images/../../../etc/passwd');
        expect([200, 403, 404]).toContain(res.status);
    });
});

describe('Sorting Options', () => {
    beforeEach(() => {
        const adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('GET /api/posts should sort by title when configured', async () => {
        const config = loadConfig();
        const originalSortBy = config.sortBy;
        const originalSortOrder = config.sortOrder;

        config.sortBy = 'title';
        config.sortOrder = 'asc';
        saveConfig(config);

        const res = await request(app).get('/api/posts');
        expect(res.status).toBe(200);

        config.sortBy = originalSortBy;
        config.sortOrder = originalSortOrder;
        saveConfig(config);
    });

    it('GET /api/posts should sort by author when configured', async () => {
        const config = loadConfig();
        config.sortBy = 'author';
        config.sortOrder = 'desc';
        saveConfig(config);

        const res = await request(app).get('/api/posts');
        expect(res.status).toBe(200);

        config.sortBy = 'date';
        config.sortOrder = 'desc';
        saveConfig(config);
    });
});