/**
 * Track #1682 (Mark, 2026-11-03 5:55 PM CT): renaming a post keeps old links
 * working. Front matter `aliases: [old-slug]` makes /post/old-slug and
 * /api/posts/old-slug answer a permanent 301 to the new slug.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from '../server/index';
import { loadConfig, configPath } from '../server/lib/config';
import { findPostByAlias } from '../server/lib/posts';

const cfg = loadConfig();
const dir = path.isAbsolute(cfg.postsDir) ? cfg.postsDir : path.resolve(path.dirname(configPath()), cfg.postsDir);
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const NEWSLUG = `alias-new-${RUN}`, OLDSLUG = `alias-old-${RUN}`;
const NEW = path.join(dir, `${NEWSLUG}.md`);

describe('post aliases', () => {
    beforeAll(() => {
        fs.mkdirSync(dir, { recursive: true });
        expect(fs.existsSync(NEW)).toBe(false); // never touch a real post
        fs.writeFileSync(NEW, `---\ntitle: New\naliases:\n  - ${OLDSLUG}\n  - "bad/../slug"\n---\nbody\n`, { flag: 'wx' });
    });
    afterAll(() => { fs.rmSync(NEW, { force: true }); });

    it('findPostByAlias maps an old slug to the current one, ignores unsafe aliases', () => {
        expect(findPostByAlias(dir, OLDSLUG)).toBe(NEWSLUG);
        expect(findPostByAlias(dir, 'bad/../slug')).toBeNull();
        expect(findPostByAlias(dir, 'nope-t')).toBeNull();
        const t = fs.mkdtempSync(path.join(os.tmpdir(), 'al-'));
        expect(findPostByAlias(path.join(t, 'missing'), 'x')).toBeNull();
    });
    it('API: old slug answers 301 to the new API path', async () => {
        const r = await request(app).get(`/api/posts/${OLDSLUG}?a=1`);
        expect(r.status).toBe(301);
        expect(r.headers.location).toBe(`/api/posts/${NEWSLUG}?a=1`);
    });
    it('page: /post/old answers 301 to /post/new, keeping the query', async () => {
        const r = await request(app).get(`/post/${OLDSLUG}?x=1`);
        expect(r.status).toBe(301);
        expect(r.headers.location).toBe(`/post/${NEWSLUG}?x=1`);
    });
    it('a real post wins over an alias, and unknown slugs still 404', async () => {
        expect((await request(app).get(`/api/posts/${NEWSLUG}?a=1`)).status).toBe(200);
        expect((await request(app).get('/api/posts/nope-t')).status).toBe(404);
    });
});
