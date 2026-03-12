import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadConfig, saveConfig, Config, configPath, loadUsers, saveUsers, UsersConfig, usersPath } from '../server/lib/config';

const testConfigPath = path.join(__dirname, 'test-config.json');
const testUsersPath = path.join(__dirname, 'test-users.json');

const sampleConfig: Config = {
    postsDir: './posts',
    themeDir: './themes',
    currentTheme: 'default',
    siteName: 'Test Blog'
};

const sampleUsers: UsersConfig = {
    admin: {
        username: 'admin',
        passwordHash: 'hash',
        role: 'admin'
    },
    users: []
};

describe('Config Library', () => {
    beforeEach(() => {
        fs.writeFileSync(testConfigPath, JSON.stringify(sampleConfig, null, 2));
        fs.writeFileSync(testUsersPath, JSON.stringify(sampleUsers, null, 2));
        vi.stubEnv('CONFIG_PATH', testConfigPath);
        vi.stubEnv('USERS_PATH', testUsersPath);
    });

    afterEach(() => {
        if (fs.existsSync(testConfigPath)) {
            fs.unlinkSync(testConfigPath);
        }
        if (fs.existsSync(testUsersPath)) {
            fs.unlinkSync(testUsersPath);
        }
        vi.unstubAllEnvs();
    });

    it('should load config from a file', () => {
        const config = loadConfig(testConfigPath);
        expect(config.siteName).toBe('Test Blog');
    });

    it('should load users from a file', () => {
        const users = loadUsers(testUsersPath);
        expect(users.admin.username).toBe('admin');
    });

    it('should save config to a file', () => {
        const updatedConfig = { ...sampleConfig, siteName: 'Updated Blog' };
        saveConfig(updatedConfig, testConfigPath);
        
        const loaded = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
        expect(loaded.siteName).toBe('Updated Blog');
    });

    it('should save users to a file', () => {
        const updatedUsers = { ...sampleUsers };
        updatedUsers.users.push({ username: 'new', passwordHash: 'h', role: 'contributor' });
        saveUsers(updatedUsers, testUsersPath);
        
        const loaded = JSON.parse(fs.readFileSync(testUsersPath, 'utf8'));
        expect(loaded.users.length).toBe(1);
    });
});
