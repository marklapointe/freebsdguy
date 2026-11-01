// Track #1682 follow-up: demo-post seeding switch, real package version, no phantom logo.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import * as demo from '../server/lib/demo-posts.ts';
import * as cfgmod from '../server/lib/config.ts';
import { PublicConfigBuilder } from '../server/lib/public-config.ts';

const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version;

describe('demo posts can be turned off', () => {
    const dirs: string[] = [];
    const saved = process.env.MDWEB_DEMO_POSTS;
    afterEach(() => {
        for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
        if (saved === undefined) delete process.env.MDWEB_DEMO_POSTS; else process.env.MDWEB_DEMO_POSTS = saved;
    });
    const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-1682-')); dirs.push(d); return d; };

    it('ensureDemoPosts(dir, { enabled: false }) copies nothing', () => {
        const d = tmp();
        fs.writeFileSync(path.join(d, 'my-real-post.md'), '# mine\n');
        fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
        const r = (demo.ensureDemoPosts as any)(d, { enabled: false });
        expect(r).toEqual({ copied: [], total: 1 });
        // existing posts are never deleted when seeding is off
        expect(fs.readdirSync(d).filter((f) => f.endsWith('.md'))).toEqual(['my-real-post.md']);
        expect(fs.readFileSync(path.join(d, 'my-real-post.md'), 'utf8')).toBe('# mine\n');
    });

    it('disabled with a missing postsDir reports 0 and creates nothing', () => {
        const d = path.join(tmp(), 'absent');
        expect(demo.ensureDemoPosts(d, { enabled: false })).toEqual({ copied: [], total: 0 });
        expect(fs.existsSync(d)).toBe(false);
    });

    it('packageVersion is cached and matches package.json', async () => {
        const { packageVersion } = await import('../server/lib/package-version.ts');
        expect(packageVersion()).toBe(pkgVersion);
        expect(packageVersion()).toBe(pkgVersion);
    });

    it('demoPostsEnabled: config demoPosts:false disables, default stays on', () => {
        const fn = (demo as any).demoPostsEnabled;
        expect(typeof fn).toBe('function');
        delete process.env.MDWEB_DEMO_POSTS;
        expect(fn({ demoPosts: false })).toBe(false);
        expect(fn({})).toBe(true);
    });

    it('demoPostsEnabled: MDWEB_DEMO_POSTS=0 overrides config', () => {
        const fn = (demo as any).demoPostsEnabled;
        process.env.MDWEB_DEMO_POSTS = '0';
        expect(fn({ demoPosts: true })).toBe(false);
        process.env.MDWEB_DEMO_POSTS = '1';
        expect(fn({ demoPosts: false })).toBe(true);
    });

    it('sanitizeConfig keeps a boolean demoPosts', () => {
        const { config } = cfgmod.sanitizeConfig({ postsDir: '/p', themeDir: '/t', currentTheme: 'dark', demoPosts: false });
        expect((config as any).demoPosts).toBe(false);
        const bad = cfgmod.sanitizeConfig({ postsDir: '/p', themeDir: '/t', currentTheme: 'dark', demoPosts: 'nope' });
        expect((bad.config as any).demoPosts).toBeUndefined();
    });
});

describe('/api/health reports the package version', () => {
    it('without npm_package_version (rc.d start)', async () => {
        const saved = process.env.npm_package_version;
        delete process.env.npm_package_version;
        try {
            const { app } = await import('../server/index');
            const res = await request(app).get('/api/health');
            expect(res.body.version).toBe(pkgVersion);
            expect(res.body.version).not.toBe('1.0.0');
        } finally {
            if (saved !== undefined) process.env.npm_package_version = saved;
        }
    });
});

describe('no phantom logo.webp', () => {
    it('public config has an empty siteLogo when none is set', () => {
        const pub = PublicConfigBuilder.from({ postsDir: '/p', themeDir: '/t', currentTheme: 'dark' } as any).build();
        expect(pub.siteLogo || '').toBe('');
    });
    it('the system default config sets no logo', () => {
        const saved = process.env.CONFIG_DIR;
        process.env.CONFIG_DIR = '/usr/local/etc/mdweb';
        try {
            expect(cfgmod.isSystemConfigDir()).toBe(true);
            expect(cfgmod.defaultConfig().siteLogo || '').toBe('');
        } finally {
            if (saved === undefined) delete process.env.CONFIG_DIR; else process.env.CONFIG_DIR = saved;
        }
    });
});
