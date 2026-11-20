/**
 * P0 E1: update_config and POST /api/admin/config reject forbidden, unknown and
 * prototype-pollution keys without touching config.json.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { validateMcpConfigPatch, validateRestConfigBody } from '../server/lib/config-patch.ts';

let tmp = '';
let cfgFile = '';
let pat = '';

const sha = () => crypto.createHash('sha256').update(fs.readFileSync(cfgFile)).digest('hex');

function seed() {
    fs.writeFileSync(
        cfgFile,
        JSON.stringify(
            {
                postsDir: './posts',
                themeDir: './themes',
                currentTheme: 'dark',
                siteName: 'Seed',
                futureKey: { keep: 'me' },
                service: { port: 5199, host: '127.0.0.1' },
                security: { authMode: 'jwt', trustProxy: 'loopback' }
            },
            null,
            2
        )
    );
}

function mcpRaw(patchJson: string) {
    // The patch is spliced into the JSON text so "__proto__" is an own key on the wire.
    const body = `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"update_config","arguments":{"patch":${patchJson}}}}`;
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('MCP-Protocol-Version', '2025-06-18')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-e1-'));
    cfgFile = path.join(tmp, 'config.json');
    seed();
    vi.stubEnv('CONFIG_PATH', cfgFile);
    vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
    vi.stubEnv('AUDIT_LOG_PATH', path.join(tmp, 'audit.log'));
    pat = mintToken('admin', 'e1', 'write').plaintext;
    resetRateLimits();
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
    resetRateLimits();
});

const PAYLOADS: Record<string, string> = {
    'service.bind': '{"service":{"bind":"0.0.0.0"}}',
    'security.corsOrigins': '{"security":{"corsOrigins":["https://evil.example"]}}',
    'security.authMode': '{"security":{"authMode":"none"}}',
    '__proto__': '{"__proto__":{"polluted":true}}',
    'constructor.prototype': '{"constructor":{"prototype":{"x":1}}}',
    'service.tls.minVersion': '{"service":{"tls":{"minVersion":"TLSv1"}}}',
    'csp': '{"csp":"default-src *"}',
    'nested __proto__': '{"appearance":{"__proto__":{"x":1}}}',
    'unknown appearance key': '{"appearance":{"evil":1}}',
    'unknown footer key': '{"footer":{"evil":1}}',
    'postsDir': '{"postsDir":"/etc"}',
    'unknown top-level': '{"somethingNew":1}'
};

describe('validateMcpConfigPatch', () => {
    it('accepts allow-listed keys only', () => {
        expect(validateMcpConfigPatch({ siteName: 'x', appearance: { themeMode: 'dark' }, footer: { show: true } }).ok).toBe(true);
        for (const [name, json] of Object.entries(PAYLOADS)) {
            expect(validateMcpConfigPatch(JSON.parse(json)).ok, name).toBe(false);
        }
    });
});

describe('config-file-only hint', () => {
    it('corsOrigins is not pointed at the REST route; postsDir still is', () => {
        for (const patch of [{ security: { corsOrigins: [] } }, { service: { bind: 'x' } }, { service: { tls: {} } }]) {
            const r = validateMcpConfigPatch(patch);
            expect(r.ok).toBe(false);
            const err = r.ok ? '' : r.error;
            expect(err).not.toContain('POST /api/admin/config');
            expect(err).toContain('config file');
        }
        const r = validateMcpConfigPatch({ postsDir: 'x' });
        expect(r.ok ? '' : r.error).toContain('POST /api/admin/config');
    });
});

describe('error clarity', () => {
    const deep = (n: number): Record<string, unknown> => {
        let v: Record<string, unknown> = { x: 1 };
        for (let i = 0; i < n; i++) v = { a: v };
        return v;
    };
    it('a 25-level nested patch gets a distinct depth error, not a forbidden-key error', () => {
        const r = validateMcpConfigPatch(deep(25));
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error).toContain('Config patch is more than 20 levels deep');
        expect(!r.ok && r.error).not.toContain('forbidden key');
        const b = validateRestConfigBody(deep(25));
        expect(!b.ok && b.error).toContain('levels deep');
    });
    it('rejections end with "No changes were saved." and never echo a value', () => {
        for (const patch of [{ postsDir: '/secret-path' }, { zzz: 1 }, { appearance: { evil: 'v4lue' } }, { __proto__x: 1, security: { authMode: 'none' } }]) {
            const r = validateMcpConfigPatch(patch);
            expect(r.ok).toBe(false);
            expect(!r.ok && r.error.endsWith('No changes were saved.')).toBe(true);
            expect(!r.ok && r.error).not.toMatch(/secret-path|v4lue|none/);
        }
        const rest = validateRestConfigBody({ zzz: 1 });
        expect(!rest.ok && rest.error.endsWith('No changes were saved.')).toBe(true);
    });
    it('names POST /api/admin/config for keys editable through REST', () => {
        for (const k of ['postsDir', 'themeDir']) {
            const r = validateMcpConfigPatch({ [k]: '/x' });
            expect(!r.ok && r.error).toContain('Use POST /api/admin/config to change it.');
        }
    });
    it('names POST /api/admin/config for every REST-editable key and for no REST-refused key', () => {
        for (const k of ['postsDir', 'themeDir', 'security', 'service', 'aiConfig']) {
            const r = validateMcpConfigPatch({ [k]: {} });
            expect(!r.ok && r.error, k).toContain('Use POST /api/admin/config to change it.');
        }
        for (const k of ['corsOrigins', 'bind', 'tls', 'csp']) {
            const r = validateMcpConfigPatch({ [k]: {} });
            expect(r.ok, k).toBe(false);
            expect(!r.ok && r.error, k).not.toContain('POST /api/admin/config');
        }
    });
    it('the depth error states the limit', () => {
        const r = validateMcpConfigPatch(deep(25));
        expect(!r.ok && r.error).toContain('more than 20 levels deep. No changes were saved.');
        const b = validateRestConfigBody(deep(25));
        expect(!b.ok && b.error).toContain('more than 20 levels deep');
    });
    it('REST checks aiConfig nested keys', () => {
        expect(validateRestConfigBody({ aiConfig: { enabled: true, provider: 'ollama', baseUrl: 'x', modelId: 'm', apiKey: 'k' } }).ok).toBe(true);
        expect(validateRestConfigBody({ aiConfig: { evil: 1 } }).ok).toBe(false);
    });
});

describe('MCP update_config', () => {
    for (const [name, json] of Object.entries(PAYLOADS)) {
        it(`rejects ${name} and leaves config.json byte-identical`, async () => {
            const before = sha();
            const res = await mcpRaw(json);
            expect(res.body.result?.isError, JSON.stringify(res.body)).toBe(true);
            expect(sha()).toBe(before);
        });
    }

    it('security.disableWebLogin alone succeeds with an "ignored" warning and leaves the flag on disk; with another security key it is refused', async () => {
        const before = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        const ok = await mcpRaw('{"security":{"disableWebLogin":true}}');
        expect(ok.body.result?.isError, JSON.stringify(ok.body)).toBeFalsy();
        expect(ok.body.result.content[0].text).toContain('ignored');
        const disk = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        expect(before.security.disableWebLogin).toBeUndefined();
        expect(disk.security.disableWebLogin).toBeFalsy();

        const sum = sha();
        const bad = await mcpRaw('{"security":{"disableWebLogin":true,"trustProxy":"x"}}');
        expect(bad.body.result?.isError).toBe(true);
        expect(sha()).toBe(sum);
    });

    it('a valid siteName update succeeds and keeps service.port and unknown keys on disk', async () => {
        const res = await mcpRaw('{"siteName":"Renamed"}');
        expect(res.body.result?.isError).toBeFalsy();
        const disk = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        expect(disk.siteName).toBe('Renamed');
        expect(disk.service.port).toBe(5199);
        expect(disk.futureKey).toEqual({ keep: 'me' });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});

describe('POST /api/admin/config', () => {
    const post = (raw: string) =>
        request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${pat}`)
            .set('Content-Type', 'application/json')
            .send(raw);

    for (const [name, raw] of Object.entries({
        csp: '{"csp":"default-src *"}',
        bind: '{"bind":"0.0.0.0"}',
        ['__proto__']: '{"__proto__":{"polluted":true}}',
        constructor: '{"constructor":{"prototype":{"x":1}}}',
        prototype: '{"prototype":{"x":1}}',
        'nested __proto__': '{"footer":{"__proto__":{"x":1}}}'
    })) {
        it(`returns 400 for ${name} without modifying config.json`, async () => {
            const before = sha();
            const res = await post(raw);
            expect(res.status).toBe(400);
            expect(sha()).toBe(before);
        });
    }

    const EVIL = 'https://evil.example';
    for (const [name, raw] of Object.entries({
        'security.corsOrigins': `{"security":{"corsOrigins":["${EVIL}"]}}`,
        'service.bind': '{"service":{"bind":"0.0.0.0"}}',
        'service.tls': '{"service":{"tls":{"minVersion":"TLSv1"}}}',
        'service.unknown': '{"service":{"port":5200,"other":1}}',
        'security.unknown': '{"security":{"somethingNew":1}}',
        'security.authMode none': '{"security":{"authMode":"none"}}',
        'security.authMode non-string': '{"security":{"authMode":5}}'
    })) {
        it(`returns 400 for ${name}, leaves config.json unchanged and enables no CORS`, async () => {
            const before = sha();
            const res = await post(raw);
            expect(res.status).toBe(400);
            expect(sha()).toBe(before);
            for (const p of ['/api/posts', '/mcp']) {
                const r = await request(app).get(p).set('Origin', EVIL).set('Authorization', `Bearer ${pat}`);
                expect(r.headers['access-control-allow-origin'], p).toBeUndefined();
            }
        });
    }

    it('accepts authMode jwt/session and preserves an existing corsOrigins on disk', async () => {
        const disk0 = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        disk0.security.corsOrigins = ['https://good.example'];
        fs.writeFileSync(cfgFile, JSON.stringify(disk0));
        for (const authMode of ['session', 'jwt']) {
            const res = await post(JSON.stringify({ security: { authMode } }));
            expect(res.status).toBe(200);
        }
        const disk = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        expect(disk.security.authMode).toBe('jwt');
        expect(disk.security.corsOrigins).toEqual(['https://good.example']);
    });

    it('still accepts a normal update', async () => {
        const res = await post('{"siteName":"ViaRest","service":{"port":5200}}');
        expect(res.status).toBe(200);
        expect(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).siteName).toBe('ViaRest');
    });
});
