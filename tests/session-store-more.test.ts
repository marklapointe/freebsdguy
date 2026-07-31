import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    FileSessionStore,
    parseCookies,
    sessionCookieHeader,
    clearSessionCookieHeader,
    defaultSessionDir
} from '../server/lib/session-store.ts';

describe('session-store extras', () => {
    it('defaultSessionDir returns a path', () => {
        expect(defaultSessionDir()).toBeTruthy();
    });

    it('purgeExpired removes old sessions', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-purge-'));
        const store = new FileSessionStore(dir);
        const rec = store.create('a', 'admin', 3600);
        const fp = path.join(dir, `${rec.id}.json`);
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        data.expiresAt = Date.now() - 5000;
        fs.writeFileSync(fp, JSON.stringify(data));
        // corrupt file should be skipped
        fs.writeFileSync(path.join(dir, 'junk.json'), '{not json');
        fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
        const n = store.purgeExpired();
        expect(n).toBeGreaterThanOrEqual(1);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fileFor rejects bad ids via get/destroy', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-badid-'));
        const store = new FileSessionStore(dir);
        expect(store.get('../etc/passwd')).toBeNull();
        expect(store.get('short')).toBeNull();
        store.destroy('!!!');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('clearSessionCookieHeader and secure cookie', () => {
        const h = sessionCookieHeader('sid', 'abc', 10, true);
        expect(h).toContain('Secure');
        expect(clearSessionCookieHeader('sid', false)).toContain('Max-Age=0');
        expect(parseCookies(undefined)).toEqual({});
        expect(parseCookies('=novalue; x=1')).toEqual({ x: '1' });
    });

    it('get handles corrupt session file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-corrupt-'));
        const store = new FileSessionStore(dir);
        const id = 'a'.repeat(64);
        fs.writeFileSync(path.join(dir, `${id}.json`), 'not-json');
        expect(store.get(id)).toBeNull();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
