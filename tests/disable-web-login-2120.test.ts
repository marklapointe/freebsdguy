/**
 * Track 2120 — security.disableWebLogin: config-file-only kill switch for the web login.
 *
 * When the flag is on, POST /api/login answers 404 {"message":"Not Found"} without reading
 * credentials and without running bcrypt. PAT auth and the session middleware are untouched,
 * and neither the admin UI save nor the MCP update_config tool may set or clear the flag.
 *
 * The config FILE is the single source of truth: the admin UI save and the MCP update_config
 * tool both preserve what the file says, even when the in-memory active config disagrees.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerRoutes } from '../server/register-routes.ts';
import { createActiveConfigHolder } from '../server/lib/app-context.ts';
import { RoleGuardFactory } from '../server/middleware/auth.ts';
import {
    defaultConfig,
    sanitizeConfig,
    saveConfig,
    webLoginDisabled,
    webLoginDisabledOnDisk,
    type Config
} from '../server/lib/config.ts';
import { projectSecurity } from '../server/lib/public-config.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { createMdwebMcpServer } from '../server/mcp/create-server.ts';
import { LEGACY_WRITE_SCOPES } from '../server/lib/token-scope.ts';

/** Per-run secret: a fixed key would let a token minted by another run validate here. */
const SECRET = crypto.randomBytes(32).toString('hex');

let tmp = '';
let configFile = '';
let usersFile = '';
let auditFile = '';

/** A config whose flag value is explicit, so the test controls the switch. */
function configWith(disableWebLogin: boolean): Config {
    const base = defaultConfig();
    return { ...base, security: { ...base.security, disableWebLogin } };
}

/** The config as it is on disk (the source of truth for the flag). */
function readFileConfig(): Config {
    return JSON.parse(fs.readFileSync(configFile, 'utf8')) as Config;
}

/** Express app bound to an in-memory active config (the file-backed one stays untouched). */
function buildApp(active: Config) {
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
        upload: {} as never
    });
    return { app, holder };
}

function adminToken(): string {
    return jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
}

/**
 * Run the MCP update_config tool against an in-memory active config.
 * The tool writes the merged config to CONFIG_PATH, so the file on disk is the proof.
 */
async function runMcpUpdate(active: Config, patch: Record<string, unknown>) {
    const state: { saved: Config | null } = { saved: null };
    const server = createMdwebMcpServer({
        user: { username: 'admin', role: 'admin' },
        getActive: () => active,
        setActive: (c: Config) => {
            state.saved = c;
        },
        tokenScopes: LEGACY_WRITE_SCOPES
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 't2120', version: '0' });
    await client.connect(clientT);
    const result = await client.callTool({ name: 'update_config', arguments: { patch } });
    await client.close();
    await server.close();
    const blocks = result.content as { type: string; text: string }[];
    const payload = JSON.parse(blocks[0].text) as { message: string; warnings: string[] };
    return { result, saved: state.saved, warnings: payload.warnings ?? [] };
}

/**
 * Run the MCP set_theme tool against an in-memory active config.
 * The tool writes the config to CONFIG_PATH, so the file on disk is the proof.
 */
async function runMcpSetTheme(active: Config, themeId: string) {
    const state: { saved: Config | null } = { saved: null };
    const server = createMdwebMcpServer({
        user: { username: 'admin', role: 'admin' },
        getActive: () => active,
        setActive: (c: Config) => {
            state.saved = c;
        },
        tokenScopes: LEGACY_WRITE_SCOPES
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 't2120-set-theme', version: '0' });
    await client.connect(clientT);
    const result = await client.callTool({ name: 'set_theme', arguments: { themeId } });
    await client.close();
    await server.close();
    return { result, saved: state.saved };
}

