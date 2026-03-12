import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadUsers, usersPath } from '../server/lib/config';

const testUsersPath = path.join(__dirname, 'auto-create-users.json');

describe('Users Auto-Creation', () => {
    beforeEach(() => {
        if (fs.existsSync(testUsersPath)) {
            fs.unlinkSync(testUsersPath);
        }
        vi.stubEnv('USERS_PATH', testUsersPath);
    });

    afterEach(() => {
        if (fs.existsSync(testUsersPath)) {
            fs.unlinkSync(testUsersPath);
        }
        vi.unstubAllEnvs();
    });

    it('should create users.json with default admin if it does not exist', () => {
        expect(fs.existsSync(testUsersPath)).toBe(false);
        
        const users = loadUsers(testUsersPath);
        
        expect(users.admin.username).toBe('admin');
        expect(fs.existsSync(testUsersPath)).toBe(true);
        
        const fileContent = JSON.parse(fs.readFileSync(testUsersPath, 'utf8'));
        expect(fileContent.admin.username).toBe('admin');
        expect(fileContent.admin.passwordHash).toBe('$2b$10$x7o/dvu7/KBaupXvvkmhQuvqMhonmzGO.Al4EAazaPFbDusbhhdXi');
    });
});
