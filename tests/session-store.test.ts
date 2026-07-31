import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileSessionStore, parseCookies, sessionCookieHeader } from '../server/lib/session-store.ts';

describe('FileSessionStore', () => {
    let dir: string;
    let store: FileSessionStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-sess-'));
        store = new FileSessionStore(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('create get destroy', () => {
        const rec = store.create('admin', 'admin', 3600);
        expect(rec.id.length).toBeGreaterThanOrEqual(32);
        const got = store.get(rec.id);
        expect(got?.username).toBe('admin');
        store.destroy(rec.id);
        expect(store.get(rec.id)).toBeNull();
    });

    it('expires sessions', () => {
        const rec = store.create('u', 'contributor', 1);
        // force expiry
        const fp = path.join(dir, `${rec.id}.json`);
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        data.expiresAt = Date.now() - 1000;
        fs.writeFileSync(fp, JSON.stringify(data));
        expect(store.get(rec.id)).toBeNull();
    });

    it('parseCookies and cookie header', () => {
        expect(parseCookies('a=1; mdweb.sid=abc')).toEqual({ a: '1', 'mdweb.sid': 'abc' });
        const h = sessionCookieHeader('mdweb.sid', 'xyz', 60, false);
        expect(h).toContain('HttpOnly');
        expect(h).toContain('SameSite=Lax');
        expect(h).not.toContain('Secure');
    });
});
