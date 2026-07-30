import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { app } from '../server/index.ts';
import { loadUsers, saveUsers, loadConfig, saveConfig } from '../server/lib/config.ts';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

describe('AI settings API', () => {
    let adminToken: string;

    beforeEach(async () => {
        const users = loadUsers();
        users.admin.passwordHash = await bcrypt.hash('admin-ai-test', 10);
        users.users = [];
        saveUsers(users);
        adminToken = jwt.sign({ username: users.admin.username, role: 'admin' }, SECRET);

        const config = loadConfig();
        config.aiConfig = {
            enabled: false,
            provider: 'ollama',
            baseUrl: 'http://127.0.0.1:11434',
            apiKey: 'secret-key-do-not-leak',
            modelId: 'llama3'
        };
        if (config.security) config.security.disableAI = false;
        saveConfig(config);
    });

    it('admin can enable AI and set provider/baseUrl/model', async () => {
        const res = await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                enabled: true,
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-test-new',
                modelId: 'gpt-4o-mini'
            });
        expect(res.status).toBe(200);

        const cfg = loadConfig();
        expect(cfg.aiConfig?.enabled).toBe(true);
        expect(cfg.aiConfig?.provider).toBe('openai');
        expect(cfg.aiConfig?.baseUrl).toBe('https://api.openai.com/v1');
        expect(cfg.aiConfig?.modelId).toBe('gpt-4o-mini');
        expect(cfg.aiConfig?.apiKey).toBe('sk-test-new');
    });

    it('empty apiKey on save keeps previous key', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                enabled: true,
                provider: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                apiKey: '',
                modelId: 'llama3'
            });
        const cfg = loadConfig();
        expect(cfg.aiConfig?.apiKey).toBe('secret-key-do-not-leak');
    });

    it('public config never exposes apiKey after AI save', async () => {
        await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                enabled: true,
                provider: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                apiKey: 'sk-should-not-appear',
                modelId: 'llama3'
            });
        const pub = await request(app).get('/api/config');
        expect(pub.status).toBe(200);
        expect(JSON.stringify(pub.body)).not.toMatch(/"apiKey"\s*:/);
        expect(pub.body.aiConfig?.apiKeySet).toBe(true);
        expect(pub.body.aiConfig?.enabled).toBe(true);
    });

    it('non-admin cannot update AI config', async () => {
        const users = loadUsers();
        users.users = [{ username: 'contrib', passwordHash: await bcrypt.hash('x', 10), role: 'contributor' }];
        saveUsers(users);
        const token = jwt.sign({ username: 'contrib', role: 'contributor' }, SECRET);
        const res = await request(app)
            .post('/api/admin/ai-config')
            .set('Authorization', `Bearer ${token}`)
            .send({ enabled: true, provider: 'ollama', baseUrl: 'x', modelId: 'y' });
        expect(res.status).toBe(403);
    });

    it('summarize returns 403 when AI disabled', async () => {
        const res = await request(app)
            .post('/api/ai/summarize')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ content: 'hello world' });
        expect(res.status).toBe(403);
    });
});
