import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { updatePassword } from '../server/lib/auth';
import { UsersConfig } from '../server/lib/config';

const sampleUsers: UsersConfig = {
    admin: {
        username: 'admin',
        passwordHash: '$2a$10$XmBwE8vW2A.HwL5oR2yv6.fP6A8h6R3u5Gz.k9W8O8R8v2k7m/S1u',
        role: 'admin'
    },
    users: [
        {
            username: 'contributor',
            passwordHash: 'old_hash',
            role: 'contributor'
        }
    ]
};

describe('Auth Library', () => {
    it('should update admin password', async () => {
        const { success, usersConfig } = await updatePassword(sampleUsers, 'admin', 'new_password');
        expect(success).toBe(true);
        expect(usersConfig.admin.passwordHash).not.toBe(sampleUsers.admin.passwordHash);
        
        const match = await bcrypt.compare('new_password', usersConfig.admin.passwordHash);
        expect(match).toBe(true);
    });

    it('should update regular user password', async () => {
        const { success, usersConfig } = await updatePassword(sampleUsers, 'contributor', 'new_password');
        expect(success).toBe(true);
        expect(usersConfig.users[0].passwordHash).not.toBe(sampleUsers.users[0].passwordHash);
        
        const match = await bcrypt.compare('new_password', usersConfig.users[0].passwordHash);
        expect(match).toBe(true);
    });

    it('should return success: false if user not found', async () => {
        const { success } = await updatePassword(sampleUsers, 'nonexistent', 'password');
        expect(success).toBe(false);
    });
});
