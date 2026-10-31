/**
 * First-run admin creation. There is no admin/admin account.
 * The operator presents a one-time setup token or opts into a local stdin bootstrap.
 */
import crypto from 'crypto';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { loadUsers, saveUsers, writeJsonAtomic, type UsersConfig } from './config.ts';
import { DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_PASSWORD_HASH } from './default-credentials.ts';

export async function isDefaultAdminCredential(hash: string | undefined | null): Promise<boolean> {
    if (!hash) return false;
    if (hash === DEFAULT_ADMIN_PASSWORD_HASH) return true;
    try {
        return await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, hash);
    } catch {
        return false;
    }
}

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function timingSafeHex(a: string, b: string): boolean {
    try {
        const ba = Buffer.from(a, 'hex');
        const bb = Buffer.from(b, 'hex');
        if (ba.length !== bb.length || ba.length === 0) return false;
        return crypto.timingSafeEqual(ba, bb);
    } catch {
        return false;
    }
}

export function issueSetupToken(filePath: string): string {
    const token = crypto.randomBytes(32).toString('base64url');
    writeJsonAtomic(filePath, { hash: hashToken(token), createdAt: Date.now() });
    fs.chmodSync(filePath, 0o600);
    return token;
}

export function consumeSetupToken(token: string, filePath: string | undefined): void {
    if (!token || !filePath || !fs.existsSync(filePath)) {
        throw new Error('Setup token is invalid or already used');
    }
    let parsed: { hash?: string };
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw new Error('Setup token is invalid or already used');
    }
    if (!parsed?.hash || !timingSafeHex(parsed.hash, hashToken(token))) {
        throw new Error('Setup token is invalid or already used');
    }
    fs.unlinkSync(filePath);
}

export interface BootstrapAdminOptions {
    username: string;
    password: string;
    usersFile: string;
    setupToken?: string;
    setupTokenFile?: string;
    allowStdin: boolean;
}

export async function bootstrapAdmin(opts: BootstrapAdminOptions): Promise<void> {
    if (!opts.password || opts.password === DEFAULT_ADMIN_PASSWORD) {
        throw new Error('Refusing default admin password');
    }
    if (opts.password.length < 8) throw new Error('Password must be at least 8 characters');

    let existing: UsersConfig | null = null;
    if (fs.existsSync(opts.usersFile)) {
        existing = loadUsers(opts.usersFile);
        if (existing.admin.passwordHash && !(await isDefaultAdminCredential(existing.admin.passwordHash))) {
            throw new Error('Admin already configured');
        }
    }

    if (opts.setupToken) {
        consumeSetupToken(opts.setupToken, opts.setupTokenFile);
    } else if (!opts.allowStdin) {
        throw new Error('Setup token or stdin required');
    }

    const passwordHash = await bcrypt.hash(opts.password, 10);
    saveUsers(
        {
            admin: {
                username: opts.username || 'admin',
                passwordHash,
                role: 'admin'
            },
            users: existing?.users || []
        },
        opts.usersFile
    );
}
