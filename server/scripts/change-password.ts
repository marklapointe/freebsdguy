import dotenv from 'dotenv';
dotenv.config();

import { loadUsers, saveUsers } from '../lib/config.ts';
import { updatePassword } from '../lib/auth.ts';

const changePassword = async (username: string, newPassword: string) => {
    const usersConfig = loadUsers();
    const { success, usersConfig: updatedUsersConfig } = await updatePassword(usersConfig, username, newPassword);

    if (!success) {
        console.error(`User '${username}' not found.`);
        process.exit(1);
    }

    saveUsers(updatedUsersConfig);
    console.log(`Password updated successfully for user '${username}'.`);
};

// Simple CLI handling
const args = process.argv.slice(2);
if (args.length !== 2) {
    console.log('Usage: npm run change-password <username> <new_password>');
    process.exit(1);
}

const [username, newPassword] = args;
changePassword(username, newPassword).catch(err => {
    console.error('Error updating password:', err);
    process.exit(1);
});
