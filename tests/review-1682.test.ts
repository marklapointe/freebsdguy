/**
 * Review follow-ups for WP #1682. Each assertion fails on current behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { Socket } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { parseTokenScope, storedTokenScope } from '../server/lib/token-scope.ts';
import { isValidBindHost, resolveBindHost, startHttpServer } from '../server/lib/bind-address.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { sanitizeConfig, defaultConfig } from '../server/lib/config.ts';
import { parseTrustProxy, resolveTrustProxy } from '../server/lib/trust-proxy.ts';

const READ_TOOLS = ['get_playbook', 'health', 'list_posts', 'get_post', 'list_images', 'list_themes'];
const BLOCKED_FOR_READ = ['list_users', 'list_tokens', 'get_config', 'ai_list_models'];

function toolArgs(name: string): Record<string, unknown> {
    switch (name) {
        case 'get_post':
        case 'delete_post':
            return { slug: 'review-1682-post' };
        case 'create_post':
        case 'update_post':
            return { slug: 'review-1682-post', title: 'T', content: 'C' };
        case 'upload_image':
            return { filename: 'dot.png', dataBase64: 'aGk=' };
        case 'delete_image':
            return { filename: 'missing.webp' };
        case 'update_config':
            return { patch: { siteName: 'Review' } };
        case 'set_theme':
            return { themeId: 'dark' };
        case 'save_theme':
            return { name: 'dark', colors: { '--bg': '#000000' } };
        case 'create_user':
            return { username: 'review-user', password: 'long-enough', role: 'contributor' };
        case 'delete_user':
            return { username: 'review-user' };
        case 'revoke_token':
            return { id: 'missing-token-id' };
        case 'ai_summarize':
        case 'ai_enhance':
            return { content: 'hello' };
        default:
            return {};
    }
}

async function mcpCall(pat: string, body: unknown) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
}

function toolText(res: { body: unknown; text?: string }): string {
    return typeof res.body === 'object' && res.body ? JSON.stringify(res.body) : String(res.text || '');
}

/** HTTP as a non-loopback peer, so X-Forwarded-For is only trusted when the app trusts that peer. */
function requestAsPeer(
    remoteAddress: string,
    headers: Record<string, string>
): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
        const socket = new Socket();
        Object.defineProperty(socket, 'remoteAddress', { get: () => remoteAddress });
        const req = new http.IncomingMessage(socket);
        req.method = 'GET';
        req.url = '/api/health';
        req.headers = { host: 'mdweb.local', ...headers };
        const res = new http.ServerResponse(req);
        let settled = false;
        const finish = (status: number) => {
            if (settled) return;
            settled = true;
            resolve({ status });
        };
        res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
            finish(res.statusCode || 0);
            if (typeof encoding === 'function') encoding();
            if (typeof cb === 'function') (cb as () => void)();
            return res;
        }) as http.ServerResponse['end'];
        try {
            app(req, res);
        } catch (err) {
            reject(err);
        }
    });
}

describe('WP #1682 read token over /mcp', () => {
    let dir: string;
    let readPat: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-read-mcp-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
        readPat = mintToken('admin', 'read-matrix', 'read').plaintext;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('refuses every non-allowlisted tool and still serves the read tools', async () => {
        const listed = await mcpCall(readPat, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {}
        });
        const names = (JSON.parse(toolText(listed)).result?.tools || []).map((t: { name: string }) => t.name) as string[];
        expect(names).toEqual(expect.arrayContaining([...READ_TOOLS, ...BLOCKED_FOR_READ, 'create_post']));

        for (const name of names) {
            const res = await mcpCall(readPat, {
                jsonrpc: '2.0',
                id: name,
                method: 'tools/call',
                params: { name, arguments: toolArgs(name) }
            });
            const text = toolText(res);
            if (READ_TOOLS.includes(name)) {
                expect(text, name).not.toMatch(/read-only/i);
            } else {
                expect(text, name).toMatch(/read-only/i);
            }
        }
    });
});

describe('WP #1682 token scope defaults to read', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-scope-default-'));
        vi.stubEnv('TOKENS_PATH', path.join(dir, 'tokens.json'));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('mints and stores read unless write is explicit', () => {
        expect(parseTokenScope(undefined)).toBe('read');
        expect(parseTokenScope(null)).toBe('read');
        expect(parseTokenScope('')).toBe('read');
        expect(parseTokenScope('write')).toBe('write');
        expect(storedTokenScope(undefined)).toBe('read');
        expect(storedTokenScope('write')).toBe('write');
        expect(storedTokenScope('read')).toBe('read');

        const implicit = mintToken('admin', 'implicit');
        expect(implicit.record.scope).toBe('read');
        const disk = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
        expect(disk[0].scope).toBe('read');
        expect(mintToken('admin', 'explicit', 'write').record.scope).toBe('write');
    });
});