describe('security.disableWebLogin (Track 2120)', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-2120-'));
        configFile = path.join(tmp, 'config.json');
        usersFile = path.join(tmp, 'users.json');
        auditFile = path.join(tmp, 'audit.log');
        vi.stubEnv('CONFIG_PATH', configFile);
        vi.stubEnv('USERS_PATH', usersFile);
        vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
        vi.stubEnv('AUDIT_LOG_PATH', auditFile);
        fs.writeFileSync(
            usersFile,
            JSON.stringify({
                admin: { username: 'admin', passwordHash: bcrypt.hashSync('admin-secret', 10), role: 'admin' },
                users: []
            })
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('is off by default: POST /api/login with wrong credentials still answers 401', async () => {
        const { app } = buildApp(configWith(false));
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('is off by default in defaultConfig()', () => {
        expect(defaultConfig().security?.disableWebLogin).toBe(false);
    });

    it('answers 404 and never runs bcrypt when the flag is on', async () => {
        const { app } = buildApp(configWith(true));
        const compare = vi.spyOn(bcrypt, 'compare');
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'admin-secret' });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Not Found' });
        expect(compare).not.toHaveBeenCalled();
    });

    it('writes an audit line with outcome disabled when the flag is on', async () => {
        const { app } = buildApp(configWith(true));
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'admin-secret' });
        expect(res.status).toBe(404);
        // The audit line is appended synchronously, so reading it right after the
        // response is safe.
        const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
        const disabled = lines.find((l) => /"event":"login"/.test(l) && /"outcome":"disabled"/.test(l));
        expect(disabled).toBeTruthy();
    });

    it('keeps PAT auth working when the flag is on', async () => {
        const { app } = buildApp(configWith(true));
        const pat = mintToken('admin', '2120-pat', 'read').plaintext;
        const res = await request(app).get('/api/me').set('Authorization', `Bearer ${pat}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('admin');
    });

    it('sanitizeConfig keeps a boolean flag and coerces anything else to false', () => {
        expect(sanitizeConfig({ security: { disableWebLogin: true } }).config.security?.disableWebLogin).toBe(true);
        expect(sanitizeConfig({ security: { disableWebLogin: false } }).config.security?.disableWebLogin).toBe(false);
        expect(sanitizeConfig({ security: { disableWebLogin: 'yes' } }).config.security?.disableWebLogin).toBe(false);
        expect(sanitizeConfig({ security: {} }).config.security?.disableWebLogin).toBe(false);
        expect(sanitizeConfig({}).config.security?.disableWebLogin).toBe(false);
    });

    it('sanitizeConfig warns that a non-boolean flag was dropped', () => {
        const { config, warnings } = sanitizeConfig({ security: { disableWebLogin: 'yes' } });
        expect(warnings).toContain('security.disableWebLogin invalid; using false');
        expect(config.security?.disableWebLogin).toBe(false);
        expect(sanitizeConfig({ security: { disableWebLogin: true } }).warnings).not.toContain(
            'security.disableWebLogin invalid; using false'
        );
    });

    it('projectSecurity exposes the flag', () => {
        expect(projectSecurity(configWith(true)).disableWebLogin).toBe(true);
        expect(projectSecurity(configWith(false)).disableWebLogin).toBe(false);
    });

    it('exports webLoginDisabledOnDisk, which reads the flag from the config file', () => {
        expect(typeof webLoginDisabledOnDisk).toBe('function');
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        expect(webLoginDisabledOnDisk()).toBe(true);
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        expect(webLoginDisabledOnDisk()).toBe(false);
    });

    it('POST /api/admin/config cannot clear the flag', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        const { app } = buildApp(configWith(true));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { disableWebLogin: false }, siteName: 'Admin Save Cleared The Flag' });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        // The siteName proves the file was really rewritten, not left untouched.
        expect(saved.siteName).toBe('Admin Save Cleared The Flag');
    });

    it('POST /api/admin/config cannot set the flag', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        const { app } = buildApp(configWith(false));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { disableWebLogin: true }, siteName: 'Admin Save Set The Flag' });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(false);
        expect(saved.siteName).toBe('Admin Save Set The Flag');
    });

    it('POST /api/admin/config without a security section keeps the flag', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        const { app } = buildApp(configWith(true));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ siteName: 'Untouched By The Kill Switch' });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        expect(saved.siteName).toBe('Untouched By The Kill Switch');
    });

    it('POST /api/admin/config keeps the flag the file says, even when the active config says otherwise', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // The in-memory copy is stale and says false; the file is the source of truth.
        const { app } = buildApp(configWith(false));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ siteName: 'File Wins Over Memory' });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        expect(saved.siteName).toBe('File Wins Over Memory');
    });

    it('MCP update_config cannot clear or set the flag', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        const cleared = await runMcpUpdate(configWith(true), { security: { disableWebLogin: false } });
        expect(cleared.result.isError).toBeFalsy();
        expect(cleared.saved?.security?.disableWebLogin).toBe(true);
        expect(readFileConfig().security?.disableWebLogin).toBe(true);

        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        const set = await runMcpUpdate(configWith(false), { security: { disableWebLogin: true } });
        expect(set.result.isError).toBeFalsy();
        expect(set.saved?.security?.disableWebLogin).toBe(false);
        expect(readFileConfig().security?.disableWebLogin).toBe(false);
    });

    it('MCP update_config keeps the flag the file says, even when the active config says otherwise', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // The in-memory copy is stale and says false; the file is the source of truth.
        const run = await runMcpUpdate(configWith(false), { siteName: 'MCP File Wins Over Memory' });
        expect(run.result.isError).toBeFalsy();
        expect(run.saved?.security?.disableWebLogin).toBe(true);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        expect(saved.siteName).toBe('MCP File Wins Over Memory');
    });

    it('MCP update_config warns that security.disableWebLogin is ignored', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        const run = await runMcpUpdate(configWith(false), { security: { disableWebLogin: true } });
        expect(run.warnings).toContain('security.disableWebLogin is config-file only; ignored');

        const untouched = await runMcpUpdate(configWith(false), { siteName: 'No Flag In The Patch' });
        expect(untouched.warnings).not.toContain('security.disableWebLogin is config-file only; ignored');
    });

    it('a hand edit of the config file disables the login without a restart', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // The in-memory copy is stale and says the login is on; the file wins.
        const { app } = buildApp(configWith(false));
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'admin-secret' });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Not Found' });
    });

    it('fails closed: the login stays off when either source disables it', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        // The file says the login is on, the in-memory copy says off: off wins.
        const { app } = buildApp(configWith(true));
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'admin-secret' });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Not Found' });
    });

    it('a broken config file does not clear the flag on an admin save', async () => {
        fs.writeFileSync(configFile, '{not json');
        // The file cannot be read, so the in-memory value (true) must survive the save.
        const { app } = buildApp(configWith(true));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ siteName: 'x', security: {} });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
    });

    it('webLoginDisabledOnDisk is tri-state: undefined when the file cannot be read', () => {
        expect(typeof webLoginDisabledOnDisk).toBe('function');
        // No file at all.
        expect(webLoginDisabledOnDisk()).toBeUndefined();
        // A file that is not valid JSON.
        fs.writeFileSync(configFile, '{not json');
        expect(webLoginDisabledOnDisk()).toBeUndefined();
        // A file that is valid JSON: the flag itself, true or false.
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        expect(webLoginDisabledOnDisk()).toBe(true);
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        expect(webLoginDisabledOnDisk()).toBe(false);
    });

    it('webLoginDisabled merges the file and the in-memory copy', () => {
        expect(typeof webLoginDisabled).toBe('function');
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        expect(webLoginDisabled(configWith(false))).toBe(true);
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        expect(webLoginDisabled(configWith(true))).toBe(true);
        expect(webLoginDisabled(configWith(false))).toBe(false);
        expect(webLoginDisabled(undefined)).toBe(false);
    });

    it('POST /api/admin/config warns that security.disableWebLogin is ignored', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(false)));
        const { app } = buildApp(configWith(false));
        const withFlag = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: { disableWebLogin: true } });
        expect(withFlag.status).toBe(200);
        expect(withFlag.body.warnings).toContain('security.disableWebLogin is config-file only; ignored');

        const withoutFlag = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ security: {} });
        expect(withoutFlag.status).toBe(200);
        expect(withoutFlag.body.warnings ?? []).not.toContain(
            'security.disableWebLogin is config-file only; ignored'
        );
    });

    it('a broken config file does not clear the flag on an admin save without a security section', async () => {
        fs.writeFileSync(configFile, '{not json');
        // The file cannot be read, so the in-memory value (true) must survive the save.
        const { app } = buildApp(configWith(true));
        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ siteName: 'Broken File No Security Section' });
        expect(res.status).toBe(200);
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        expect(saved.siteName).toBe('Broken File No Security Section');
    });

    it('projectSecurity reports the flag the config file says, even when the passed config says otherwise', () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // A hand edit of the file wins over the stale in-memory copy.
        expect(projectSecurity(configWith(false)).disableWebLogin).toBe(true);
    });

    it('the MCP update_config description says the flag is config-file only', async () => {
        const server = createMdwebMcpServer({
            user: { username: 'admin', role: 'admin' },
            getActive: () => configWith(false),
            setActive: () => {},
            tokenScopes: LEGACY_WRITE_SCOPES
        });
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await server.connect(serverT);
        const client = new Client({ name: 't2120-desc', version: '0' });
        await client.connect(clientT);
        const listed = await client.listTools();
        await client.close();
        await server.close();
        const update = listed.tools.find((t) => t.name === 'update_config');
        expect(update?.description).toContain('security.disableWebLogin is config-file only');
    });

    it('saveConfig keeps the flag the file says, even when the config it is given says otherwise', () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // A stale in-memory config (the MCP set_theme path) must not clear the kill switch.
        saveConfig(configWith(false));
        expect(readFileConfig().security?.disableWebLogin).toBe(true);
    });

    it('MCP set_theme keeps the flag the file says, even when the active config says otherwise', async () => {
        fs.writeFileSync(configFile, JSON.stringify(configWith(true)));
        // The in-memory copy is stale and says false; the file is the source of truth.
        const run = await runMcpSetTheme(configWith(false), 'dark');
        expect(run.result.isError).toBeFalsy();
        const saved = readFileConfig();
        expect(saved.security?.disableWebLogin).toBe(true);
        // The theme really changed, so the save went through.
        expect(saved.currentTheme).toBe('dark');
    });
});
