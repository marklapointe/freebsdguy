/**
 * Branch coverage for the FreeBSD jail hardening modules (WP #1682).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import {
    parseTokenScope,
    storedTokenScope,
    isMutatingMcpTool,
    isMutatingHttpRequest,
    readTokenDenied
} from '../server/lib/token-scope.ts';
import { assertMode0600, readMode0600File, SecretFileError } from '../server/lib/secret-file.ts';
import { parseChangePasswordArgs, readPasswordInput } from '../server/lib/cli-password.ts';
import { isValidBindHost, resolveBindHost, startHttpServer } from '../server/lib/bind-address.ts';
import {
    classifyRoute,
    resolveRateLimitSettings,
    MemoryRateLimiter,
    createRateLimitMiddleware
} from '../server/lib/rate-limit.ts';
import { parseOriginList, resolveAllowedOrigins, corsOriginDecision } from '../server/lib/cors-policy.ts';
import {
    shouldDropAuditKey,
    redactSecretText,
    redactAuditRecord,
    formatAuditLine,
    writeAudit
} from '../server/lib/audit-log.ts';
import { isDefaultAdminCredential, consumeSetupToken, bootstrapAdmin } from '../server/lib/setup-admin.ts';
import { parseMintTokenArgs } from '../server/lib/mint-token-cli.ts';
import { DEFAULT_ADMIN_PASSWORD_HASH } from '../server/lib/default-credentials.ts';
import { runPreflight } from '../server/lib/preflight.ts';
import { resolveJwtSecret } from '../server/lib/jwt-secret.ts';
import { sanitizeConfig } from '../server/lib/config.ts';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

describe('token scope helpers', () => {
    it('parses scopes and classifies mutating calls', () => {
        expect(parseTokenScope(undefined)).toBe('read');
        expect(parseTokenScope(null)).toBe('read');
        expect(parseTokenScope('')).toBe('read');
        expect(parseTokenScope('read')).toBe('read');
        expect(parseTokenScope('write', 'read')).toBe('write');
        expect(() => parseTokenScope('root')).toThrow(/scope/i);
        expect(storedTokenScope('read')).toBe('read');
        expect(storedTokenScope(undefined)).toBe('read');
        expect(storedTokenScope('nope')).toBe('read');
        expect(storedTokenScope('write')).toBe('write');
        expect(isMutatingMcpTool('create_post')).toBe(true);
        expect(isMutatingMcpTool('delete_image')).toBe(true);
        expect(isMutatingMcpTool('list_posts')).toBe(false);
        expect(isMutatingMcpTool('ai_list_models')).toBe(false);
        expect(isMutatingHttpRequest('GET', '/api/posts')).toBe(false);
        expect(isMutatingHttpRequest('HEAD', '/api/posts')).toBe(false);
        expect(isMutatingHttpRequest('OPTIONS', '/api/posts')).toBe(false);
        expect(isMutatingHttpRequest('POST', '/api/login')).toBe(false);
        expect(isMutatingHttpRequest('POST', '/api/login?x=1')).toBe(false);
        expect(isMutatingHttpRequest('POST', '/mcp')).toBe(false);
        expect(isMutatingHttpRequest('POST', '/mcp/extra')).toBe(false);
        expect(isMutatingHttpRequest('POST', '/api/posts')).toBe(true);
        expect(isMutatingHttpRequest('DELETE', '/api')).toBe(true);
        expect(isMutatingHttpRequest('PUT', '/static')).toBe(false);
        expect(isMutatingHttpRequest('', '')).toBe(false);
        expect(readTokenDenied('read', 'POST', '/api/posts')).toBe(true);
        expect(readTokenDenied('write', 'POST', '/api/posts')).toBe(false);
        expect(readTokenDenied(undefined, 'DELETE', '/api/posts/x')).toBe(false);
    });
});

describe('secret file mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-secfile-'));
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('accepts 0600 and rejects other modes, empty files, and multiline secrets', () => {
        expect(() => assertMode0600(0o100600)).not.toThrow();
        expect(() => assertMode0600(0o100644)).toThrow(SecretFileError);
        expect(() => assertMode0600(0o100400, 'Password file')).toThrow(/Password file/);
        const missing = path.join(dir, 'missing');
        expect(() => readMode0600File(missing)).toThrow(/Cannot read/);
        const empty = path.join(dir, 'empty');
        fs.writeFileSync(empty, '\n');
        fs.chmodSync(empty, 0o600);
        expect(() => readMode0600File(empty)).toThrow(/single non-empty/);
        const multi = path.join(dir, 'multi');
        fs.writeFileSync(multi, 'one\ntwo\n');
        fs.chmodSync(multi, 0o600);
        expect(() => readMode0600File(multi)).toThrow(/single non-empty/);
        const crlf = path.join(dir, 'crlf');
        fs.writeFileSync(crlf, 'line-of-secret-ok\r\n');
        fs.chmodSync(crlf, 0o600);
        expect(readMode0600File(crlf)).toBe('line-of-secret-ok');
        const bare = path.join(dir, 'bare');
        fs.writeFileSync(bare, 'no-trailing-newline-secret');
        fs.chmodSync(bare, 0o600);
        expect(readMode0600File(bare)).toBe('no-trailing-newline-secret');
    });
});

describe('change-password argv parser', () => {
    it('rejects argv passwords and reads stdin or a file', () => {
        expect(() => parseChangePasswordArgs(['node', 'script'])).toThrow(/stdin/i);
        expect(() => parseChangePasswordArgs(['node', 'script', 'admin', 'secret'])).toThrow(/command line/i);
        expect(() => parseChangePasswordArgs(['node', 'script', '--help'])).toThrow(/Usage/);
        expect(() => parseChangePasswordArgs(['node', 'script', '--nope'])).toThrow(/Unknown option/);
        expect(() => parseChangePasswordArgs(['node', 'script', 'admin', '--password-file'])).toThrow(/Missing/);
        expect(() => parseChangePasswordArgs(['node', 'script', '--password-file='])).toThrow(/Missing/);
        expect(parseChangePasswordArgs(['node', 'script', 'admin', '--password-file', 'pw'])).toEqual({
            username: 'admin',
            passwordFile: 'pw'
        });
        expect(parseChangePasswordArgs(['node', 'script', '--password-file=pw', 'admin'])).toEqual({
            username: 'admin',
            passwordFile: 'pw'
        });
        const file = path.join(os.tmpdir(), `mdweb-pw-${process.pid}`);
        fs.writeFileSync(file, 'from-file-secret\n', { mode: 0o600 });
        fs.chmodSync(file, 0o600);
        expect(readPasswordInput({ passwordFile: file })).toBe('from-file-secret');
        expect(readPasswordInput({ stdinText: 'from-stdin\n' })).toBe('from-stdin');
        expect(() => readPasswordInput({})).toThrow(/stdin/i);
        expect(() => readPasswordInput({ stdinText: '   \n' })).toThrow(/stdin/i);
        expect(() => readPasswordInput({ stdinText: 'one\ntwo\n' })).toThrow(/single line/);
        fs.unlinkSync(file);
    });
});

describe('bind host', () => {
    it('rejects wildcards, spaces, and impossible addresses', () => {
        expect(isValidBindHost('')).toBe(false);
        expect(isValidBindHost('*')).toBe(false);
        expect(isValidBindHost('a/b')).toBe(false);
        expect(isValidBindHost('has space')).toBe(false);
        expect(isValidBindHost('999.1.1.1')).toBe(false);
        expect(isValidBindHost('01.2.3.4')).toBe(false);
        expect(isValidBindHost('::1')).toBe(true);
        expect(isValidBindHost('not:a:host')).toBe(false);
        expect(isValidBindHost('[::1')).toBe(false);
        expect(isValidBindHost('a'.repeat(254))).toBe(false);
        expect(isValidBindHost('localhost')).toBe(true);
        expect(isValidBindHost('-bad')).toBe(false);
        expect(resolveBindHost(null)).toBe('127.0.0.1');
        expect(resolveBindHost({ host: '  ' })).toBe('127.0.0.1');
        expect(resolveBindHost({ host: 1 })).toBe('127.0.0.1');
        expect(resolveBindHost({ host: 'localhost' })).toBe('localhost');
    });

    it('invokes the listen callback', async () => {
        const app = express();
        let called = false;
        const server = startHttpServer(app, 0, '127.0.0.1', () => {
            called = true;
        });
        await new Promise<void>((resolve) => server.once('listening', () => resolve()));
        expect(called).toBe(true);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});

describe('rate limit settings and middleware', () => {
    it('classifies routes and resolves config versus env', () => {
        expect(classifyRoute('')).toBeNull();
        expect(classifyRoute('/nope')).toBeNull();
        expect(classifyRoute('/api/login?next=/')).toBe('login');
        expect(classifyRoute('/mcp/session')).toBe('mcp');
        expect(classifyRoute('/api/health')).toBe('api');
        const relaxed = resolveRateLimitSettings(undefined, { VITEST: '1' });
        expect(relaxed.api.max).toBe(1_000_000);
        const configured = resolveRateLimitSettings(
            { apiRateLimitMax: 4, apiRateLimitWindow: 15, loginRateLimitMax: 1, mcpRateLimitWindow: 2 },
            {}
        );
        expect(configured.api).toEqual({ max: 4, windowMs: 15000 });
        expect(configured.login.max).toBe(1);
        expect(configured.mcp.windowMs).toBe(2000);
        const fromEnv = resolveRateLimitSettings(undefined, {
            MDWEB_API_RATE_MAX: '9',
            MDWEB_API_RATE_WINDOW_MS: 'nope',
            MDWEB_LOGIN_RATE_MAX: '',
            MDWEB_MCP_RATE_MAX: '0'
        });
        expect(fromEnv.api.max).toBe(9);
        expect(fromEnv.api.windowMs).toBe(60_000);
        expect(fromEnv.mcp.max).toBe(0);
    });

    it('expires old hits and returns 429 from middleware', async () => {
        let now = 1_000_000;
        const limiter = new MemoryRateLimiter(() => now);
        expect(limiter.hit('k', 1, 1000).allowed).toBe(true);
        expect(limiter.hit('k', 1, 1000).allowed).toBe(false);
        expect(limiter.hit('k', 1, 1000).retryAfterSeconds).toBeGreaterThan(0);
        expect(new MemoryRateLimiter(() => 5_000).hit('zero', 0, 1000).allowed).toBe(false);
        now += 5000;
        expect(limiter.hit('k', 1, 1000).allowed).toBe(true);
        limiter.reset();
        expect(limiter.hit('k', 1, 1000).allowed).toBe(true);

        const app = express();
        app.use(
            createRateLimitMiddleware({
                limiter: new MemoryRateLimiter(),
                getSettings: () => ({
                    login: { max: 1, windowMs: 60_000 },
                    api: { max: 1, windowMs: 60_000 },
                    mcp: { max: 1, windowMs: 60_000 }
                })
            })
        );
        app.get('/static', (_req, res) => res.json({ ok: true }));
        app.get('/api/health', (_req, res) => res.json({ ok: true }));
        const defaults = express();
        defaults.use(createRateLimitMiddleware());
        defaults.get('/api/health', (_req, res) => res.json({ ok: true }));
        expect((await request(defaults).get('/api/health')).status).toBe(200);
        expect((await request(app).get('/static')).status).toBe(200);
        expect((await request(app).get('/api/health')).status).toBe(200);
        const limited = await request(app).get('/api/health');
        expect(limited.status).toBe(429);
        expect(limited.headers['retry-after']).toBeTruthy();

        const mw = createRateLimitMiddleware({
            limiter: new MemoryRateLimiter(),
            getSettings: () => ({
                login: { max: 1, windowMs: 60_000 },
                api: { max: 1, windowMs: 60_000 },
                mcp: { max: 1, windowMs: 60_000 }
            })
        });
        const headers: Record<string, string> = {};
        const fakeRes = {
            setHeader(name: string, value: string) {
                headers[name] = value;
            },
            statusCode: 200,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json() {
                return this;
            }
        };
        await new Promise<void>((resolve) => {
            mw(
                { path: '', url: '/api/health', socket: { remoteAddress: '10.1.1.1' } } as never,
                fakeRes as never,
                () => resolve()
            );
        });
        expect(headers['RateLimit-Remaining']).toBe('0');
        await new Promise<void>((resolve) => {
            mw({} as never, fakeRes as never, () => resolve());
        });
        await new Promise<void>((resolve) => {
            mw({ url: '/api/health', socket: {} } as never, fakeRes as never, () => resolve());
        });
        expect(headers['RateLimit-Limit']).toBe('1');
    });
});

describe('cors policy', () => {
    it('drops wildcards and only echoes allowlisted origins', () => {
        expect(parseOriginList('https://a.example, *, https://a.example, nope')).toEqual(['https://a.example']);
        expect(parseOriginList(['https://b.example, https://c.example', 3, '*'])).toEqual([
            'https://b.example',
            'https://c.example'
        ]);
        expect(parseOriginList(null)).toEqual([]);
        expect(resolveAllowedOrigins(['https://cfg.example'], undefined)).toEqual(['https://cfg.example']);
        expect(resolveAllowedOrigins(['https://cfg.example'], '   ')).toEqual(['https://cfg.example']);
        expect(resolveAllowedOrigins(['https://cfg.example'], '*')).toEqual([]);
        expect(corsOriginDecision([], undefined)).toBe(true);
        expect(corsOriginDecision(['https://ok.example'], '*')).toBe(false);
        expect(corsOriginDecision(['https://ok.example'], 'https://ok.example')).toBe('https://ok.example');
        expect(corsOriginDecision(['https://ok.example'], 'https://evil.example')).toBe(false);
    });
});

describe('audit redaction', () => {
    it('drops secrets and still writes a JSON line', () => {
        expect(shouldDropAuditKey('tokenId')).toBe(false);
        expect(shouldDropAuditKey('tokenScope')).toBe(false);
        expect(shouldDropAuditKey('Authorization')).toBe(true);
        expect(shouldDropAuditKey('set-cookie')).toBe(true);
        expect(shouldDropAuditKey('passwordHash')).toBe(true);
        expect(shouldDropAuditKey('username')).toBe(false);
        expect(shouldDropAuditKey('user-password-hint')).toBe(true);
        expect(shouldDropAuditKey('x-authorization-y')).toBe(true);
        expect(shouldDropAuditKey('session-cookie-name')).toBe(true);
        expect(redactSecretText('see mdw_abcDEF123 and Bearer xyz.token and eyJaaa.bbb.ccc')).not.toMatch(/mdw_|Bearer xyz|eyJ/);
        const nested = redactAuditRecord({
            event: 'login',
            password: 'secret',
            detail: { cookie: 'a=b', note: 'mdw_shouldhide' },
            tags: ['keep']
        });
        expect(nested).not.toHaveProperty('password');
        expect((nested.detail as { cookie?: string }).cookie).toBeUndefined();
        expect(JSON.stringify(nested)).not.toContain('mdw_shouldhide');
        const unnamed = formatAuditLine({ note: 'has password inside' });
        expect(JSON.parse(unnamed).event).toBe('audit');
        const dirty = formatAuditLine({ event: 'login', username: 'has-password-in-name' });
        expect(dirty).not.toMatch(/password/i);
        expect(JSON.parse(dirty).outcome).toBe('redacted');
        const clean = formatAuditLine({ event: 'login', outcome: 'failure', username: 'ada' }, new Date('2020-01-01T00:00:00.000Z'));
        expect(JSON.parse(clean)).toMatchObject({ event: 'login', username: 'ada' });

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-audit-unit-'));
        const file = path.join(dir, 'a.log');
        writeAudit({ event: 'login', outcome: 'failure' }, { AUDIT_LOG_PATH: file, VITEST: '1' });
        expect(fs.readFileSync(file, 'utf8')).toMatch(/login/);
        writeAudit({ event: 'login' }, { VITEST: '1' });
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        writeAudit({ event: 'mcp', tool: 'list_posts' }, {});
        expect(write).toHaveBeenCalled();
        write.mockRestore();
        vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
            throw new Error('disk full');
        });
        expect(() => writeAudit({ event: 'content' }, { AUDIT_LOG_PATH: file })).not.toThrow();
        vi.restoreAllMocks();
    });
});

describe('setup admin edges', () => {
    it('detects default credentials and refuses a second bootstrap', async () => {
        expect(await isDefaultAdminCredential('')).toBe(false);
        expect(await isDefaultAdminCredential(undefined)).toBe(false);
        expect(await isDefaultAdminCredential(DEFAULT_ADMIN_PASSWORD_HASH)).toBe(true);
        const other = await bcrypt.hash('admin', 4);
        expect(await isDefaultAdminCredential(other)).toBe(true);
        expect(await isDefaultAdminCredential('not-a-hash')).toBe(false);
        const compare = vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('bcrypt failed'));
        expect(await isDefaultAdminCredential('$2b$04$nottherealhashbutlongenoughextra')).toBe(false);
        compare.mockRestore();

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-setup-unit-'));
        const tokenFile = path.join(dir, 'setup-token.json');
        expect(() => consumeSetupToken('', tokenFile)).toThrow(/token/i);
        fs.writeFileSync(tokenFile, '{');
        expect(() => consumeSetupToken('abc', tokenFile)).toThrow(/token/i);
        fs.writeFileSync(tokenFile, JSON.stringify({ hash: 'abcd' }));
        expect(() => consumeSetupToken('nope', tokenFile)).toThrow(/token/i);
        fs.writeFileSync(tokenFile, JSON.stringify({ hash: 'ab'.repeat(32) }));
        const timing = vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
            throw new Error('timing');
        });
        expect(() => consumeSetupToken('nope', tokenFile)).toThrow(/token/i);
        timing.mockRestore();

        const usersFile = path.join(dir, 'users.json');
        await bootstrapAdmin({
            username: 'admin',
            password: 'long-enough-pass',
            usersFile,
            allowStdin: true
        });
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: 'another-long-pass',
                usersFile,
                allowStdin: true
            })
        ).rejects.toThrow(/already configured/i);
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: '',
                usersFile: path.join(dir, 'empty-pw.json'),
                allowStdin: true
            })
        ).rejects.toThrow(/default/i);
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: 'short',
                usersFile: path.join(dir, 'short.json'),
                allowStdin: true
            })
        ).rejects.toThrow(/8 characters/);
        await expect(
            bootstrapAdmin({
                username: 'admin',
                password: 'long-enough-pass',
                usersFile: path.join(dir, 'need-token.json'),
                allowStdin: false
            })
        ).rejects.toThrow(/token or stdin/i);

        const replaceFile = path.join(dir, 'replace.json');
        fs.writeFileSync(
            replaceFile,
            JSON.stringify({
                admin: { username: 'admin', passwordHash: DEFAULT_ADMIN_PASSWORD_HASH, role: 'admin' },
                users: []
            })
        );
        await bootstrapAdmin({
            username: '',
            password: 'replaced-admin-pass',
            usersFile: replaceFile,
            allowStdin: true
        });
        const replaced = JSON.parse(fs.readFileSync(replaceFile, 'utf8'));
        expect(replaced.admin.username).toBe('admin');
        expect(replaced.admin.passwordHash).not.toBe(DEFAULT_ADMIN_PASSWORD_HASH);
    });
});

describe('mint-token CLI parser', () => {
    it('reads equals-form options and rejects extras', () => {
        expect(
            parseMintTokenArgs(['node', 'm', '--username=ada', '--label=laptop', '--scope=read'])
        ).toEqual({ username: 'ada', label: 'laptop', scope: 'read' });
        expect(() => parseMintTokenArgs(['node', 'm', '--help'])).toThrow(/Usage/);
        expect(() => parseMintTokenArgs(['node', 'm', '--bogus'])).toThrow(/Unknown/);
        expect(() => parseMintTokenArgs(['node', 'm', 'extra', '--username', 'a', '--scope', 'read'])).toThrow(
            /unexpected/i
        );
        expect(() => parseMintTokenArgs(['node', 'm', '--scope', 'read'])).toThrow(/username/i);
        expect(() => parseMintTokenArgs(['node', 'm', '--username', 'a'])).toThrow(/scope/i);
        expect(() => parseMintTokenArgs(['node', 'm', '--username'])).toThrow(/username/i);
        expect(
            parseMintTokenArgs(['node', 'm', '--username', 'ada', '--scope', 'write', '--label'])
        ).toMatchObject({ username: 'ada', label: '', scope: 'write' });
    });
});

describe('config host, cors, and secret file rethrow', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('keeps rate limits and drops wildcard CORS origins', () => {
        const star = sanitizeConfig({
            security: { corsOrigins: '*', mcpRateLimitMax: 3, mcpRateLimitWindow: 10 }
        });
        expect(star.config.security?.corsOrigins).toEqual([]);
        expect(star.warnings.join(' ')).toMatch(/wildcard/i);
        expect(star.config.security?.mcpRateLimitMax).toBe(3);
        const listed = sanitizeConfig({ security: { corsOrigins: ['https://ok.example', '*'] } });
        expect(listed.config.security?.corsOrigins).toEqual(['https://ok.example']);
        expect(listed.warnings.join(' ')).toMatch(/wildcard/i);
        const badHost = sanitizeConfig({ service: { host: 15, port: 1 } });
        expect(badHost.config.service?.host).toBe('127.0.0.1');
        expect(badHost.warnings.join(' ')).toMatch(/host/i);
    });

    it('rethrows unexpected secret-file errors', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-jwt-rethrow-'));
        const file = path.join(dir, 'jwt');
        fs.writeFileSync(file, 'abcdefghijklmnopqrstuvwxyz012345');
        fs.chmodSync(file, 0o600);
        vi.stubEnv('JWT_SECRET_FILE', file);
        vi.stubEnv('JWT_SECRET', '');
        vi.stubEnv('SESSION_SECRET', '');
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw 'boom';
        });
        expect(() => resolveJwtSecret(null, 'production')).toThrow('boom');
    });
});

describe('preflight secret file', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('flags a JWT secret file that is not mode 0600', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-preflight-sec-'));
        const file = path.join(dir, 'jwt');
        fs.writeFileSync(file, 'abcdefghijklmnopqrstuvwxyz012345\n');
        fs.chmodSync(file, 0o644);
        vi.stubEnv('JWT_SECRET_FILE', file);
        vi.stubEnv('JWT_SECRET', '');
        vi.stubEnv('SESSION_SECRET', '');
        const issues = await runPreflight(false);
        expect(issues.some((i) => i.id === 'JWT_SECRET_FILE' && i.critical)).toBe(true);
        vi.unstubAllEnvs();
    });
});
