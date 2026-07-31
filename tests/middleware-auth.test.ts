import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RoleGuardFactory, isAllowedRole, ALLOWED_ROLES } from '../server/middleware/auth.ts';
import { FileSessionStore } from '../server/lib/session-store.ts';

function mockRes() {
    const res: any = {
        statusCode: 200,
        body: null as any,
        status(c: number) {
            this.statusCode = c;
            return this;
        },
        json(b: any) {
            this.body = b;
            return this;
        }
    };
    return res;
}

describe('RoleGuardFactory', () => {
    const secret = 'test-secret-at-least-16-chars';
    let dir: string;
    let store: FileSessionStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-auth-'));
        store = new FileSessionStore(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('isAllowedRole and ALLOWED_ROLES', () => {
        expect(isAllowedRole('admin')).toBe(true);
        expect(isAllowedRole('contributor')).toBe(true);
        expect(isAllowedRole('nope')).toBe(false);
        expect(ALLOWED_ROLES).toContain('admin');
    });

    it('jwt authenticate success and failure', () => {
        const g = new RoleGuardFactory(secret);
        const auth = g.authenticate();
        const next = vi.fn();

        const res1 = mockRes();
        auth({ headers: {} } as any, res1, next);
        expect(res1.statusCode).toBe(401);

        const res2 = mockRes();
        auth({ headers: { authorization: 'Bearer bad' } } as any, res2, next);
        // async jwt.verify
        return new Promise<void>(resolve => {
            setTimeout(() => {
                expect(res2.statusCode).toBe(403);
                const token = jwt.sign({ username: 'a', role: 'admin' }, secret);
                const res3 = mockRes();
                const req3: any = { headers: { authorization: `Bearer ${token}` } };
                auth(req3, res3, next);
                setTimeout(() => {
                    expect(next).toHaveBeenCalled();
                    expect(req3.user.username).toBe('a');
                    resolve();
                }, 20);
            }, 20);
        });
    });

    it('session authenticate success and failures', () => {
        const g = new RoleGuardFactory(secret, {
            getMode: () => 'session',
            getSessionStore: () => store,
            getSessionCookieName: () => 'mdweb.sid'
        });
        const auth = g.authenticate();
        const next = vi.fn();
        const res1 = mockRes();
        auth({ headers: {} } as any, res1, next);
        expect(res1.statusCode).toBe(401);

        const res2 = mockRes();
        auth({ headers: { cookie: 'mdweb.sid=deadbeef' } } as any, res2, next);
        expect(res2.statusCode).toBe(403);

        const rec = store.create('bob', 'contributor', 3600);
        const res3 = mockRes();
        const req3: any = { headers: { cookie: `mdweb.sid=${rec.id}` } };
        auth(req3, res3, next);
        expect(next).toHaveBeenCalled();
        expect(req3.user.username).toBe('bob');
        expect(req3.user.role).toBe('contributor');
    });

    it('requireAdmin and requireContributorOrAdmin', () => {
        const g = new RoleGuardFactory(secret);
        const admin = g.requireAdmin();
        const writer = g.requireContributorOrAdmin();
        const next = vi.fn();

        const r1 = mockRes();
        admin({ user: { role: 'contributor' } } as any, r1, next);
        expect(r1.statusCode).toBe(403);

        const r2 = mockRes();
        admin({ user: { role: 'admin' } } as any, r2, next);
        expect(next).toHaveBeenCalled();

        const r3 = mockRes();
        writer({ user: { role: 'contributor' } } as any, r3, next);
        expect(next).toHaveBeenCalled();
    });

    it('default opts construct store', () => {
        const g = new RoleGuardFactory(secret);
        expect(g).toBeTruthy();
        // exercise default getSessionStore path via session mode without custom store
        const g2 = new RoleGuardFactory(secret, { getMode: () => 'session' });
        const auth = g2.authenticate();
        const res = mockRes();
        auth({ headers: {} } as any, res, vi.fn());
        expect(res.statusCode).toBe(401);
    });
});
