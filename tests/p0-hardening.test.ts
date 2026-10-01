/**
 * P0 hardening — red/green for fail-closed users, atomic saves, auth recheck, rc argv.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { loadUsers, saveUsers, saveConfig, sanitizeUsers } from '../server/lib/config.ts';
import {
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_PASSWORD_HASH
} from '../server/lib/default-credentials.ts';
import { FileSessionStore } from '../server/lib/session-store.ts';
import { runPreflight } from '../server/lib/preflight.ts';
import { app } from '../server/index.ts';

const HASH = DEFAULT_ADMIN_PASSWORD_HASH;

describe('P0: fail-closed users.json', () => {
    let dir: string;
    let usersFile: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-p0-users-'));
        usersFile = path.join(dir, 'users.json');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('corrupt users.json quarantines and does NOT yield a loginable default password', async () => {
        fs.writeFileSync(usersFile, '{not-json');
        const users = loadUsers(usersFile);
        expect(fs.readdirSync(dir).some((f) => f.includes('.bad-'))).toBe(true);
        expect(fs.existsSync(usersFile)).toBe(false);
        // Must not rewrite admin/admin to disk after quarantine
        expect(fs.existsSync(usersFile)).toBe(false);
        const ok = users.admin.passwordHash
            ? await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, users.admin.passwordHash)
            : false;
        expect(ok).toBe(false);
    });

    it('empty users.json quarantines without rewriting default credentials', async () => {
        fs.writeFileSync(usersFile, '   \n');
        const users = loadUsers(usersFile);
        expect(fs.existsSync(usersFile)).toBe(false);
        expect(users.admin.passwordHash).not.toBe(HASH);
        expect(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, users.admin.passwordHash || 'x')).toBe(
            false
        );
    });

    it('unreadable users.json returns locked admin (not default hash)', async () => {
        fs.writeFileSync(usersFile, '{"admin":{"username":"a","passwordHash":"h","role":"admin"},"users":[]}');
        const spy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
            throw new Error('EIO');
        });
        const users = loadUsers(usersFile);
        spy.mockRestore();
        expect(users.admin.passwordHash).not.toBe(HASH);
        expect(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, users.admin.passwordHash || 'x')).toBe(
            false
        );
    });

    it('sanitizeUsers never invents DEFAULT_ADMIN_PASSWORD_HASH for missing hash', async () => {
        const { users, warnings } = sanitizeUsers({
            admin: { username: 'alice', role: 'admin' },
            users: []
        });
        expect(users.admin.username).toBe('alice');
        expect(users.admin.passwordHash).toBe('');
        expect(users.admin.passwordHash).not.toBe(HASH);
        expect(warnings.some((w) => w.includes('passwordHash'))).toBe(true);
        expect(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, users.admin.passwordHash || 'x')).toBe(
            false
        );
    });

    it('sanitizeUsers keeps empty string hash empty (no default substitution)', () => {
        const { users } = sanitizeUsers({
            admin: { username: 'alice', passwordHash: '', role: 'admin' },
            users: []
        });
        expect(users.admin.passwordHash).toBe('');
    });
});

describe('P0: atomic JSON saves', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-p0-atomic-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('saveUsers writes via temp file then rename (no direct writeFileSync to target)', () => {
        const usersFile = path.join(dir, 'users.json');
        const targets: string[] = [];
        const orig = fs.writeFileSync.bind(fs);
        const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data, opts) => {
            targets.push(String(p));
            return orig(p, data, opts as never);
        });
        saveUsers(
            {
                admin: { username: 'admin', passwordHash: 'h', role: 'admin' },
                users: []
            },
            usersFile
        );
        spy.mockRestore();
        expect(fs.existsSync(usersFile)).toBe(true);
        // Direct write must land on a .tmp path, not the final users.json
        expect(targets.some((t) => t.endsWith('.tmp') || path.basename(t).includes('.tmp'))).toBe(
            true
        );
        expect(targets.includes(usersFile)).toBe(false);
        expect(JSON.parse(fs.readFileSync(usersFile, 'utf8')).admin.username).toBe('admin');
    });

    it('saveConfig uses atomic temp+rename', () => {
        const configFile = path.join(dir, 'config.json');
        const targets: string[] = [];
        const orig = fs.writeFileSync.bind(fs);
        const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data, opts) => {
            targets.push(String(p));
            return orig(p, data, opts as never);
        });
        saveConfig(
            { postsDir: './posts', themeDir: './themes', currentTheme: 'dark' },
            configFile
        );
        spy.mockRestore();
        expect(targets.some((t) => String(t).includes('.tmp'))).toBe(true);
        expect(targets.includes(configFile)).toBe(false);
        expect(fs.existsSync(configFile)).toBe(true);
    });
});

describe('P0: auth rechecks live users.json', () => {
    let sessionDir: string;

    beforeEach(() => {
        sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-p0-sess-'));
    });

    afterEach(() => {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    });

    it('JWT for a deleted contributor is rejected', async () => {
        const users = loadUsers();
        const hash = await bcrypt.hash('contrib-pass-99', 10);
        users.users = [{ username: 'doomed', passwordHash: hash, role: 'contributor' }];
        saveUsers(users);

        const secret = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
        const token = jwt.sign({ username: 'doomed', role: 'contributor' }, secret);

        // Delete user
        users.users = [];
        saveUsers(users);

        const res = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
    });

    it('session for deleted user is destroyed and rejected', async () => {
        const store = new FileSessionStore(sessionDir);
        const rec = store.create('ghost', 'contributor', 3600);
        expect(store.get(rec.id)).not.toBeNull();

        const destroyed = store.destroyForUser('ghost');
        expect(destroyed).toBeGreaterThanOrEqual(1);
        expect(store.get(rec.id)).toBeNull();
    });

    it('DELETE /api/admin/users purges that user sessions', async () => {
        const users = loadUsers();
        const hash = await bcrypt.hash('contrib-pass-99', 10);
        users.users = [{ username: 'purge-me', passwordHash: hash, role: 'contributor' }];
        saveUsers(users);

        const secret = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
        // Ensure JWT mode for admin delete
        vi.stubEnv('MDWEB_AUTH_MODE', 'jwt');

        const adminTok = jwt.sign({ username: 'admin', role: 'admin' }, secret);
        const del = await request(app)
            .delete('/api/admin/users/purge-me')
            .set('Authorization', `Bearer ${adminTok}`);
        expect(del.status).toBe(200);

        const stale = jwt.sign({ username: 'purge-me', role: 'contributor' }, secret);
        const me = await request(app).get('/api/me').set('Authorization', `Bearer ${stale}`);
        expect(me.status).toBe(403);
        vi.unstubAllEnvs();
    });
});

describe('P0: preflight default admin password', () => {
    it('flags DEFAULT_ADMIN_PASSWORD in production as critical', async () => {
        const users = loadUsers();
        users.admin.passwordHash = HASH;
        saveUsers(users);
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'a-perfectly-fine-jwt-secret-32chars!!';
        const issues = await runPreflight(false);
        process.env.NODE_ENV = prev;
        expect(issues.some((i) => i.id === 'DEFAULT_ADMIN_PASSWORD' && i.critical)).toBe(true);
    });
});

describe('P0: getimage malformed percent-escape', () => {
    it('does not 500 on malformed fileName', async () => {
        const res = await request(app).get('/api/getimage?fileName=100%');
        expect(res.status).not.toBe(500);
        expect([400, 403, 404]).toContain(res.status);
    });
});

describe('P0: rc scripts do not put JWT_SECRET on argv', () => {
    it('ports mdweb.in exports secret and omits JWT_SECRET= from command_args', () => {
        const src = fs.readFileSync(
            path.join(process.cwd(), 'ports/www/mdweb/files/mdweb.in'),
            'utf8'
        );
        expect(src).toMatch(/export\s+JWT_SECRET/);
        // command_args block must not interpolate JWT_SECRET into env argv
        const argsLine = src
            .split('\n')
            .filter((l) => l.includes('command_args') || l.includes('JWT_SECRET='))
            .join('\n');
        expect(argsLine).not.toMatch(/command_args=.*JWT_SECRET=\$/);
        expect(src).not.toMatch(/env[^\\n]*JWT_SECRET=\$\{JWT_SECRET\}/);
    });

    it('root mdweb.rc omits JWT_SECRET from daemon argv', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'mdweb.rc'), 'utf8');
        expect(src).not.toMatch(/JWT_SECRET=\$\{JWT_SECRET\}/);
        expect(src).toMatch(/export\s+JWT_SECRET/);
    });
});
