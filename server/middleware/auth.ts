/**
 * RoleGuardFactory — Express middleware for JWT and classical session auth.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthMode } from '../lib/config.ts';
import {
    FileSessionStore,
    parseCookies,
    type SessionRecord
} from '../lib/session-store.ts';

export type Role = 'admin' | 'contributor';

export const ALLOWED_ROLES: readonly Role[] = ['admin', 'contributor'] as const;

export function isAllowedRole(role: unknown): role is Role {
    return role === 'admin' || role === 'contributor';
}

export interface AuthenticatedRequest extends Request {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    file?: any;
}

export interface AuthGuardOptions {
    getMode: () => AuthMode;
    getSessionStore: () => FileSessionStore;
    getSessionCookieName: () => string;
}

export class RoleGuardFactory {
    private secret: string;
    private opts: AuthGuardOptions;

    constructor(secret: string, opts?: Partial<AuthGuardOptions>) {
        this.secret = secret;
        this.opts = {
            getMode: opts?.getMode || (() => 'jwt'),
            getSessionStore: opts?.getSessionStore || (() => new FileSessionStore()),
            getSessionCookieName: opts?.getSessionCookieName || (() => 'mdweb.sid')
        };
    }

    /** Product: require valid JWT or session; attaches req.user */
    authenticate() {
        const secret = this.secret;
        const opts = this.opts;
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            const mode = opts.getMode();
            if (mode === 'session') {
                return this.authenticateSession(req, res, next);
            }
            return this.authenticateJwt(req, res, next, secret);
        };
    }

    private authenticateJwt(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
        secret: string
    ) {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'No token' });

        jwt.verify(token, secret, (err, decoded) => {
            if (err) {
                console.error(`[AUTH] JWT verification failed: ${err.message}`);
                return res.status(403).json({ message: 'Failed to authenticate token' });
            }
            req.user = decoded;
            next();
        });
    }

    private authenticateSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        const name = this.opts.getSessionCookieName();
        const cookies = parseCookies(req.headers.cookie);
        const sid = cookies[name];
        if (!sid) return res.status(401).json({ message: 'No token' });

        const store = this.opts.getSessionStore();
        const rec: SessionRecord | null = store.get(sid);
        if (!rec) return res.status(403).json({ message: 'Failed to authenticate token' });

        req.user = { username: rec.username, role: rec.role };
        next();
    }

    requireRole(...roles: Role[]) {
        const allowed = new Set(roles);
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            const role = req.user?.role;
            if (!role || !allowed.has(role)) {
                return res.status(403).json({ message: 'Forbidden' });
            }
            next();
        };
    }

    requireAdmin() {
        return this.requireRole('admin');
    }

    requireContributorOrAdmin() {
        return this.requireRole('admin', 'contributor');
    }
}
