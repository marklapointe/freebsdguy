/**
 * MCP Streamable HTTP — initialize + tools with PAT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { loadUsers, saveUsers } from '../server/lib/config.ts';

async function mcpCall(pat: string, body: unknown) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
}

describe('MCP /mcp', () => {
    let dir: string;
    let adminPat: string;
    let writerPat: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-mcp-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
        const users = loadUsers();
        users.users = users.users.filter((u) => u.username !== 'writer');
        users.users.push({ username: 'writer', passwordHash: 'h', role: 'contributor' });
        saveUsers(users);
        adminPat = mintToken('admin', 'mcp-admin').plaintext;
        writerPat = mintToken('writer', 'mcp-writer').plaintext;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects unauthenticated MCP', async () => {
        const res = await request(app).post('/mcp').send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' }
            }
        });
        expect(res.status).toBe(401);
    });

    it('initialize + tools/list with admin PAT', async () => {
        const init = await mcpCall(adminPat, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'vitest', version: '1.0.0' }
            }
        });
        expect(init.status).toBe(200);
        const initBody = typeof init.body === 'object' ? init.body : JSON.parse(init.text);
        expect(initBody.result?.serverInfo?.name || initBody.result?.serverInfo).toBeTruthy();

        const tools = await mcpCall(adminPat, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
        });
        expect(tools.status).toBe(200);
        const toolsBody = typeof tools.body === 'object' ? tools.body : JSON.parse(tools.text);
        const names = (toolsBody.result?.tools || []).map((t: { name: string }) => t.name);
        expect(names).toContain('list_posts');
        expect(names).toContain('get_config');
        expect(names).toContain('get_playbook');
    });

    it('contributor can create_post; forbidden on get_config', async () => {
        const create = await mcpCall(writerPat, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'create_post',
                arguments: {
                    slug: 'mcp-test-post',
                    title: 'MCP Test',
                    content: 'Hello from MCP',
                    summary: 'sum'
                }
            }
        });
        expect(create.status).toBe(200);
        const createBody = typeof create.body === 'object' ? create.body : JSON.parse(create.text);
        const createText = JSON.stringify(createBody);
        expect(createText).toMatch(/Post saved|mcp-test-post/);

        const cfg = await mcpCall(writerPat, {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'get_config', arguments: {} }
        });
        expect(cfg.status).toBe(200);
        const cfgBody = typeof cfg.body === 'object' ? cfg.body : JSON.parse(cfg.text);
        expect(JSON.stringify(cfgBody)).toMatch(/Forbidden|isError|admin required/i);
    });
});
