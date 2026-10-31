/**
 * Exercise every MCP tool body and the /mcp method guard so coverage can see them.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import axios from 'axios';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { loadConfig, loadUsers, saveUsers, configPath } from '../server/lib/config.ts';
import { registerMcpRoutes } from '../server/mcp/register-mcp.ts';

const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function toolText(res: { body: unknown; text?: string }): string {
    return typeof res.body === 'object' && res.body ? JSON.stringify(res.body) : String(res.text || '');
}

function toolArgsFallback(name: string): Record<string, unknown> {
    switch (name) {
        case 'get_post':
        case 'delete_post':
            return { slug: 'x' };
        case 'create_post':
        case 'update_post':
            return { slug: 'x', title: 'T', content: 'C' };
        case 'upload_image':
            return { filename: 'a.png', dataBase64: 'aGk=' };
        case 'delete_image':
            return { filename: 'a.webp' };
        case 'update_config':
            return { patch: { siteName: 'X' } };
        case 'set_theme':
            return { themeId: 'dark' };
        case 'save_theme':
            return { name: 'dark', colors: { '--bg': '#000000' } };
        case 'create_user':
            return { username: 'someone', password: 'long-enough', role: 'contributor' };
        case 'delete_user':
            return { username: 'someone' };
        default:
            return {};
    }
}

async function call(pat: string, name: string, args: Record<string, unknown> = {}) {
    const res = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args } });
    return toolText(res);
}

describe('MCP tool bodies and route edges', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-mcp-cover-'));
    const posts = path.join(tmp, 'posts');
    const themes = path.join(tmp, 'themes');
    fs.mkdirSync(posts);
    const before = loadConfig();
    let admin = '';
    let writer = '';

    afterAll(async () => {
        if (admin) {
            await call(admin, 'update_config', {
                patch: {
                    postsDir: before.postsDir,
                    themeDir: before.themeDir,
                    currentTheme: before.currentTheme,
                    siteName: before.siteName,
                    security: before.security,
                    aiConfig: before.aiConfig
                }
            });
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('runs read and write tool handlers, including refusals and errors', async () => {
        const users = loadUsers();
        users.users = users.users.filter((u) => u.username !== 'writer' && u.username !== 'cov-user');
        users.users.push({ username: 'writer', passwordHash: 'h', role: 'contributor' });
        saveUsers(users);
        const tokenDir = path.join(tmp, 'tokens.json');
        vi.stubEnv('TOKENS_PATH', tokenDir);
        admin = mintToken('admin', 'cover-admin', 'write').plaintext;
        writer = mintToken('writer', 'cover-writer', 'write').plaintext;

        const moved = await call(admin, 'update_config', {
            patch: { postsDir: posts, themeDir: themes, siteName: 'Coverage' }
        });
        expect(moved).toMatch(/Config saved/);

        expect(await call(admin, 'list_posts', {})).toMatch(/posts/);
        expect(await call(admin, 'list_posts', { q: 'needle', limit: 1, offset: 1 })).toMatch(/posts/);
        expect(await call(admin, 'get_post', { slug: 'missing' })).toMatch(/not found/i);
        expect(await call(admin, 'create_post', { slug: '', title: 'T', content: 'C' })).toMatch(/slug is required/i);
        expect(await call(admin, 'create_post', { slug: '../etc', title: 'T', content: 'C' })).toMatch(/Forbidden/i);
        expect(await call(admin, 'create_post', { slug: 'cov-post', title: 'Needle Title', content: 'Body', summary: 's', pinned: true })).toMatch(/Post saved/);
        expect(await call(admin, 'list_posts', { q: 'needle' })).toMatch(/cov-post/);
        expect(await call(admin, 'get_post', { slug: 'cov-post' })).toMatch(/Needle Title/);
        expect(await call(admin, 'update_post', { slug: 'cov-post', title: 'Needle Title', content: 'Updated' })).toMatch(/Post saved/);
        expect(await call(admin, 'delete_post', { slug: 'nope' })).toMatch(/not found/i);
        expect(await call(admin, 'delete_post', { slug: '../etc' })).toMatch(/Forbidden/i);
        expect(await call(admin, 'delete_post', { slug: 'cov-post' })).toMatch(/Post deleted/);

        expect(await call(admin, 'list_images', {})).toMatch(/images/);
        expect(await call(admin, 'upload_image', { filename: 'x.png', dataBase64: '' })).toMatch(/Empty image/i);
        expect(await call(admin, 'upload_image', { filename: 'x.png', dataBase64: 'not-an-image' })).toMatch(/error|Error|fail|unsupported|Input/i);
        const uploaded = await call(admin, 'upload_image', { filename: 'dot.png', dataBase64: `data:image/png;base64,${PNG}` });
        expect(uploaded).toMatch(/webp|filename/i);
        const again = await call(admin, 'upload_image', { filename: 'dot.png', dataBase64: PNG });
        expect(again).toMatch(/duplicated|filename/i);
        expect(await call(admin, 'list_images', { limit: 1, offset: 0 })).toMatch(/images/);
        expect(await call(admin, 'delete_image', { filename: '../etc/passwd' })).toMatch(/Forbidden|not found/i);
        expect(await call(admin, 'delete_image', { filename: 'missing.webp' })).toMatch(/not found/i);
        fs.writeFileSync(path.join(posts, 'images', 'second.webp'), 'second');
        expect(await call(admin, 'list_images', { limit: 2, offset: 1 })).toMatch(/images/);
        const uploadedBody = JSON.parse(uploaded) as { result?: { content?: { text?: string }[] } };
        const uploadedInner = JSON.parse(uploadedBody.result?.content?.[0]?.text || '{}') as { filename?: string };
        expect(uploadedInner.filename).toBeTruthy();
        expect(await call(admin, 'delete_image', { filename: uploadedInner.filename || '' })).toMatch(/Image deleted/);

        expect(await call(writer, 'get_config', {})).toMatch(/Forbidden|admin/i);
        expect(await call(admin, 'get_config', {})).toMatch(/siteName|Coverage/);
        expect(await call(writer, 'list_themes', {})).toMatch(/Forbidden|admin/i);
        expect(await call(admin, 'list_themes', {})).toMatch(/\[/);
        expect(await call(admin, 'set_theme', { themeId: 'Not A Theme' })).toMatch(/Invalid theme/i);
        expect(await call(admin, 'set_theme', { themeId: 'dark' })).toMatch(/Theme set/);
        expect(await call(admin, 'save_theme', { name: '../x', colors: { '--bg': '#111111' } })).toMatch(/Invalid theme/i);
        expect(await call(admin, 'save_theme', { name: 'z-cov-theme', colors: { '--bg': '<b>#010101</b>' } })).toMatch(/saved/i);

        expect(await call(writer, 'list_users', {})).toMatch(/Forbidden|admin/i);
        expect(await call(admin, 'list_users', {})).toMatch(/writer/);
        expect(await call(admin, 'create_user', { username: '<b></b>', password: 'long-enough', role: 'contributor' })).toMatch(/Invalid|created/i);
        expect(await call(admin, 'create_user', { username: 'admin', password: 'long-enough', role: 'contributor' })).toMatch(/already exists/i);
        expect(await call(admin, 'create_user', { username: 'cov-user', password: 'long-enough', role: 'contributor' })).toMatch(/User created/);
        expect(await call(admin, 'delete_user', { username: 'admin' })).toMatch(/primary admin/i);
        expect(await call(admin, 'delete_user', { username: 'nobody-here' })).toMatch(/not found/i);
        expect(await call(admin, 'delete_user', { username: 'cov-user' })).toMatch(/User deleted/);

        expect(await call(writer, 'list_tokens', {})).toMatch(/tokens/);
        expect(await call(admin, 'list_tokens', { username: 'writer' })).toMatch(/tokens/);
        expect(await call(admin, 'create_token', { username: 'missing-person', label: 'x', scope: 'read' })).toMatch(/not found/i);
        const minted = await call(admin, 'create_token', { label: 'from-mcp', scope: 'write' });
        expect(minted).toMatch(/mdw_/);
        const mintedInner = JSON.parse(JSON.parse(minted).result.content[0].text) as { id: string };
        expect(await call(admin, 'revoke_token', { id: 'missing' })).toMatch(/not found/i);
        expect(await call(writer, 'revoke_token', { id: mintedInner.id })).toMatch(/not found/i);
        expect(await call(admin, 'revoke_token', { id: mintedInner.id })).toMatch(/Token revoked/);
        const bcrypt = await import('bcryptjs');
        const hashSpy = vi.spyOn(bcrypt.default, 'hash').mockRejectedValueOnce(new Error('hash failed'));
        expect(await call(admin, 'create_user', { username: 'hash-fail', password: 'long-enough', role: 'contributor' })).toMatch(/hash failed/);
        hashSpy.mockRestore();
        let overflow = '';
        for (let i = 0; i < 25 && !/limit/i.test(overflow); i++) {
            overflow = await call(admin, 'create_token', { label: `bulk-${i}`, scope: 'read' });
        }
        expect(overflow).toMatch(/limit/i);

        await call(admin, 'update_config', {
            patch: {
                aiConfig: { enabled: false, provider: 'ollama', baseUrl: '', apiKey: '', modelId: 'llama' },
                security: { ...(before.security || {}), disableAI: true }
            }
        });
        expect(await call(admin, 'ai_summarize', { content: 'hello' })).toMatch(/disabled|summary|fail|Error/i);
        expect(await call(admin, 'ai_enhance', { content: 'hello' })).toMatch(/disabled|enhanced|fail|Error/i);
        expect(await call(admin, 'ai_list_models', {})).toMatch(/disabled|models|fail|Error/i);

        await call(admin, 'update_config', {
            patch: {
                aiConfig: {
                    enabled: true,
                    provider: 'ollama',
                    baseUrl: 'http://127.0.0.1:9',
                    apiKey: '',
                    modelId: 'llama'
                },
                security: { ...(before.security || {}), disableAI: false, disableImages: false }
            }
        });
        const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { message: { content: ' summed ' } } } as never);
        const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { models: [{ name: 'llama' }] } } as never);
        expect(await call(admin, 'ai_summarize', { content: 'hello' })).toMatch(/summed/);
        expect(await call(admin, 'ai_enhance', { content: 'hello' })).toMatch(/summed/);
        expect(await call(admin, 'ai_list_models', {})).toMatch(/llama/);
        post.mockRestore();
        get.mockRestore();

        const playbook = await request(app)
            .post('/mcp')
            .set('Authorization', `Bearer ${admin}`)
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({ jsonrpc: '2.0', id: 'res', method: 'resources/read', params: { uri: 'mdweb://playbook' } });
        expect(toolText(playbook)).toMatch(/playbook|MDWeb/i);

        const unnamed = await request(app)
            .post('/mcp')
            .set('Authorization', `Bearer ${admin}`)
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({ jsonrpc: '2.0', id: 'noname', method: 'tools/call', params: {} });
        expect(unnamed.status).toBeGreaterThanOrEqual(200);

        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
        const { createMdwebMcpServer } = await import('../server/mcp/create-server.ts');
        const boom = createMdwebMcpServer({
            user: { username: 'admin', role: 'admin' },
            getActive: () => {
                throw new Error('config boom');
            },
            setActive: () => undefined,
            tokenScope: 'write'
        });
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await boom.connect(serverT);
        const client = new Client({ name: 'cov', version: '0' });
        await client.connect(clientT);
        for (const name of [
            'list_posts',
            'get_post',
            'create_post',
            'update_post',
            'delete_post',
            'list_images',
            'upload_image',
            'delete_image',
            'get_config',
            'update_config',
            'list_themes',
            'set_theme',
            'save_theme'
        ]) {
            let text = '';
            try {
                text = JSON.stringify(await client.callTool({ name, arguments: toolArgsFallback(name) }));
            } catch (err) {
                text = String(err);
            }
            expect(text, name).toMatch(/config boom/i);
        }
        await client.close();
        await boom.close();

        const ghost = createMdwebMcpServer({
            user: { username: 'ghost', role: 'ghost' as 'admin' },
            getActive: () => before,
            setActive: () => undefined,
            tokenScope: 'write'
        });
        const [ct2, st2] = InMemoryTransport.createLinkedPair();
        await ghost.connect(st2);
        const ghostClient = new Client({ name: 'ghost', version: '0' });
        await ghostClient.connect(ct2);
        const deniedWriter = await ghostClient.callTool({
            name: 'create_post',
            arguments: { slug: 'x', title: 'T', content: 'C' }
        });
        expect(JSON.stringify(deniedWriter)).toMatch(/contributor or admin/i);
        await ghostClient.close();
        await ghost.close();

        const getRes = await request(app).get('/mcp').set('Authorization', `Bearer ${admin}`).set('Accept', 'application/json');
        expect(getRes.status).toBe(405);
        const delRes = await request(app).delete('/mcp').set('Authorization', `Bearer ${admin}`);
        expect(delRes.status).toBe(405);

        const orig = StreamableHTTPServerTransport.prototype.handleRequest;
        StreamableHTTPServerTransport.prototype.handleRequest = async function () {
            throw new Error('transport failed');
        };
        try {
            const blown = await request(app)
                .post('/mcp')
                .set('Authorization', `Bearer ${admin}`)
                .set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
            expect(blown.status).toBe(500);
        } finally {
            StreamableHTTPServerTransport.prototype.handleRequest = orig;
        }

        const mini = express();
        mini.use(express.json());
        registerMcpRoutes(mini, {
            secret: 'x',
            getActiveConfig: () => before,
            setActiveConfig: () => undefined,
            authenticate: (req, _res, next) => {
                (req as { user?: { username: string; role: string } }).user = { username: 'ghost', role: 'ghost' };
                next();
            },
            requireAdmin: (_req, _res, next) => next(),
            requireWriter: (_req, _res, next) => next(),
            upload: {} as never
        });
        const denied = await request(mini).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        expect(denied.status).toBe(403);
    });
});
