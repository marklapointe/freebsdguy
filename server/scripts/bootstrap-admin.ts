/**
 * Create the first admin from a one-time setup token or stdin.
 * Password is never taken from argv.
 *
 *   npm run bootstrap-admin -- --issue-token
 *   npm run bootstrap-admin -- --username admin --setup-token TOKEN
 *   npm run bootstrap-admin -- --username admin --stdin
 */
import fs from 'fs';
import path from 'path';
import { usersPath } from '../lib/config.ts';
import { readPasswordInput } from '../lib/cli-password.ts';
import { bootstrapAdmin, issueSetupToken } from '../lib/setup-admin.ts';

function argValue(argv: string[], name: string): string | undefined {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i !== -1) return argv[i + 1];
    return undefined;
}

const main = async () => {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(
            'Usage:\n  bootstrap-admin --issue-token\n  bootstrap-admin --username USER (--setup-token TOKEN | --stdin) [--password-file path]'
        );
        return;
    }
    const tokenPath =
        argValue(argv, 'token-file') ||
        process.env.SETUP_TOKEN_PATH ||
        path.join(path.dirname(usersPath()), 'setup-token.json');
    if (argv.includes('--issue-token')) {
        const token = issueSetupToken(tokenPath);
        process.stdout.write(`${token}\n`);
        console.error(`Setup token written (hash only) to ${tokenPath}. It works once.`);
        return;
    }
    const username = argValue(argv, 'username') || 'admin';
    const passwordFile = argValue(argv, 'password-file');
    const setupToken = argValue(argv, 'setup-token');
    const allowStdin = argv.includes('--stdin') || !setupToken;
    if (argv.some((a) => !a.startsWith('--') && a !== username && a !== passwordFile && a !== setupToken && a !== tokenPath)) {
        console.error('Refusing unexpected command line arguments. Password must come from stdin or --password-file.');
        process.exit(1);
    }
    let stdinText = '';
    if (!passwordFile) {
        if (process.stdin.isTTY) {
            console.error('Password must be passed on stdin or --password-file, never the command line.');
            process.exit(1);
        }
        stdinText = fs.readFileSync(0, 'utf8');
    }
    const password = readPasswordInput({ passwordFile, stdinText });
    await bootstrapAdmin({
        username,
        password,
        usersFile: usersPath(),
        setupToken,
        setupTokenFile: tokenPath,
        allowStdin: allowStdin && !setupToken
    });
    console.log(`Admin '${username}' configured.`);
};

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
