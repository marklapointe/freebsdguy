import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureDemoPosts, shippedPostsDir } from '../server/lib/demo-posts.ts';

describe('demo-posts seed', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-demo-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('shippedPostsDir finds server/posts', () => {
        const d = shippedPostsDir();
        expect(fs.existsSync(d)).toBe(true);
    });

    it('copies missing demo posts only', () => {
        const r1 = ensureDemoPosts(dir);
        expect(r1.copied.length).toBeGreaterThan(0);
        expect(r1.total).toBeGreaterThanOrEqual(r1.copied.length);
        const r2 = ensureDemoPosts(dir);
        expect(r2.copied.length).toBe(0);
        expect(r2.total).toBe(r1.total);
    });

    it('creates postsDir if missing', () => {
        const nested = path.join(dir, 'nested', 'posts');
        const r = ensureDemoPosts(nested);
        expect(fs.existsSync(nested)).toBe(true);
        expect(r.total).toBeGreaterThan(0);
    });
});
