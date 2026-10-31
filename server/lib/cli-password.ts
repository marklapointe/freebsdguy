/**
 * Passwords for CLI tools come from stdin or a mode-0600 file, never argv.
 */
import { readMode0600File } from './secret-file.ts';

export interface ChangePasswordArgs {
    username: string;
    passwordFile?: string;
}

export function parseChangePasswordArgs(argv: string[]): ChangePasswordArgs {
    const args = argv.slice(2);
    const positionals: string[] = [];
    let passwordFile: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--password-file') {
            const next = args[i + 1];
            if (!next || next.startsWith('-')) {
                throw new Error('Missing --password-file path');
            }
            passwordFile = next;
            i++;
            continue;
        }
        if (a.startsWith('--password-file=')) {
            const value = a.slice('--password-file='.length);
            if (!value) throw new Error('Missing --password-file path');
            passwordFile = value;
            continue;
        }
        if (a === '--help' || a === '-h') {
            throw new Error(
                'Usage: change-password <username> [--password-file path]\nPassword is read from stdin or --password-file, never the command line.'
            );
        }
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
        positionals.push(a);
    }
    if (positionals.length > 1) {
        throw new Error(
            'Refusing to read the password from the command line. Pass it on stdin or --password-file.'
        );
    }
    if (positionals.length !== 1 || !positionals[0]) {
        throw new Error(
            'Usage: change-password <username> [--password-file path]\nPassword is read from stdin or --password-file, never the command line.'
        );
    }
    return { username: positionals[0], passwordFile };
}

export function readPasswordInput(opts: { passwordFile?: string; stdinText?: string }): string {
    if (opts.passwordFile) return readMode0600File(opts.passwordFile);
    const text = (opts.stdinText ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (!text.trim()) {
        throw new Error('Password required on stdin or --password-file');
    }
    if (text.includes('\n')) throw new Error('Password must be a single line');
    return text;
}
