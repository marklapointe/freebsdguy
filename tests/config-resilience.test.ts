/**
 * Exhaustive bad-config / corrupt-users resilience tests.
 * loadConfig / loadUsers / sanitizeConfig must never throw and must keep the process viable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    loadConfig,
    saveConfig,
    loadUsers,
    sanitizeConfig,
    sanitizeUsers,
    defaultConfig,
    defaultUsers,
    quarantineBadFile,
    getConfigLoadStatus,
    isSystemConfigDir
} from '../server/lib/config.ts';

describe('config resilience (bad configs never kill the process)', () => {
    let tempDir: string;
    let configFile: string;
    let usersFile: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-cfg-'));
        configFile = path.join(tempDir, 'config.json');
        usersFile = path.join(tempDir, 'users.json');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const assertNeverThrows = <T>(fn: () => T): T => {
        let result!: T;
        expect(() => {
            result = fn();
        }).not.toThrow();
        return result;
    };

    describe('sanitizeConfig', () => {
        it('returns defaults for null / array / string / number roots', () => {
            for (const raw of [null, undefined, [], 'x', 42, true]) {
                const { config, warnings } = sanitizeConfig(raw);
                expect(config.postsDir).toBeTruthy();
                expect(config.currentTheme).toBe('dark');
                expect(warnings.length).toBeGreaterThan(0);
            }
        });

        it('fills missing optional fields from defaults', () => {
            const { config, warnings } = sanitizeConfig({ postsDir: './p', themeDir: './t' });
            expect(config.postsDir).toBe('./p');
            expect(config.themeDir).toBe('./t');
            expect(config.currentTheme).toBe('dark');
            expect(config.pagination).toBe(10);
            expect(config.appearance?.themeMode).toBe('dark');
            expect(warnings.length).toBe(0);
        });

        it('coerces wrong types without throwing', () => {
            const { config, warnings } = sanitizeConfig({
                postsDir: './posts',
                themeDir: './themes',
                currentTheme: '../evil',
                pagination: 'nope',
                sortBy: 'foo',
                sortOrder: 1,
                searchPlacement: {},
                appearance: 1,
                aiConfig: 'x',
                service: { port: 99999 },
                security: 'no'
            });
            expect(config.currentTheme).toBe('dark');
            expect(config.pagination).toBe(10);
            expect(config.sortBy).toBe('date');
            expect(config.appearance?.crtEffects).toBe(true);
            expect(config.aiConfig).toBeUndefined();
            expect(config.service?.port).toBe(5173);
            expect(warnings.length).toBeGreaterThan(0);
        });

        it('merges partial appearance and keeps AI key when object is valid', () => {
            const { config } = sanitizeConfig({
                postsDir: './posts',
                themeDir: './themes',
                appearance: { crtEffects: false },
                aiConfig: {
                    enabled: true,
                    provider: 'openai',
                    baseUrl: 'https://api.openai.com/v1',
                    apiKey: 'sk-secret',
                    modelId: 'gpt-4'
                }
            });
            expect(config.appearance?.crtEffects).toBe(false);
            expect(config.appearance?.themeMode).toBe('dark');
            expect(config.appearance?.textGlow).toBe(true);
            expect(config.aiConfig?.apiKey).toBe('sk-secret');
            expect(config.aiConfig?.provider).toBe('openai');
        });

        it('preserves absolute FreeBSD data paths', () => {
            const { config } = sanitizeConfig({
                postsDir: '/var/db/mdweb/posts',
                themeDir: '/var/db/mdweb/themes',
                currentTheme: 'miami-cyberpunk',
                siteName: 'Durable Site'
            });
            expect(config.postsDir).toBe('/var/db/mdweb/posts');
            expect(config.themeDir).toBe('/var/db/mdweb/themes');
            expect(config.currentTheme).toBe('miami-cyberpunk');
            expect(config.siteName).toBe('Durable Site');
        });

        it('keeps unknown top-level keys for forward compatibility', () => {
            const { config } = sanitizeConfig({
                postsDir: './posts',
                themeDir: './themes',
                futureFeature: { enabled: true }
            });
            expect((config as any).futureFeature).toEqual({ enabled: true });
        });

        it('clamps pagination into 1..100', () => {
            expect(sanitizeConfig({ postsDir: './p', themeDir: './t', pagination: 0 }).config.pagination).toBe(1);
            expect(sanitizeConfig({ postsDir: './p', themeDir: './t', pagination: 500 }).config.pagination).toBe(
                100
            );
            expect(sanitizeConfig({ postsDir: './p', themeDir: './t', pagination: '25' }).config.pagination).toBe(
                25
            );
        });
    });

    describe('loadConfig', () => {
        it('missing file → defaults, never throws', () => {
            const cfg = assertNeverThrows(() => loadConfig(configFile)) as ReturnType<typeof loadConfig>;
            expect(cfg.currentTheme).toBe('dark');
            expect(getConfigLoadStatus().usedDefaults).toBe(true);
        });

        it('empty file → quarantine + defaults', () => {
            fs.writeFileSync(configFile, '   \n');
            const cfg = assertNeverThrows(() => loadConfig(configFile)) as ReturnType<typeof loadConfig>;
            expect(cfg.postsDir).toBeTruthy();
            expect(fs.existsSync(configFile)).toBe(false);
            const bad = fs.readdirSync(tempDir).filter((f) => f.includes('.bad-'));
            expect(bad.length).toBe(1);
            expect(getConfigLoadStatus().quarantinedPath).toBeTruthy();
        });

        it('truncated JSON → quarantine + defaults', () => {
            fs.writeFileSync(configFile, '{ "siteName": "Half');
            const cfg = loadConfig(configFile);
            expect(cfg.siteName).toBe('MDWeb');
            expect(fs.readdirSync(tempDir).some((f) => f.includes('.bad-'))).toBe(true);
        });

        it('non-object JSON → defaults (no throw)', () => {
            for (const body of ['[]', '"string"', 'null', '123']) {
                fs.writeFileSync(configFile, body);
                // non-object parse succeeds but sanitize falls back
                const cfg = loadConfig(configFile);
                expect(cfg.currentTheme).toBe('dark');
            }
        });

        it('partial valid JSON is merged, not wiped', () => {
            fs.writeFileSync(
                configFile,
                JSON.stringify({
                    postsDir: '/var/db/mdweb/posts',
                    themeDir: '/var/db/mdweb/themes',
                    siteName: 'Kept Name',
                    currentTheme: 'matrix',
                    appearance: { themeMode: 'light', crtEffects: false }
                })
            );
            const cfg = loadConfig(configFile);
            expect(cfg.siteName).toBe('Kept Name');
            expect(cfg.currentTheme).toBe('matrix');
            expect(cfg.appearance?.themeMode).toBe('light');
            expect(cfg.appearance?.crtEffects).toBe(false);
            expect(cfg.pagination).toBe(10);
        });

        it('second load after corrupt is stable (no thrash)', () => {
            fs.writeFileSync(configFile, '{not json');
            const a = loadConfig(configFile);
            const b = loadConfig(configFile);
            expect(a.currentTheme).toBe(b.currentTheme);
            // quarantine already moved file; second load is missing-file defaults
            expect(getConfigLoadStatus().usedDefaults).toBe(true);
        });

        it('saveConfig writes sanitized document', () => {
            saveConfig(
                {
                    postsDir: './posts',
                    themeDir: './themes',
                    currentTheme: 'dark',
                    pagination: 999 as any,
                    appearance: { crtEffects: false }
                } as any,
                configFile
            );
            const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            expect(raw.pagination).toBe(100);
            expect(raw.appearance.crtEffects).toBe(false);
            expect(raw.appearance.themeMode).toBe('dark');
        });
    });

    describe('loadUsers / sanitizeUsers', () => {
        it('corrupt JSON → quarantine + default admin', () => {
            fs.writeFileSync(usersFile, '{bad');
            const u = assertNeverThrows(() => loadUsers(usersFile)) as ReturnType<typeof loadUsers>;
            expect(u.admin.username).toBe('admin');
            expect(u.admin.passwordHash).toBeTruthy();
            expect(fs.readdirSync(tempDir).some((f) => f.includes('.bad-'))).toBe(true);
        });

        it('missing admin block → default admin injected', () => {
            const { users, warnings } = sanitizeUsers({ users: [] });
            expect(users.admin.username).toBe('admin');
            expect(warnings.some((w) => w.includes('admin'))).toBe(true);
        });

        it('filters garbage user entries', () => {
            const { users } = sanitizeUsers({
                admin: { username: 'root', passwordHash: 'h', role: 'admin' },
                users: [null, 'x', { username: 'bob', passwordHash: 'hh', role: 'contributor' }, { foo: 1 }]
            });
            expect(users.admin.username).toBe('root');
            expect(users.users).toHaveLength(1);
            expect(users.users[0].username).toBe('bob');
        });

        it('missing users file creates default on disk', () => {
            const u = loadUsers(usersFile);
            expect(u.admin.username).toBe('admin');
            expect(fs.existsSync(usersFile)).toBe(true);
        });
    });

    describe('quarantineBadFile', () => {
        it('renames existing file and returns dest path', () => {
            fs.writeFileSync(configFile, 'x');
            const dest = quarantineBadFile(configFile);
            expect(dest).toBeTruthy();
            expect(fs.existsSync(configFile)).toBe(false);
            expect(fs.existsSync(dest!)).toBe(true);
        });

        it('missing file returns undefined without throw', () => {
            expect(quarantineBadFile(path.join(tempDir, 'nope.json'))).toBeUndefined();
        });
    });

    describe('defaultConfig platform awareness', () => {
        it('isSystemConfigDir detects FreeBSD layout', () => {
            expect(isSystemConfigDir('/usr/local/etc/mdweb')).toBe(true);
            expect(isSystemConfigDir('/tmp/mdweb-test')).toBe(false);
        });

        it('defaultConfig returns a complete object', () => {
            const d = defaultConfig();
            expect(d.postsDir).toBeTruthy();
            expect(d.themeDir).toBeTruthy();
            expect(d.currentTheme).toBe('dark');
            expect(defaultUsers().admin.role).toBe('admin');
        });
    });
});

describe('API survives bad config on disk (integration)', () => {
    it('GET /api/health and /api/config succeed when CONFIG uses a partial file', async () => {
        // App under test uses tests/tmp via vitest setup; write a partial config there if present
        const { app } = await import('../server/index.ts');
        const request = (await import('supertest')).default;

        const resHealth = await request(app).get('/api/health');
        expect(resHealth.status).toBe(200);
        expect(resHealth.body.ok).toBe(true);

        const resCfg = await request(app).get('/api/config');
        expect(resCfg.status).toBe(200);
        expect(resCfg.body.siteName).toBeTruthy();
        expect(resCfg.body).not.toHaveProperty('jwtSecret');
        expect(JSON.stringify(resCfg.body)).not.toMatch(/"apiKey"\s*:/);
    });
});
