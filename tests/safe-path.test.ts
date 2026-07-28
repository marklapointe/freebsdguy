import { describe, it, expect } from 'vitest';
import path from 'path';
import { isSafePath } from '../server/lib/safe-path.ts';

describe('isSafePath (INV-SEC-3)', () => {
    const base = path.resolve('/var/db/mdweb/posts/images');

    it('allows files inside base', () => {
        expect(isSafePath(base, path.join(base, 'logo.webp'))).toBe(true);
    });

    it('allows the base itself', () => {
        expect(isSafePath(base, base)).toBe(true);
    });

    it('rejects parent traversal', () => {
        expect(isSafePath(base, path.join(base, '..', '..', 'etc', 'passwd'))).toBe(false);
    });

    it('rejects absolute escape', () => {
        expect(isSafePath(base, '/etc/passwd')).toBe(false);
    });
});
