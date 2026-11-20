/**
 * Track 2119 U3: a personal access token holds a set of scopes, not one.
 * Least privilege: read, content:write, publish, moderate, admin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMdwebMcpServer } from '../server/mcp/create-server.ts';
import { defaultConfig } from '../server/lib/config.ts';
import { listTokensForUser, mintToken } from '../server/lib/api-tokens.ts';
import { parseMintTokenArgs } from '../server/lib/mint-token-cli.ts';
import {
    LEGACY_WRITE_SCOPES,
    legacyScopeLabel,
    parseTokenScopes,
    requiredScopeForTool,
    storedTokenScopes,
    tokenAllowsTool,
    type TokenScopes
} from '../server/lib/token-scope.ts';
import { app } from '../server/index.ts';

const ALL_SCOPES = ['read', 'content:write', 'publish', 'moderate', 'admin'];

/** Every scope name the CLI accepts, legacy "write" included. */
const ACCEPTED_SCOPE_NAMES = ['read', 'content:write', 'publish', 'moderate', 'admin', 'write'];

/**
 * The scope names a message lists after "--scope ". Split on the separators so
 * "write" is counted as a name of its own and not as the tail of "content:write".
 */
function scopeNamesIn(message: string): string[] {
    const m = message.match(/--scope ([^)\]\[]+)/);
    if (!m) return [];
    return m[1].split(/[|,\s]+/).filter(Boolean);
}

async function connect(role: 'admin' | 'contributor', tokenScopes?: TokenScopes): Promise<Client> {
    const cfg = defaultConfig();
    const server = createMdwebMcpServer({
        user: { username: 'u-' + role, role },
        getActive: () => cfg,
        setActive: () => undefined,
        ...(tokenScopes ? { tokenScopes } : {})
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scopes', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}

const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
    try {
        return await c.callTool({ name, arguments: args });
    } catch (e) {
        return { isError: true, text: String(e) };
    }
};

describe('token scope sets', () => {
    it('parses one name, a comma list and an array', () => {
        expect(parseTokenScopes('read')).toEqual(['read']);
        expect(parseTokenScopes('write')).toEqual(ALL_SCOPES);
        expect(parseTokenScopes('read,content:write')).toEqual(['read', 'content:write']);
        expect(parseTokenScopes(['publish'])).toEqual(['read', 'publish']);
        expect(() => parseTokenScopes('bogus')).toThrow(/Invalid token scope/);
        expect(parseTokenScopes('')).toEqual(['read']);
    });

    it('maps a stored record onto scopes', () => {
        expect(storedTokenScopes({ scope: 'write' })).toEqual(ALL_SCOPES);
        expect(storedTokenScopes({})).toEqual(['read']);
        expect(storedTokenScopes({ scopes: ['read', 'moderate'] })).toEqual(['read', 'moderate']);
    });

    it('treats a tool without a mapping as admin-only', () => {
        expect(requiredScopeForTool('not_a_mapped_tool')).toBe('admin');
        expect(tokenAllowsTool(['read', 'content:write'], 'not_a_mapped_tool')).toBe(false);
        expect(tokenAllowsTool(['read', 'admin'], 'not_a_mapped_tool')).toBe(true);
    });

    it('maps the publish tools to their scopes', () => {
        // publish_post publishes a draft, unpublish_post moderates one.
        expect(requiredScopeForTool('publish_post')).toBe('publish');
        expect(requiredScopeForTool('unpublish_post')).toBe('moderate');
        expect(tokenAllowsTool(['read', 'content:write'], 'publish_post')).toBe(false);
        expect(tokenAllowsTool(['read', 'publish'], 'publish_post')).toBe(true);
        expect(tokenAllowsTool(['read', 'publish'], 'unpublish_post')).toBe(false);
        expect(tokenAllowsTool(['read', 'moderate'], 'unpublish_post')).toBe(true);
    });
});

describe('the legacy scope label is honest', () => {
    it('labels the full scope set write, in any order', () => {
        expect(legacyScopeLabel([...LEGACY_WRITE_SCOPES])).toBe('write');
        expect(legacyScopeLabel(['admin', 'moderate', 'publish', 'content:write', 'read'])).toBe('write');
    });

    it('labels a narrower scope set read', () => {
        // "write" is the legacy name for every capability, so a token that does
        // not hold every capability must not be labelled "write".
        expect(legacyScopeLabel(['read', 'content:write'])).toBe('read');
        expect(legacyScopeLabel(['read', 'admin'])).toBe('read');
        expect(legacyScopeLabel(['read'])).toBe('read');
    });
});

describe('a minted token', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-mint-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
        vi.stubEnv('USERS_PATH', path.join(dir, 'users.json'));
        // The admin user has to exist on disk, or mintToken refuses to mint.
        fs.writeFileSync(
            path.join(dir, 'users.json'),
            JSON.stringify({
                admin: { username: 'admin', passwordHash: 'not-empty-hash', role: 'admin' },
                users: []
            })
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the scopes next to the legacy scope on the record', () => {
        const { record } = mintToken('admin', 'scoped', ['read', 'content:write']);
        expect(record.scopes).toEqual(['read', 'content:write']);
        // The legacy label is display only, and must not overstate: this token
        // does not hold every capability, so it is not a "write" token.
        expect(record.scope).toBe('read');
    });

    it('labels a narrow token read and keeps its real scopes', () => {
        const args = parseMintTokenArgs([
            'node',
            'mint-token',
            '--username',
            'admin',
            '--scope',
            'content:write'
        ]);
        const { record } = mintToken('admin', 'scoped', args.scope);
        expect(record.scope).toBe('read');
        expect(record.scopes).toContain('content:write');
        expect(record.scopes).not.toContain('admin');

        const [publicRecord] = listTokensForUser('admin');
        expect(publicRecord.scope).toBe('read');
        expect(publicRecord.scopes).toContain('content:write');
        expect(publicRecord.scopes).not.toContain('admin');
    });

    it('keeps the legacy write label for a full-power token', () => {
        const { record } = mintToken('admin', 'legacy', parseTokenScopes('write'));
        expect(record.scope).toBe('write');
        expect(record.scopes).toEqual(ALL_SCOPES);
    });

    it('writes the token into its own store', () => {
        const { plaintext } = mintToken('admin', 'scoped', ['read', 'content:write']);
        const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
        expect(onDisk).toHaveLength(1);
        expect(onDisk[0].username).toBe('admin');
        expect(onDisk[0].hash).not.toBe(plaintext);
    });
});

