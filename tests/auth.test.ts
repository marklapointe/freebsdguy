import { describe, it, expect, vi } from 'vitest';
import { updatePassword } from '../server/lib/auth';
import { UsersConfig } from '../server/lib/config';
import bcrypt from 'bcryptjs';

describe('Auth Library', () => {
    const mockUsersConfig: UsersConfig = {
        admin: {
            username: 'admin',
            passwordHash: 'old-hash',
            role: 'admin'
        },
        users: [
            {
                username: 'user1',
                passwordHash: 'old-hash-user1',
                role: 'contributor'
            }
        ]
    };

    it('should update admin password', async () => {
        const { success, usersConfig } = await updatePassword(mockUsersConfig, 'admin', 'new-password');
        expect(success).toBe(true);
        expect(usersConfig.admin.passwordHash).not.toBe('old-hash');
        expect(bcrypt.compareSync('new-password', usersConfig.admin.passwordHash)).toBe(true);
    });

    it('should update regular user password', async () => {
        const { success, usersConfig } = await updatePassword(mockUsersConfig, 'user1', 'new-password-user1');
        expect(success).toBe(true);
        expect(usersConfig.users[0].passwordHash).not.toBe('old-hash-user1');
        expect(bcrypt.compareSync('new-password-user1', usersConfig.users[0].passwordHash)).toBe(true);
    });

    it('should return success false for nonexistent user', async () => {
        const { success, usersConfig } = await updatePassword(mockUsersConfig, 'nonexistent', 'password');
        expect(success).toBe(false);
        expect(usersConfig).toEqual(mockUsersConfig);
    });
});
