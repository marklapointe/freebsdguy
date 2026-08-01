import { describe, it, expect } from 'vitest';
import path from 'path';
import {
    isSafePath,
    resolveConfiguredPath,
    resolvePostsDir,
    resolveImagesDir
} from '../server/lib/safe-path.ts';

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

describe('resolveConfiguredPath (path algebra)', () => {
    const base = '/var/db/mdweb';

    it('keeps absolute paths', () => {
        expect(resolveConfiguredPath(base, '/abs/posts')).toBe('/abs/posts');
    });

    it('joins relative paths to base', () => {
        expect(resolveConfiguredPath(base, './posts')).toBe(path.resolve(base, './posts'));
    });

    it('empty configured resolves to base', () => {
        expect(resolveConfiguredPath(base, '')).toBe(path.resolve(base));
        expect(resolveConfiguredPath(base, null)).toBe(path.resolve(base));
    });

    it('posts + images composition', () => {
        expect(resolvePostsDir(base, 'content')).toBe(path.resolve(base, 'content'));
        expect(resolveImagesDir(base, 'content')).toBe(path.join(path.resolve(base, 'content'), 'images'));
    });
});
