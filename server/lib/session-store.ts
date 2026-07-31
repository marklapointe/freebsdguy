/**
 * File-backed session store for classical cookie auth (authMode: session).
 * One JSON file per session id under a durable directory.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isSystemConfigDir } from './config.ts';

export interface SessionRecord {
    id: string;
    username: string;
    role: string;
    createdAt: number;
    expiresAt: number;
}

export function defaultSessionDir(): string {
    /* v8 ignore next */
    if (isSystemConfigDir()) return '/var/db/mdweb/sessions';
    if (process.env.CONFIG_DIR) return path.join(process.env.CONFIG_DIR, 'sessions');
    return path.join(process.cwd(), 'tests', 'tmp', 'sessions');
}

export class FileSessionStore {
    constructor(private dir: string = defaultSessionDir()) {}

    ensureDir(): void {
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        }
    }

    private fileFor(id: string): string | null {
        if (!/^[a-f0-9]{32,128}$/i.test(id)) return null;
        return path.join(this.dir, `${id}.json`);
    }

    create(username: string, role: string, ttlSeconds: number): SessionRecord {
        this.ensureDir();
        const id = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        const rec: SessionRecord = {
            id,
            username,
            role,
            createdAt: now,
            expiresAt: now + Math.max(300, ttlSeconds) * 1000
        };
        const fp = this.fileFor(id)!;
        fs.writeFileSync(fp, JSON.stringify(rec), { mode: 0o600 });
        return rec;
    }

    get(id: string): SessionRecord | null {
        const fp = this.fileFor(id);
        if (!fp || !fs.existsSync(fp)) return null;
        try {
            const rec = JSON.parse(fs.readFileSync(fp, 'utf8')) as SessionRecord;
            if (!rec?.id || rec.expiresAt < Date.now()) {
                this.destroy(id);
                return null;
            }
            return rec;
        } catch {
            return null;
        }
    }

    destroy(id: string): void {
        const fp = this.fileFor(id);
        if (fp && fs.existsSync(fp)) {
            try {
                fs.unlinkSync(fp);
            } catch {
                /* ignore */
            }
        }
    }

    /** Best-effort purge of expired sessions (call on login). */
    purgeExpired(): number {
        this.ensureDir();
        let n = 0;
        try {
            for (const f of fs.readdirSync(this.dir)) {
                if (!f.endsWith('.json')) continue;
                const fp = path.join(this.dir, f);
                try {
                    const rec = JSON.parse(fs.readFileSync(fp, 'utf8')) as SessionRecord;
                    if (!rec.expiresAt || rec.expiresAt < Date.now()) {
                        fs.unlinkSync(fp);
                        n++;
                    }
                } catch {
                    /* skip */
                }
            }
        } catch {
            /* ignore */
        }
        return n;
    }
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

export function sessionCookieHeader(
    name: string,
    value: string,
    maxAgeSec: number,
    secure: boolean
): string {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

export function clearSessionCookieHeader(name: string, secure: boolean): string {
    return sessionCookieHeader(name, '', 0, secure);
}
