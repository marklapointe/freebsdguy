// Track #1701 Adversary F9: tools/list must only show tools the caller may run.
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMdwebMcpServer } from '../server/mcp/create-server.ts';
import { defaultConfig } from '../server/lib/config.ts';

async function connect(role: 'admin' | 'contributor', tokenScope?: 'read' | 'write') {
    const cfg = defaultConfig();
    const server = createMdwebMcpServer({
        user: { username: 'u-' + role, role },
        getActive: () => cfg,
        setActive: () => undefined,
        ...(tokenScope ? { tokenScope } : {})
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}
const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();
const ADMIN_ONLY = ['get_config', 'update_config', 'list_themes', 'set_theme', 'save_theme', 'list_users', 'create_user', 'delete_user'];

describe('F9: tools/list is filtered by token scope and role', () => {
    it('contributor + read token: only read tools it may run', async () => {
        expect(await names(await connect('contributor', 'read'))).toEqual(
            ['get_playbook', 'get_post', 'health', 'list_images', 'list_posts']);
    });
    it('admin + read token: read tools incl. list_themes', async () => {
        expect(await names(await connect('admin', 'read'))).toEqual(
            ['get_playbook', 'get_post', 'health', 'list_images', 'list_posts', 'list_themes']);
    });
    it('contributor + write token: writer tools, no admin-only tools', async () => {
        const n = await names(await connect('contributor', 'write'));
        for (const t of ['create_post', 'update_post', 'delete_post', 'upload_image', 'delete_image', 'ai_summarize']) expect(n).toContain(t);
        for (const t of ADMIN_ONLY) expect(n).not.toContain(t);
    });
    it('admin session (no token scope): every tool', async () => {
        const n = await names(await connect('admin'));
        expect(n.length).toBeGreaterThanOrEqual(24);
        for (const t of [...ADMIN_ONLY, 'create_token', 'revoke_token', 'list_tokens']) expect(n).toContain(t);
    });
    it('a hidden tool still cannot be called', async () => {
        const c = await connect('contributor', 'read');
        const r: any = await c.callTool({ name: 'update_config', arguments: {} }).catch((e) => ({ isError: true, e }));
        expect(r.isError).toBe(true);
    });
});