describe('MCP tools are scoped', () => {
    it('lists only the tools the scopes cover', async () => {
        const n = await names(await connect('contributor', ['read', 'content:write', 'publish']));
        expect(n).toContain('create_post');
        expect(n).toContain('update_post');
        expect(n).toContain('upload_image');
        expect(n).toContain('delete_post');
        expect(n).not.toContain('delete_image');
        for (const t of ['get_config', 'update_config', 'list_users', 'list_tokens', 'create_token']) {
            expect(n).not.toContain(t);
        }
    });

    it('names the scope a call is missing', async () => {
        const c = await connect('contributor', ['read', 'content:write', 'publish']);
        const r = await call(c, 'delete_image', { filename: 'x.webp' });
        expect(JSON.stringify(r)).toMatch(/Token lacks scope moderate/);
    });

    it('hides the admin tools from an admin role without the admin scope', async () => {
        const c = await connect('admin', ['read', 'content:write']);
        const n = await names(c);
        for (const t of ['get_config', 'update_config', 'set_theme', 'list_users', 'list_tokens']) {
            expect(n).not.toContain(t);
        }
        const r = await call(c, 'update_config', { patch: {} });
        expect(JSON.stringify(r)).toMatch(/Token lacks scope admin/);
    });

    it('keeps a legacy write token as powerful as it was', async () => {
        const n = await names(await connect('contributor', LEGACY_WRITE_SCOPES));
        for (const t of [
            'get_playbook', 'health', 'list_posts', 'get_post', 'list_images',
            'create_post', 'update_post', 'delete_post', 'upload_image', 'delete_image',
            'ai_summarize', 'ai_enhance', 'ai_list_models'
        ]) {
            expect(n).toContain(t);
        }
        for (const t of ['get_config', 'update_config', 'list_themes', 'set_theme', 'list_users']) {
            expect(n).not.toContain(t);
        }
    });

    it('refuses to mint a token that is stronger than the caller', async () => {
        const c = await connect('admin', ['read', 'content:write']);
        const r = await call(c, 'create_token', { label: 'x', scope: 'admin' });
        expect(JSON.stringify(r)).toMatch(/Token lacks scope admin/);

        const withAdmin = await connect('admin', ['read', 'admin']);
        const r2 = await call(withAdmin, 'create_token', { label: 'x', scope: 'content:write' });
        expect(JSON.stringify(r2)).toMatch(/Token lacks scope content:write/);
    });
});

