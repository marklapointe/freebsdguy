/**
 * Track #2119 U7: a passwordless MCP-only agent account, and the CLI that makes one.
 *
 * What this file proves:
 *   - users.json may carry mcpOnly on a contributor account and nowhere else:
 *     the admin block never carries it, a non-contributor loses it, and only the
 *     boolean true keeps it;
 *   - findUserByUsername finds an mcpOnly contributor that has no password, and
 *     still refuses an ordinary account whose hash is empty;
 *   - the web login refuses an mcpOnly account exactly like a wrong password and
 *     says so in the audit log, even when the web login is enabled;
 *   - a personal access token minted for an mcpOnly account works on /mcp, and
 *     stops working the moment the account is gone from users.json;
 *   - the CLI parser refuses a password, an unknown option, a bad username and
 *     the admin/moderate scopes, and accepts read, content:write and publish;
 *   - the CLI writes one token line to stdout and nothing else, refuses to run on
 *     a terminal, refuses a name that is taken, and leaves no account behind when
 *     the token cannot be minted;
 *   - the CLI refuses a missing, corrupt or unusable users.json and writes
 *     nothing at all: it never seeds a default admin and never quarantines the
 *     file;
 *   - the refusal of an mcpOnly account on the web login costs the same bcrypt
 *     work a wrong password costs, so the answer time does not tell the caller
 *     that the account exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { registerRoutes } from '../server/register-routes.ts';
import { createActiveConfigHolder } from '../server/lib/app-context.ts';
import { RoleGuardFactory } from '../server/middleware/auth.ts';
import {
    defaultConfig,
    sanitizeUsers,
    findUserByUsername,
    loadUsers,
    type Config,
    type UsersConfig
} from '../server/lib/config.ts';
import { mintToken, verifyToken } from '../server/lib/api-tokens.ts';
import { parseAgentUserArgs, runCreateAgentUser } from '../server/lib/agent-user-cli.ts';
import { passwordMatches, DUMMY_PASSWORD_HASH } from '../server/lib/password.ts';
import { getPost } from '../server/lib/posts.ts';

/** Per-run secret: a fixed key would let a token minted by another run validate here. */
const SECRET = crypto.randomBytes(32).toString('hex');

let tmp = '';
let configFile = '';
let usersFile = '';
let tokensFile = '';
let auditFile = '';
let postsDir = '';

/** The users.json this run starts with. */
function writeUsers(users: unknown): void {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

/** The users.json as it is on disk. */
function readUsers(): any {
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

/** An Express app with the real routes, bound to the temp config, users and posts. */
function buildApp(
    active: Config,
    passwordMatcher?: (plain: unknown, hash: string | undefined) => Promise<boolean>
) {
    const holder = createActiveConfigHolder(active);
    const guards = new RoleGuardFactory(SECRET, { getMode: () => 'jwt' });
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
        secret: SECRET,
        getActiveConfig: holder.get,
        setActiveConfig: holder.set,
        authenticate: guards.authenticate(),
        requireAdmin: guards.requireAdmin(),
        requireWriter: guards.requireContributorOrAdmin(),
        upload: {} as never,
        passwordMatches: passwordMatcher
    });
    return app;
}

/** The config of this run: the web login is on, the posts live in the temp dir. */
function configWithWebLoginOn(): Config {
    const base = defaultConfig();
    return {
        ...base,
        postsDir,
        security: { ...base.security, disableWebLogin: false }
    };
}

/** A JSON-RPC call on /mcp with a personal access token. */
async function mcpCall(pat: string, body: unknown) {
    const res = await request(buildApp(configWithWebLoginOn()))
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(body);
    const parsed = typeof res.body === 'object' && res.body ? res.body : safeJson(res.text);
    return { status: res.status, body: parsed };
}

function safeJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** The audit rows of the login events. */
function loginAuditRows(): Record<string, any>[] {
    if (!fs.existsSync(auditFile)) return [];
    return fs
        .readFileSync(auditFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
        .filter((row) => row.event === 'login');
}

describe('MCP-only agent accounts (Track 2119 U7)', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-agent-2119-'));
        configFile = path.join(tmp, 'config.json');
        usersFile = path.join(tmp, 'users.json');
        tokensFile = path.join(tmp, 'tokens.json');
        auditFile = path.join(tmp, 'audit.log');
        postsDir = path.join(tmp, 'posts');
        fs.mkdirSync(postsDir);
        vi.stubEnv('CONFIG_PATH', configFile);
        vi.stubEnv('USERS_PATH', usersFile);
        vi.stubEnv('TOKENS_PATH', tokensFile);
        vi.stubEnv('AUDIT_LOG_PATH', auditFile);
        fs.writeFileSync(configFile, JSON.stringify(configWithWebLoginOn()));
        writeUsers({
            admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
            users: [
                { username: 'writer', passwordHash: 'h', role: 'contributor' },
                { username: 'ampere-mcp', passwordHash: '', role: 'contributor', mcpOnly: true }
            ]
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe('users.json', () => {
        it('keeps mcpOnly on a contributor account', () => {
            const { users, warnings } = sanitizeUsers({
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: [
                    { username: 'ampere-mcp', passwordHash: '', role: 'contributor', mcpOnly: true }
                ]
            });
            expect(users.users).toHaveLength(1);
            expect(users.users[0].mcpOnly).toBe(true);
            expect(warnings).toEqual([]);
        });

        it('drops mcpOnly from the admin block', () => {
            const { users, warnings } = sanitizeUsers({
                admin: { username: 'admin', passwordHash: 'h', role: 'admin', mcpOnly: true },
                users: []
            });
            expect(users.admin.mcpOnly).toBeUndefined();
            expect(warnings.join(' ')).toMatch(/admin/i);
        });

        it('drops mcpOnly from an account that is not a contributor', () => {
            const { users, warnings } = sanitizeUsers({
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: [{ username: 'boss', passwordHash: 'h', role: 'admin', mcpOnly: true }]
            });
            expect(users.users[0].mcpOnly).toBeUndefined();
            expect(warnings.join(' ')).toMatch(/mcpOnly/);
        });

        it('drops mcpOnly that is not exactly true', () => {
            for (const value of ['true', 1, 'yes', {}, []]) {
                const { users, warnings } = sanitizeUsers({
                    admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                    users: [
                        { username: 'ampere-mcp', passwordHash: '', role: 'contributor', mcpOnly: value }
                    ]
                });
                expect(users.users[0].mcpOnly).toBeUndefined();
                expect(warnings.join(' ')).toMatch(/mcpOnly/);
            }
        });
    });

    describe('findUserByUsername', () => {
        it('finds an mcpOnly contributor that has no password', () => {
            const users = loadUsers(usersFile);
            const found = findUserByUsername('ampere-mcp', users);
            expect(found).not.toBeNull();
            expect(found?.username).toBe('ampere-mcp');
            expect(found?.role).toBe('contributor');
            expect(found?.mcpOnly).toBe(true);
        });

        it('refuses an ordinary account whose hash is empty', () => {
            const users: UsersConfig = {
                admin: { username: 'admin', passwordHash: '', role: 'admin' },
                users: [{ username: 'locked', passwordHash: '', role: 'contributor' }]
            };
            expect(findUserByUsername('locked', users)).toBeNull();
        });

        it('keeps the admin rules', () => {
            const withHash: UsersConfig = {
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: []
            };
            expect(findUserByUsername('admin', withHash)?.username).toBe('admin');
            const withoutHash: UsersConfig = {
                admin: { username: 'admin', passwordHash: '', role: 'admin' },
                users: []
            };
            expect(findUserByUsername('admin', withoutHash)).toBeNull();
            expect(findUserByUsername('nobody', withHash)).toBeNull();
        });
    });

    describe('the web login', () => {
        it('refuses an mcpOnly account exactly like a wrong password', async () => {
            const app = buildApp(configWithWebLoginOn());
            const bad = await request(app)
                .post('/api/login')
                .send({ username: 'writer', password: 'wrong-password' });
            expect(bad.status).toBe(401);

            for (const password of ['anything', '', 'wrong-password']) {
                const res = await request(app)
                    .post('/api/login')
                    .send({ username: 'ampere-mcp', password });
                expect(res.status).toBe(bad.status);
                expect(res.body).toEqual(bad.body);
                expect(res.body).toEqual({ message: 'Invalid credentials' });
            }
        });

        it('writes an audit row that says why the login was refused', async () => {
            const app = buildApp(configWithWebLoginOn());
            await request(app)
                .post('/api/login')
                .send({ username: 'ampere-mcp', password: 'anything' });
            const rows = loginAuditRows();
            const refused = rows.find((row) => row.reason === 'mcp-only');
            expect(refused).toBeTruthy();
            expect(refused?.event).toBe('login');
            expect(refused?.outcome).toBe('rejected');
        });

        it('does the bcrypt work before it refuses an mcpOnly account', async () => {
            // A refusal that returns faster than a wrong password tells the caller
            // that the account exists. The refusal must cost the same compare.
            const spy = vi.fn(passwordMatches);
            const app = buildApp(configWithWebLoginOn(), spy);
            const res = await request(app)
                .post('/api/login')
                .send({ username: 'ampere-mcp', password: 'wrong-password' });
            expect(res.status).toBe(401);
            expect(res.body).toEqual({ message: 'Invalid credentials' });
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith('wrong-password', DUMMY_PASSWORD_HASH);
            // The dummy is a real bcrypt hash, so the compare really costs.
            expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$/);
            expect(await bcrypt.compare('anything', DUMMY_PASSWORD_HASH)).toBe(false);
        });
    });

    describe('a personal access token for an agent account', () => {
        it('authenticates on /mcp and creates a draft', async () => {
            // mint-token works for an mcpOnly account: findUserByUsername finds it.
            const { plaintext } = mintToken('ampere-mcp', 'agent', ['read', 'content:write']);
            expect(plaintext.startsWith('mdw_')).toBe(true);

            const tools = await mcpCall(plaintext, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {}
            });
            expect(tools.status).toBe(200);
            const names = (tools.body?.result?.tools || []).map((t: { name: string }) => t.name);
            expect(names).toContain('create_post');

            const created = await mcpCall(plaintext, {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'create_post',
                    arguments: { slug: 'agent-post', title: 'Agent', content: 'Body' }
                }
            });
            expect(created.status).toBe(200);
            expect(JSON.stringify(created.body)).toMatch(/Post saved|agent-post/);
            const post = getPost(postsDir, 'agent-post');
            expect(post?.status).toBe('draft');
            expect(post?.author).toBe('ampere-mcp');
        });

        it('stops working when the account is gone from users.json', async () => {
            const { plaintext } = mintToken('ampere-mcp', 'agent', ['read', 'content:write']);
            const before = await mcpCall(plaintext, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {}
            });
            expect(before.status).toBe(200);

            const users = readUsers();
            users.users = users.users.filter((u: { username: string }) => u.username !== 'ampere-mcp');
            writeUsers(users);

            const after = await mcpCall(plaintext, {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            });
            expect(after.status).toBe(401);
            expect(after.body).toEqual({ message: 'Invalid or expired token' });
        });
    });
});

