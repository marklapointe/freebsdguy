import fs from 'fs';
import { loadUsers, saveUsers } from '../lib/config.ts';
import { updatePassword } from '../lib/auth.ts';
import { FileSessionStore, defaultSessionDir } from '../lib/session-store.ts';
import { parseChangePasswordArgs, readPasswordInput } from '../lib/cli-password.ts';

const changePassword = async (username: string, newPassword: string) => {
    const usersConfig = loadUsers();
    const { success, usersConfig: updatedUsersConfig } = await updatePassword(usersConfig, username, newPassword);

    if (!success) {
        console.error(`User '${username}' not found.`);
        process.exit(1);
    }

    saveUsers(updatedUsersConfig);
    const purged = new FileSessionStore(defaultSessionDir()).destroyForUser(username);
    console.log(`Password updated successfully for user '${username}'.`);
    if (purged > 0) {
        console.log(`Purged ${purged} active session(s) for '${username}'.`);
    }
};

const main = async () => {
    const parsed = parseChangePasswordArgs(process.argv);
    let stdinText = '';
    if (!parsed.passwordFile) {
        if (process.stdin.isTTY) {
            console.error(
                'Refusing to read the password from the command line. Pass it on stdin or --password-file.'
            );
            process.exit(1);
        }
        stdinText = fs.readFileSync(0, 'utf8');
    }
    const password = readPasswordInput({ passwordFile: parsed.passwordFile, stdinText });
    await changePassword(parsed.username, password);
};

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
