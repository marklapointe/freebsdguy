/**
 * JSON-lines audit log. Tokens, passwords, Authorization headers, and cookies never land in the line.
 */
import fs from 'fs';

const DROP_EXACT = new Set([
    'password',
    'passwordhash',
    'newpassword',
    'oldpassword',
    'authorization',
    'proxyauthorization',
    'cookie',
    'cookies',
    'setcookie',
    'secret',
    'jwtsecret',
    'sessionsecret',
    'apikey',
    'token',
    'plaintext',
    'bearer',
    'jwt'
]);

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function shouldDropAuditKey(key: string): boolean {
    const k = normalizeKey(key);
    if (k === 'tokenid' || k === 'tokenscope') return false;
    if (DROP_EXACT.has(k)) return true;
    if (k.includes('password') || k.includes('authorization') || k.includes('cookie')) return true;
    return false;
}

export function redactSecretText(value: string): string {
    return value
        .replace(/mdw_[A-Za-z0-9_-]+/g, '[redacted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
}

export function redactAuditRecord(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (shouldDropAuditKey(key)) continue;
        if (typeof value === 'string') out[key] = redactSecretText(value);
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = redactAuditRecord(value as Record<string, unknown>);
        } else out[key] = value;
    }
    return out;
}

export function formatAuditLine(event: Record<string, unknown>, now = new Date()): string {
    const safe = redactAuditRecord(event);
    const line = JSON.stringify({ ts: now.toISOString(), ...safe });
    if (/password|authorization|cookie|mdw_/i.test(line)) {
        return JSON.stringify({
            ts: now.toISOString(),
            event: typeof safe.event === 'string' ? safe.event : 'audit',
            outcome: 'redacted'
        });
    }
    return line;
}

export function writeAudit(event: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): void {
    try {
        const line = formatAuditLine(event);
        const dest = env.AUDIT_LOG_PATH;
        if (dest) {
            fs.appendFileSync(dest, line + '\n', { mode: 0o600 });
            return;
        }
        if (env.VITEST) return;
        process.stdout.write(line + '\n');
    } catch {
        /* audit must not break the request */
    }
}
