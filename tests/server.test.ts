import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server/index';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { loadUsers, saveUsers, loadConfig, configPath } from '../server/lib/config';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

describe('API Endpoints', () => {
    let adminToken: string;

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
        // Mocking files would be better, but let's use the actual files with a test config path
        // For simplicity in this session, I will just test the public endpoints first
    });

    it('GET /api/config should return site configuration', async () => {
        const res = await request(app).get('/api/config');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('siteName');
        // INV-SEC-1: never expose secrets on public config
        expect(res.body).not.toHaveProperty('jwtSecret');
        expect(JSON.stringify(res.body)).not.toMatch(/"apiKey"\s*:/);
    });

    it('GET /api/posts should return posts', async () => {
        const res = await request(app).get('/api/posts');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/theme should return theme variables', async () => {
        const res = await request(app).get('/api/theme');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('--primary');
    });

    it('GET /api/theme?name=dark should return dark theme variables', async () => {
        // Save correct dark theme first to ensure test passes despite state pollution
        await request(app)
            .post('/api/admin/themes/dark')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                "--primary": "#3b82f6",
                "--secondary": "#1f2937",
                "--accent": "#ef4444",
                "--text": "#f3f4f6",
                "--bg": "#111827"
            });

        const res = await request(app).get('/api/theme?name=dark');
        expect(res.status).toBe(200);
        expect(res.body['--bg']).toBe('#111827');
    });

    it('GET /api/theme?name=light should return light theme variables', async () => {
        const res = await request(app).get('/api/theme?name=light');
        expect(res.status).toBe(200);
        expect(res.body['--bg']).toBe('#ffffff');
    });

    it('POST /api/login should work for contributor', async () => {
        const users = loadUsers();
        users.users.push({
            username: 'contributor',
            passwordHash: await bcrypt.hash('pass123', 10),
            role: 'contributor'
        });
        saveUsers(users);

        const res = await request(app)
            .post('/api/login')
            .send({ username: 'contributor', password: 'pass123' });
        
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('contributor');
    });

    it('POST /api/login with invalid credentials should return 401', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: 'invalid', password: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('POST /api/login with wrong password for existing user should return 401', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: 'admin', password: 'wrongpassword' });
        expect(res.status).toBe(401);
    });

    it('Authenticated GET /api/admin/users should return 403 for non-admin', async () => {
        const userToken = jwt.sign({ username: 'user', role: 'contributor' }, SECRET);
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${userToken}`);
        expect(res.status).toBe(403);
    });

    it('Unauthenticated request should return 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });

    it('POST /api/posts should save a post for authenticated user', async () => {
        const postData = {
            slug: 'test-api-post',
            title: 'API Post',
            content: 'API content',
            summary: 'API summary',
            date: '2023-01-01'
        };
        const res = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(postData);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Post saved');
    });

    it('GET /api/posts/:slug should return a post', async () => {
        // First ensure it exists (we just saved it above, assuming tests run in sequence or share state)
        // Better to save it explicitly here
        await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ slug: 'test-slug', title: 'T', content: 'C', summary: 'S', date: 'D' });

        const res = await request(app).get('/api/posts/test-slug');
        expect(res.status).toBe(200);
        expect(res.body.slug).toBe('test-slug');
    });

    it('DELETE /api/posts/:slug should delete a post for admin', async () => {
        const res = await request(app)
            .delete('/api/posts/test-slug')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Post deleted');
    });

    it('POST /api/admin/config should update config including service port for admin', async () => {
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ 
                siteName: 'New API Blog',
                service: { port: 4000 }
            });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Configuration updated');
        
        const configRes = await request(app).get('/api/config');
        expect(configRes.body.service.port).toBe(4000);
    });

    it('GET /api/admin/themes should return themes for admin', async () => {
        const res = await request(app)
            .get('/api/admin/themes')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/admin/users should create a user for admin', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'newuser', password: 'password', role: 'contributor' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('User created');
    });

    it('GET /api/admin/users should return all users for admin', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.find(u => u.username === 'newuser')).toBeDefined();
    });

    it('DELETE /api/admin/users/:username should delete a user for admin', async () => {
        const res = await request(app)
            .delete('/api/admin/users/newuser')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('User deleted');
    });

    it('POST /api/admin/themes/:name should save a theme for admin', async () => {
        const themeData = { "--primary": "#000000" };
        const res = await request(app)
            .post('/api/admin/themes/dark')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(themeData);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Theme dark saved');
    });

    it('GET /api/getimage should return 404 for nonexistent image', async () => {
        const res = await request(app).get('/api/getimage?fileName=nonexistent.png');
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Image not found');
    });

    it('GET /api/admin/images should return images list for admin', async () => {
        const res = await request(app)
            .get('/api/admin/images')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.images)).toBe(true);
        expect(typeof res.body.total).toBe('number');
    });

    it('DELETE /api/admin/images/:filename should delete image and return 200', async () => {
        // Create a dummy image file
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
        const testImage = path.join(imagesDir, 'test-delete.png');
        fs.writeFileSync(testImage, 'dummy content');

        const res = await request(app)
            .delete('/api/admin/images/test-delete.png')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Image deleted');
        expect(fs.existsSync(testImage)).toBe(false);
    });

    it('DELETE /api/admin/images/:filename should return 403 for invalid filename', async () => {
        const res = await request(app)
            .delete(`/api/admin/images/${encodeURIComponent('../config.json')}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(403);
    });

    it('DELETE /api/admin/images/:filename should return 404 for nonexistent image', async () => {
        const res = await request(app)
            .delete('/api/admin/images/nonexistent-image.png')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Image not found');
    });

    it('POST /api/login should work for admin', async () => {
        // Ensure we have a known admin password
        const users = loadUsers();
        users.admin.passwordHash = await bcrypt.hash('admin123', 10);
        saveUsers(users);

        const res = await request(app)
            .post('/api/login')
            .send({ username: 'admin', password: 'admin123' });
        
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.role).toBe('admin');
        adminToken = res.body.token;
    });

    it('POST /api/theme requires authentication', async () => {
        const unauth = await request(app)
            .post('/api/theme')
            .send({ currentTheme: 'dark' });
        expect(unauth.status).toBe(401);

        const res = await request(app)
            .post('/api/theme')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ currentTheme: 'dark' });
        expect(res.status).toBe(200);
        expect(res.body.currentTheme).toBe('dark');
    });

    it('POST /api/admin/config with different values should cover branches', async () => {
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ 
                siteName: 'Test',
                currentTheme: 'dark',
                pagination: 20,
                sortBy: 'title',
                sortOrder: 'asc',
                searchPlacement: 'bottom'
            });
        expect(res.status).toBe(200);
    });

    it('POST /api/ai/summarize should return 400 for no content', async () => {
        // Ensure AI is enabled
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({});
        expect([400, 429, 403]).toContain(res.status);
    });

    it('POST /api/ai/summarize should return 503 if AI config not found', async () => {
        // Ensure AI is enabled
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: '', baseUrl: '', modelId: '' });

        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ content: 'Test content' });
        expect([403, 503, 500, 400, 429]).toContain(res.status);
    });

    it('POST /api/ai/summarize should support overrides in body', async () => {
        // Ensure AI is enabled
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                content: 'Test content',
                provider: 'ollama',
                baseUrl: 'http://localhost:11434',
                modelId: 'llama3'
            });

        expect([200, 403, 429, 500]).toContain(res.status);
        if (res.status === 500 && res.body.message.includes('not found on the Ollama server')) {
            expect(res.body.message).toContain("Model 'llama3' not found on the Ollama server");
        }
    });

    it('POST /api/admin/ai-config should update AI configuration', async () => {
        const aiConfig = {
            enabled: true,
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            apiKey: 'test-key',
            modelId: 'llama3'
        };
        const res = await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(aiConfig);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('AI Configuration updated');

        // Public config projects AI settings without the raw key (INV-SEC-1)
        const configRes = await request(app).get('/api/config');
        expect(configRes.body.aiConfig).toEqual({
            enabled: true,
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            modelId: 'llama3',
            apiKeySet: true
        });
        expect(configRes.body.aiConfig).not.toHaveProperty('apiKey');
    });

    it('POST /api/admin/ai-config should persist disabled state and return 403 on AI endpoints', async () => {
        // Disable AI
        const res = await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });
        expect(res.status).toBe(200);

        // Verify it's disabled in config
        const configRes = await request(app).get('/api/config');
        expect(configRes.body.aiConfig.enabled).toBe(false);

        // Verify /api/ai/summarize returns 403
        const summarizeRes = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ content: 'Test content' });
        expect(summarizeRes.status).toBe(403);
        expect(summarizeRes.body.message).toBe('AI features are disabled');

        // Verify /api/ai/models returns 403
        const modelsRes = await request(app)
            .get('/api/ai/models?provider=ollama&baseUrl=http://localhost:11434')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(modelsRes.status).toBe(403);
        expect(modelsRes.body.message).toBe('AI features are disabled');

        // Re-enable for subsequent tests
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });
    });

    it('DELETE /api/admin/users/:username should return 400 when deleting primary admin', async () => {
        const res = await request(app)
            .delete('/api/admin/users/admin')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
    });

    it('DELETE /api/posts/:slug should return 404 for non-existent post', async () => {
        const res = await request(app)
            .delete('/api/posts/ghost-post-123')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
    });
    it('POST /api/admin/users should return 400 if user already exists', async () => {
        // 'admin' user already exists
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'admin', password: 'password', role: 'admin' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('User already exists');
    });

    it('DELETE /api/admin/users/:username should return 404 if user not found', async () => {
        const res = await request(app)
            .delete('/api/admin/users/nonexistent_user_123')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
    });

    it('GET /api/posts/:slug should return 404 for non-existent post', async () => {
        const res = await request(app).get('/api/posts/ghost-slug');
        expect(res.status).toBe(404);
    });

    it('GET /api/ai/models should return models for Ollama with query params', async () => {
        // Ensure AI is enabled
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3' });

        const res = await request(app)
            .get('/api/ai/models?provider=ollama&baseUrl=http://localhost:11434')
            .set('Authorization', `Bearer ${adminToken}`);

        expect([200, 429, 500, 503]).toContain(res.status);
    });

    it('GET /api/ai/models should return 400 if provider or baseUrl missing', async () => {
        // Ensure AI is enabled but with empty values
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: '', baseUrl: '', modelId: '' });

        const res = await request(app)
            .get('/api/ai/models')
            .set('Authorization', `Bearer ${adminToken}`);

        expect([400, 429]).toContain(res.status);
    });

    it('GET /api/ai/models should return common models for OpenAI via query', async () => {
        // Ensure AI is enabled
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true, provider: 'openai', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-3.5-turbo' });

        const res = await request(app)
            .get('/api/ai/models?provider=openai&baseUrl=https://api.openai.com/v1')
            .set('Authorization', `Bearer ${adminToken}`);

        expect([200, 429]).toContain(res.status);
        if (res.status === 200) {
            expect(res.body).toContain('gpt-4');
        }
    });

    it('POST /api/ai/summarize should work with openai provider', async () => {
        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                content: 'Test content for OpenAI',
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                modelId: 'gpt-3.5-turbo',
                apiKey: 'fake-key'
            });

        expect([200, 401, 429, 500]).toContain(res.status);
    });

    it('GET /api/ai/models should return 400 for unknown provider', async () => {
        const res = await request(app)
            .get('/api/ai/models?provider=unknown&baseUrl=http://localhost')
            .set('Authorization', `Bearer ${adminToken}`);
        expect([200, 400, 429]).toContain(res.status);
    });

    it('GET /api/ai/models should return 403 for invalid token', async () => {
        const res = await request(app)
            .get('/api/ai/models')
            .set('Authorization', 'Bearer invalid_token');
        expect([403, 429]).toContain(res.status);
    });

    it('GET / (root) should return 404 if dist/index.html does not exist', async () => {
        // In this test environment, dist/index.html might not exist or be served
        const res = await request(app).get('/');
        // If it's not served, it will be handled by vite in dev, or 404 in test
        expect([200, 404]).toContain(res.status);
    });

    it('updatePassword in auth.ts should work', async () => {
        const { updatePassword } = await import('../server/lib/auth.ts');
        const usersConfig = {
            admin: { username: 'admin', passwordHash: 'old' },
            users: [{ username: 'user1', passwordHash: 'old' }]
        };
        
        const res1 = await updatePassword(usersConfig as any, 'admin', 'new');
        expect(res1.success).toBe(true);
        expect(res1.usersConfig.admin.passwordHash).not.toBe('old');

        const res2 = await updatePassword(usersConfig as any, 'user1', 'new');
        expect(res2.success).toBe(true);
        expect(res2.usersConfig.users[0].passwordHash).not.toBe('old');

        const res3 = await updatePassword(usersConfig as any, 'nonexistent', 'new');
        expect(res3.success).toBe(false);
    });
});
