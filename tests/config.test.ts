import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, saveConfig, loadUsers, saveUsers, loadAIConfig, configPath, usersPath } from '../server/lib/config';

describe('config.ts', () => {
    const tempDir = path.join(os.tmpdir(), 'freebsdguy-test-config');
    const customConfigPath = path.join(tempDir, 'config.json');
    const customUsersPath = path.join(tempDir, 'users.json');

    beforeEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('loadConfig returns default config if file does not exist', () => {
        const config = loadConfig(customConfigPath);
        expect(config.currentTheme).toBe('dark');
        expect(config.siteName).toBe('FreeBSD Guy');
    });

    it('loadConfig handles corrupted JSON', () => {
        fs.writeFileSync(customConfigPath, '{ corrupted: json }');
        const config = loadConfig(customConfigPath);
        expect(config.currentTheme).toBe('dark'); // Should fallback
    });

    it('loadUsers handles corrupted JSON', () => {
        fs.writeFileSync(customUsersPath, '{ corrupted: json }');
        const users = loadUsers(customUsersPath);
        expect(users.admin.username).toBe('admin'); // Should fallback
    });

    it('saveConfig and loadConfig works', () => {
        const config = {
            postsDir: './test-posts',
            themeDir: './test-themes',
            currentTheme: 'light',
            siteName: 'Test Site'
        };
        saveConfig(config, customConfigPath);
        const loaded = loadConfig(customConfigPath);
        expect(loaded).toEqual(config);
    });

    it('loadAIConfig returns null if no aiConfig', () => {
        const config = {
            postsDir: './posts',
            themeDir: './themes',
            currentTheme: 'dark'
        };
        saveConfig(config, customConfigPath);
        const aiConfig = loadAIConfig(customConfigPath);
        expect(aiConfig).toBeNull();
    });

    it('loadAIConfig returns aiConfig if present', () => {
        const aiConfig = {
            enabled: true,
            provider: 'ollama' as const,
            baseUrl: 'http://localhost:11434',
            apiKey: '',
            modelId: 'llama3'
        };
        const config = {
            postsDir: './posts',
            themeDir: './themes',
            currentTheme: 'dark',
            aiConfig
        };
        saveConfig(config, customConfigPath);
        const loadedAI = loadAIConfig(customConfigPath);
        expect(loadedAI).toEqual(aiConfig);
    });

    it('loadUsers returns default admin if file does not exist', () => {
        const users = loadUsers(customUsersPath);
        expect(users.admin.username).toBe('admin');
        expect(fs.existsSync(customUsersPath)).toBe(true);
    });

    it('saveUsers and loadUsers works', () => {
        const users = {
            admin: {
                username: 'superadmin',
                passwordHash: 'hash',
                role: 'admin'
            },
            users: []
        };
        saveUsers(users, customUsersPath);
        const loaded = loadUsers(customUsersPath);
        expect(loaded).toEqual(users);
    });
    
    it('configPath and usersPath return strings', () => {
        expect(typeof configPath()).toBe('string');
        expect(typeof usersPath()).toBe('string');
    });
});
