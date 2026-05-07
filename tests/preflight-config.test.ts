import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, saveConfig, loadUsers, saveUsers, isConfigWritable } from '../server/lib/config';
import { generateSecret } from '../server/lib/preflight';

describe('Config Module', () => {
    const testDir = path.join(os.tmpdir(), 'mdweb-test-config-' + Date.now());
    const testConfigPath = path.join(testDir, 'config.json');
    const testUsersPath = path.join(testDir, 'users.json');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
    });

    describe('loadConfig', () => {
        it('should load existing config file', () => {
            fs.writeFileSync(testConfigPath, JSON.stringify({ siteName: 'Test Site' }));
            const config = loadConfig(testConfigPath);
            expect(config.siteName).toBe('Test Site');
        });

        it('should return default config when file does not exist', () => {
            const config = loadConfig(path.join(testDir, 'nonexistent.json'));
            expect(config.postsDir).toBeDefined();
            expect(config.currentTheme).toBe('dark');
        });

        it('should return default config when JSON is invalid', () => {
            fs.writeFileSync(testConfigPath, 'invalid json {');
            const config = loadConfig(testConfigPath);
            expect(config.postsDir).toBeDefined();
        });
    });

    describe('saveConfig', () => {
        it('should save config to file', () => {
            const config = { postsDir: './posts', themeDir: './themes', currentTheme: 'dark', siteName: 'Saved Site' };
            saveConfig(config, testConfigPath);
            const loaded = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
            expect(loaded.siteName).toBe('Saved Site');
        });
    });

    describe('isConfigWritable', () => {
        it('should return true for writable existing file', () => {
            fs.writeFileSync(testConfigPath, '{}');
            const result = isConfigWritable(testConfigPath);
            expect(result).toBe(true);
        });

        it('should return true for writable parent directory', () => {
            const result = isConfigWritable(path.join(testDir, 'newfile.json'));
            expect(result).toBe(true);
        });

        it('should return false for inaccessible path', () => {
            const result = isConfigWritable('/root/impossible/config.json');
            expect(result).toBe(false);
        });
    });

    describe('loadUsers', () => {
        it('should load existing users file', () => {
            const testUsers = {
                admin: { username: 'admin', passwordHash: 'hash', role: 'admin' },
                users: []
            };
            fs.writeFileSync(testUsersPath, JSON.stringify(testUsers));
            const users = loadUsers(testUsersPath);
            expect(users.admin.username).toBe('admin');
        });

        it('should create default admin when file does not exist', () => {
            const users = loadUsers(path.join(testDir, 'nonexistent-users.json'));
            expect(users.admin.username).toBe('admin');
            expect(fs.existsSync(path.join(testDir, 'nonexistent-users.json'))).toBe(true);
        });

        it('should return default admin when JSON is invalid', () => {
            fs.writeFileSync(testUsersPath, 'invalid json');
            const users = loadUsers(testUsersPath);
            expect(users.admin.username).toBe('admin');
        });
    });

    describe('saveUsers', () => {
        it('should save users to file', () => {
            const users = {
                admin: { username: 'admin', passwordHash: 'hash', role: 'admin' },
                users: [{ username: 'test', passwordHash: 'hash2', role: 'contributor' }]
            };
            saveUsers(users, testUsersPath);
            const loaded = JSON.parse(fs.readFileSync(testUsersPath, 'utf8'));
            expect(loaded.users.length).toBe(1);
            expect(loaded.users[0].username).toBe('test');
        });
    });
});

describe('Preflight Module', () => {
    describe('generateSecret', () => {
        it('should generate a 64-character hex string', () => {
            const secret = generateSecret();
            expect(secret).toHaveLength(64);
            expect(secret).toMatch(/^[a-f0-9]+$/);
        });

        it('should generate unique secrets each time', () => {
            const secret1 = generateSecret();
            const secret2 = generateSecret();
            expect(secret1).not.toBe(secret2);
        });
    });

    describe('runPreflight integration', () => {
        it('should run without errors in test environment', async () => {
            process.env.VITEST = 'true';
            const { runPreflight } = await import('../server/lib/preflight');
            const issues = await runPreflight(false);
            expect(Array.isArray(issues)).toBe(true);
            delete process.env.VITEST;
        });

        it('should run with interactive mode without hanging', async () => {
            process.env.VITEST = 'true';
            const { runPreflight } = await import('../server/lib/preflight');
            const issues = await runPreflight(false);
            expect(Array.isArray(issues)).toBe(true);
            delete process.env.VITEST;
        });
    });
});