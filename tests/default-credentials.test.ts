import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import {
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_PASSWORD_HASH
} from '../server/lib/default-credentials.ts';
import { loadUsers, saveUsers, usersPath } from '../server/lib/config.ts';

describe('Default admin credentials (shipped sample)', () => {
    it('DEFAULT_ADMIN_PASSWORD_HASH verifies against DEFAULT_ADMIN_PASSWORD', async () => {
        const ok = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_PASSWORD_HASH);
        expect(ok).toBe(true);
    });

    it('DEFAULT_ADMIN_PASSWORD is the documented first-boot password "admin"', () => {
        expect(DEFAULT_ADMIN_USERNAME).toBe('admin');
        expect(DEFAULT_ADMIN_PASSWORD).toBe('admin');
    });

    it('wrong password does not match the shipped hash', async () => {
        expect(await bcrypt.compare('admin123', DEFAULT_ADMIN_PASSWORD_HASH)).toBe(false);
        expect(await bcrypt.compare('password', DEFAULT_ADMIN_PASSWORD_HASH)).toBe(false);
    });

    it('ports sample users.json uses the same hash constant', () => {
        const samplePath = path.resolve(process.cwd(), 'ports/www/mdweb/files/users.json.sample');
        const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
        expect(sample.admin.username).toBe(DEFAULT_ADMIN_USERNAME);
        expect(sample.admin.passwordHash).toBe(DEFAULT_ADMIN_PASSWORD_HASH);
    });
});

describe('Login with shipped default users', () => {
    const backupPath = usersPath() + '.bak-default-cred-test';

    beforeEach(() => {
        const p = usersPath();
        if (fs.existsSync(p)) {
            fs.copyFileSync(p, backupPath);
        }
        // Exact first-boot shape — no rehash tricks
        saveUsers({
            admin: {
                username: DEFAULT_ADMIN_USERNAME,
                passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
                role: 'admin'
            },
            users: []
        });
    });

    afterEach(() => {
        const p = usersPath();
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, p);
            fs.unlinkSync(backupPath);
        }
    });

    it('POST /api/login accepts admin / admin with shipped hash', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: DEFAULT_ADMIN_USERNAME, password: DEFAULT_ADMIN_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.role).toBe('admin');
        expect(res.body.username).toBe(DEFAULT_ADMIN_USERNAME);
    });

    it('POST /api/login rejects admin123 against shipped hash', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: DEFAULT_ADMIN_USERNAME, password: 'admin123' });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
    });

    it('loadUsers default hash still matches DEFAULT_ADMIN_PASSWORD after wipe', async () => {
        const p = usersPath();
        if (fs.existsSync(p)) fs.unlinkSync(p);
        const users = loadUsers();
        expect(users.admin.passwordHash).toBe(DEFAULT_ADMIN_PASSWORD_HASH);
        expect(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, users.admin.passwordHash)).toBe(true);
    });
});