describe('WP #1682 trust proxy loopback', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        resetRateLimits();
    });

    it('does not let a spoofed X-Forwarded-For reset the rate limit from a direct peer', async () => {
        resetRateLimits();
        vi.stubEnv('MDWEB_ENFORCE_RATE_LIMIT', '1');
        vi.stubEnv('MDWEB_API_RATE_MAX', '1');
        vi.stubEnv('MDWEB_API_RATE_WINDOW_MS', '60000');

        const peer = '10.66.0.8';
        const first = await requestAsPeer(peer, { 'x-forwarded-for': '203.0.113.5' });
        const second = await requestAsPeer(peer, { 'x-forwarded-for': '198.51.100.9' });
        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
        expect(defaultConfig().security?.trustProxy).toBe('loopback');
        const sanitized = sanitizeConfig({ security: { trustProxy: 'linklocal' } });
        expect(sanitized.config.security?.trustProxy).toBe('linklocal');
        const bad = sanitizeConfig({ security: { trustProxy: 'not-a-mode' } });
        expect(bad.config.security?.trustProxy).toBe('loopback');
        expect(bad.warnings.join(' ')).toMatch(/trustProxy/i);
    });

    it('parses boolean, hop count, and address-list proxy trust', () => {
        expect(parseTrustProxy(undefined)).toEqual({ value: 'loopback', ok: true });
        expect(parseTrustProxy(null)).toEqual({ value: 'loopback', ok: true });
        expect(parseTrustProxy('')).toEqual({ value: 'loopback', ok: true });
        expect(parseTrustProxy(false)).toEqual({ value: false, ok: true });
        expect(parseTrustProxy(true)).toEqual({ value: true, ok: true });
        expect(parseTrustProxy(2)).toEqual({ value: 2, ok: true });
        expect(parseTrustProxy(1.5).ok).toBe(false);
        expect(parseTrustProxy('false')).toEqual({ value: false, ok: true });
        expect(parseTrustProxy('TRUE')).toEqual({ value: true, ok: true });
        expect(parseTrustProxy('uniquelocal')).toEqual({ value: 'uniquelocal', ok: true });
        expect(parseTrustProxy('4')).toEqual({ value: 4, ok: true });
        expect(parseTrustProxy('10.66.0.1').value).toBe('10.66.0.1');
        expect(parseTrustProxy('nope').ok).toBe(false);
        expect(parseTrustProxy({ hop: 1 }).ok).toBe(false);
        expect(resolveTrustProxy('linklocal')).toBe('linklocal');
    });
});

describe('WP #1682 IPv6 bind', () => {
    it('accepts IPv6 literals as bind addresses', async () => {
        expect(isValidBindHost('::1')).toBe(true);
        expect(isValidBindHost('2001:db8::1')).toBe(true);
        expect(isValidBindHost('[::1]')).toBe(true);
        expect(resolveBindHost({ host: '::1' })).toBe('::1');
        expect(resolveBindHost({ host: '[2001:db8::1]' })).toBe('2001:db8::1');
        const kept = sanitizeConfig({ service: { port: 5173, host: '::1' } });
        expect(kept.config.service?.host).toBe('::1');
        const express = (await import('express')).default;
        const server = startHttpServer(express(), 0, '::1');
        await new Promise<void>((resolve, reject) => {
            server.once('listening', () => resolve());
            server.once('error', reject);
        });
        const addr = server.address();
        expect(addr && typeof addr === 'object' ? addr.address : '').toBe('::1');
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});

describe('WP #1682 read-scope allowlist', () => {
    it('denies sensitive and unknown tools to read scope', async () => {
        const scope = await import('../server/lib/token-scope.ts');
        const allows = (scope as { isReadAllowedMcpTool?: (name: string) => boolean }).isReadAllowedMcpTool;
        expect(typeof allows).toBe('function');
        expect(allows!('list_posts')).toBe(true);
        expect(allows!('health')).toBe(true);
        expect(allows!('list_users')).toBe(false);
        expect(allows!('list_tokens')).toBe(false);
        expect(allows!('get_config')).toBe(false);
        expect(allows!('ai_list_models')).toBe(false);
        expect(allows!('create_post')).toBe(false);
        expect(allows!('tool_added_tomorrow')).toBe(false);
    });
});

