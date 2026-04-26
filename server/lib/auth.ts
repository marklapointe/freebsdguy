import bcrypt from 'bcryptjs';
import { UsersConfig, User } from './config.ts';

export const updatePassword = async (usersConfig: UsersConfig, username: string, newPassword: string): Promise<{ success: boolean; usersConfig: UsersConfig }> => {
    let userFound = false;
    const newUsersConfig = JSON.parse(JSON.stringify(usersConfig)) as UsersConfig;

    if (newUsersConfig.admin && newUsersConfig.admin.username === username) {
        newUsersConfig.admin.passwordHash = await bcrypt.hash(newPassword, 10);
        userFound = true;
    } else if (newUsersConfig.users) {
        const userIndex = newUsersConfig.users.findIndex((u: User) => u.username === username);
        if (userIndex !== -1) {
            newUsersConfig.users[userIndex].passwordHash = await bcrypt.hash(newPassword, 10);
            userFound = true;
        }
    }

    return { success: userFound, usersConfig: newUsersConfig };
};