describe('REST calls are scoped', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-scopes-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('lets a content:write token write content and refuses admin and moderation', async () => {
        const pat = mintToken('admin', 'scoped', ['read', 'content:write']).plaintext;

        const post = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${pat}`)
            .send({});
        expect(post.status).not.toBe(403);
        expect(JSON.stringify(post.body)).not.toMatch(/Token lacks scope/i);

        const cfg = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ siteName: 'Nope' });
        expect(cfg.status).toBe(403);
        expect(cfg.body.message).toBe('Token lacks scope admin');

        const bulk = await request(app)
            .post('/api/admin/images/delete-bulk')
            .set('Authorization', `Bearer ${pat}`)
            .send({ filenames: [] });
        expect(bulk.status).toBe(403);
        expect(bulk.body.message).toBe('Token lacks scope moderate');

        const del = await request(app)
            .delete('/api/posts/x')
            .set('Authorization', `Bearer ${pat}`);
        expect(del.status).toBe(404);
        expect(del.body.message).toBe('Post not found');
    });

    it('refuses a mixed-case path the same way', async () => {
        // Express routes case-insensitively, so /API/admin/config reaches the
        // admin handler; the scope check must see the same route.
        const pat = mintToken('admin', 'scoped', ['read', 'content:write']).plaintext;

        const cfg = await request(app)
            .post('/API/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .send({ siteName: 'Nope' });
        expect(cfg.status).toBe(403);
        expect(cfg.body.message).toBe('Token lacks scope admin');

        const del = await request(app)
            .delete('/API/posts/x')
            .set('Authorization', `Bearer ${pat}`);
        expect(del.status).toBe(404);
        expect(del.body.message).toBe('Post not found');
    });
});

describe('the mint-token CLI takes a scope list', () => {
    it('parses a comma list and refuses an unknown scope', () => {
        const parsed = parseMintTokenArgs([
            'node',
            'mint-token',
            '--username',
            'admin',
            '--scope',
            'read,content:write,publish'
        ]);
        expect(parsed.scope).toEqual(['read', 'content:write', 'publish']);
        expect(() =>
            parseMintTokenArgs(['node', 'mint-token', '--username', 'admin', '--scope', 'foo'])
        ).toThrow(/scope/i);
    });

    it('names every accepted scope when the scope is missing', () => {
        // The parser accepts "write" (the legacy name for every scope), so the
        // refusal has to name it — a user must learn it from the message.
        let message = '';
        try {
            parseMintTokenArgs(['node', 'mint-token', '--username', 'admin']);
        } catch (e) {
            message = String((e as Error).message);
        }
        expect(message).toMatch(/scope is required/i);
        expect(scopeNamesIn(message)).toEqual(ACCEPTED_SCOPE_NAMES);
    });

    it('names every accepted scope in the usage line', () => {
        let message = '';
        try {
            parseMintTokenArgs(['node', 'mint-token', '--help']);
        } catch (e) {
            message = String((e as Error).message);
        }
        expect(message).toMatch(/Usage/);
        expect(scopeNamesIn(message)).toEqual(ACCEPTED_SCOPE_NAMES);
    });
});