describe('the create-agent-user CLI (Track 2119 U7)', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-agent-cli-2119-'));
        configFile = path.join(tmp, 'config.json');
        usersFile = path.join(tmp, 'users.json');
        tokensFile = path.join(tmp, 'tokens.json');
        auditFile = path.join(tmp, 'audit.log');
        vi.stubEnv('CONFIG_PATH', configFile);
        vi.stubEnv('USERS_PATH', usersFile);
        vi.stubEnv('TOKENS_PATH', tokensFile);
        vi.stubEnv('AUDIT_LOG_PATH', auditFile);
        writeUsers({
            admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
            users: [{ username: 'writer', passwordHash: 'h', role: 'contributor' }]
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe('the parser', () => {
        it('refuses a password option', () => {
            expect(() =>
                parseAgentUserArgs(['--username', 'ampere-mcp', '--scope', 'read', '--password', 'x'])
            ).toThrow(/password/i);
            expect(() =>
                parseAgentUserArgs(['--username', 'ampere-mcp', '--scope', 'read', '--password=x'])
            ).toThrow(/password/i);
        });

        it('refuses an unknown option', () => {
            expect(() =>
                parseAgentUserArgs(['--username', 'ampere-mcp', '--scope', 'read', '--nope', 'x'])
            ).toThrow(/unknown option/i);
        });

        it('refuses a bad username', () => {
            // Too short, uppercase, a leading dash, a space, a dollar: all refused.
            for (const name of ['a', 'A', 'Amp', '-agent', 'agent space', 'agent$', 'a'.repeat(64)]) {
                expect(() => parseAgentUserArgs(['--username', name, '--scope', 'read'])).toThrow();
            }
            // Two lowercase characters are the shortest name the rule accepts.
            expect(parseAgentUserArgs(['--username', 'ab', '--scope', 'read']).username).toBe('ab');
        });

        it('refuses the admin and moderate scopes', () => {
            expect(() => parseAgentUserArgs(['--username', 'agent', '--scope', 'admin'])).toThrow(
                /admin/
            );
            expect(() => parseAgentUserArgs(['--username', 'agent', '--scope', 'moderate'])).toThrow(
                /moderate/
            );
            expect(() => parseAgentUserArgs(['--username', 'agent', '--scope', 'read,admin'])).toThrow(
                /admin/
            );
            // The legacy "write" means every scope, admin included, so it is refused too.
            expect(() => parseAgentUserArgs(['--username', 'agent', '--scope', 'write'])).toThrow();
        });

        it('accepts read, content:write and publish', () => {
            const args = parseAgentUserArgs([
                '--username',
                'ampere-mcp',
                '--scope',
                'read,content:write,publish',
                '--label',
                'agent',
                '--ttl-days',
                '30'
            ]);
            expect(args.username).toBe('ampere-mcp');
            expect(args.label).toBe('agent');
            expect(args.ttlDays).toBe(30);
            expect([...args.scope]).toEqual(['read', 'content:write', 'publish']);
        });
    });

    describe('the CLI', () => {
        /** Run the CLI and collect what it wrote. */
        function run(argv: string[], isTTY = false) {
            let out = '';
            let err = '';
            const code = runCreateAgentUser({
                argv,
                stdout: (chunk) => {
                    out += chunk;
                },
                stderr: (chunk) => {
                    err += chunk;
                },
                isTTY
            });
            return { code, out, err };
        }

        it('refuses to run on a terminal', () => {
            const res = run(['--username', 'ampere-mcp', '--scope', 'read'], true);
            expect(res.code).toBe(1);
            expect(res.out).toBe('');
            expect(readUsers().users.map((u: { username: string }) => u.username)).toEqual(['writer']);
        });

        it('refuses a name that is taken and changes nothing', () => {
            const before = fs.readFileSync(usersFile, 'utf8');
            // The name of the admin is taken too.
            for (const name of ['writer', 'admin']) {
                const res = run(['--username', name, '--scope', 'read']);
                expect(res.code).toBe(1);
                expect(res.out).toBe('');
                expect(fs.readFileSync(usersFile, 'utf8')).toBe(before);
                expect(res.err).toMatch(/exists/i);
            }
        });

        it('writes one token line to stdout and the account to users.json', () => {
            const res = run(['--username', 'ampere-mcp', '--scope', 'read,content:write']);
            expect(res.code).toBe(0);
            expect(res.out).toMatch(/^mdw_[A-Za-z0-9_-]+\n$/);
            expect(res.out.split('\n').filter(Boolean)).toHaveLength(1);

            const token = res.out.trim();
            expect(verifyToken(token)?.username).toBe('ampere-mcp');

            const agent = readUsers().users.find((u: { username: string }) => u.username === 'ampere-mcp');
            expect(agent).toMatchObject({
                username: 'ampere-mcp',
                passwordHash: '',
                role: 'contributor',
                mcpOnly: true
            });

            // Everything but the token goes to stderr.
            expect(res.err).toMatch(/id=/);
            expect(res.err).not.toContain(token);
        });

        it('leaves no account behind when the token cannot be minted', () => {
            // Twenty live tokens for the name: minting refuses the twenty-first.
            const tokens = Array.from({ length: 20 }, (_, i) => ({
                id: `id-${i}`,
                username: 'ampere-mcp',
                label: 'old',
                hash: 'f'.repeat(64),
                prefix: 'oldoldol',
                scope: 'read',
                scopes: ['read'],
                createdAt: Date.now()
            }));
            fs.writeFileSync(tokensFile, JSON.stringify(tokens));

            const res = run(['--username', 'ampere-mcp', '--scope', 'read']);
            expect(res.code).toBe(1);
            expect(res.out).toBe('');
            expect(
                readUsers().users.find((u: { username: string }) => u.username === 'ampere-mcp')
            ).toBeUndefined();
        });

        it('refuses a missing users.json and creates no file', () => {
            fs.rmSync(usersFile);
            const res = run(['--username', 'ampere-mcp', '--scope', 'read']);
            expect(res.code).toBe(1);
            expect(res.out).toBe('');
            expect(res.err).toMatch(/users\.json/i);
            // Nothing is written: no file is created and nothing is quarantined.
            expect(fs.existsSync(usersFile)).toBe(false);
            expect(fs.readdirSync(tmp).filter((name) => name !== 'config.json')).toEqual([]);
        });

        it('refuses a corrupt users.json and leaves the bytes unchanged', () => {
            const corrupt = '{"admin": {"username": "admin", "passwordHash": "h", "role": "admin"';
            fs.writeFileSync(usersFile, corrupt);
            const res = run(['--username', 'ampere-mcp', '--scope', 'read']);
            expect(res.code).toBe(1);
            expect(res.out).toBe('');
            expect(res.err).toMatch(/users\.json/i);
            // The file is not quarantined and not rewritten.
            expect(fs.readFileSync(usersFile, 'utf8')).toBe(corrupt);
            expect(
                fs.readdirSync(tmp).filter((name) => name !== 'config.json' && name !== 'users.json')
            ).toEqual([]);
        });

        it('refuses a users.json whose root or admin block is unusable', () => {
            // A root that is not an object, and a file without an admin block.
            for (const content of ['[]', '"nope"', '{"users": []}']) {
                fs.writeFileSync(usersFile, content);
                const res = run(['--username', 'ampere-mcp', '--scope', 'read']);
                expect(res.code).toBe(1);
                expect(res.out).toBe('');
                expect(fs.readFileSync(usersFile, 'utf8')).toBe(content);
            }
            expect(
                fs.readdirSync(tmp).filter((name) => name !== 'config.json' && name !== 'users.json')
            ).toEqual([]);
        });
    });

    describe('the documented command', () => {
        // `npm run` prints its banner lines on stdout, and these examples send
        // stdout into a token file. An example without --silent would write the
        // banner into that file, so every example must be the silent form.
        const files = ['docs/MCP.md', 'server/scripts/create-agent-user.ts'];

        it('never shows a banner-carrying npm run', () => {
            for (const rel of files) {
                const text = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
                const commands = text
                    .split('\n')
                    // Strip the comment leader a script header uses, so its
                    // examples are read the same way as the docs' code blocks.
                    .map((line) => line.replace(/^\s*\*?\s*/, '').trim())
                    .filter((line) => line.startsWith('npm run '));
                expect(commands.length, `${rel} has no npm run example`).toBeGreaterThan(0);
                for (const line of commands) {
                    expect(line, `${rel}: ${line}`).toMatch(/^npm run --silent /);
                }
            }
        });

        it('names the direct form that prints no banner at all', () => {
            const docs = fs.readFileSync(path.resolve(process.cwd(), 'docs/MCP.md'), 'utf8');
            expect(docs).toContain('npx tsx server/scripts/create-agent-user.ts');
            expect(docs).toContain('npx tsx server/scripts/mint-token.ts');
        });
    });
});
