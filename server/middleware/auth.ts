/**
 * RoleGuardFactory — Express middleware for JWT, PAT, and classical session auth.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthMode } from '../lib/config.ts';
import { findUserByUsername } from '../lib/config.ts';
import { isPatToken, verifyToken } from '../lib/api-tokens.ts';
import { httpScopeDenied, scopeDeniedMessage, storedTokenScopes, type TokenScopes } from '../lib/token-scope.ts';
import { writeAudit } from '../lib/audit-log.ts';
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

/** Live identity from users.json — rejects deleted/locked accounts; role from disk. */
export function liveIdentity(
    username: unknown,
    sessionStore?: FileSessionStore,
    sessionId?: string
): { username: string; role: Role; mcpOnly: boolean } | null {
    if (typeof username !== 'string' || !username) return null;
    const user = findUserByUsername(username);
    if (!user || !isAllowedRole(user.role)) {
        if (sessionStore && sessionId) sessionStore.destroy(sessionId);
        return null;
    }
    return {
        username: user.username,
        role: user.role,
        // An MCP-only agent account (Track #2119 U7): its token is its only identity.
        mcpOnly: user.mcpOnly === true
    };
}

export interface AuthenticatedRequest extends Request {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    file?: any;
    /** Set when auth came from a personal access token. */
    authVia?: 'pat' | 'jwt' | 'session';
    /** Present for personal access tokens. JWT and session logins are not scoped. */
    tokenScopes?: TokenScopes;
}

export interface AuthGuardOptions {
    getMode: () => AuthMode;
    getSessionStore: () => FileSessionStore;
    getSessionCookieName: () => string;
}

/** The body a caller gets when its personal access token cannot be trusted. */
export const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';

/**
 * A token the server cannot trust means "not authenticated", so the answer is 401
 * with a WWW-Authenticate header — not the 403 that a scope denial gets. The body
 * is the same for an unknown, revoked, expired or orphaned token, so it does not
 * tell the caller which one it was. The audit row keeps the reason.
 */
function denyPat(res: Response, reason: 'invalid' | 'user'): Response {
    writeAudit({ event: 'token', action: 'denied', reason });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ message: INVALID_TOKEN_MESSAGE });
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

    /**
     * Product: require valid PAT, JWT, or session; attaches req.user from live users.json.
     * Bearer PAT wins when present (works in both jwt and session site modes).
     */
    authenticate() {
        const secret = this.secret;
        const opts = this.opts;
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            const bearer = req.headers['authorization']?.split(' ')[1];
            if (bearer && isPatToken(bearer)) {
                return this.authenticatePat(req, res, next, bearer);
            }
            const mode = opts.getMode();
            if (mode === 'session') {
                return this.authenticateSession(req, res, next);
            }
            return this.authenticateJwt(req, res, next, secret);
        };
    }

    private authenticatePat(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
        plaintext: string
    ) {
        const tok = verifyToken(plaintext);
        if (!tok) {
            return denyPat(res, 'invalid');
        }
        const identity = liveIdentity(tok.username);
        if (!identity) {
            return denyPat(res, 'user');
        }
        req.user = { username: identity.username, role: identity.role };
        req.authVia = 'pat';
        // storedTokenScopes, not tok.scopes: a token that somehow skipped
        // toPublic then fails closed to read-only instead of to no scope.
        const scopes = storedTokenScopes(tok);
        req.tokenScopes = scopes;
        writeAudit({
            event: 'token',
            action: 'use',
            username: identity.username,
            tokenId: tok.id,
            scope: tok.scope
        });
        const missing = httpScopeDenied(scopes, req.method, req.originalUrl || req.path);
        if (missing) {
            return res.status(403).json({ message: scopeDeniedMessage(missing) });
        }
        next();
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
            const payload = decoded as { username?: string };
            const identity = liveIdentity(payload?.username);
            if (!identity) {
                return res.status(403).json({ message: 'Failed to authenticate token' });
            }
            // An MCP-only agent account has no browser identity: its token is all it gets.
            if (identity.mcpOnly) {
                return res.status(403).json({ message: 'Failed to authenticate token' });
            }
            req.user = { username: identity.username, role: identity.role };
            req.authVia = 'jwt';
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

        const identity = liveIdentity(rec.username, store, rec.id);
        if (!identity) {
            return res.status(403).json({ message: 'Failed to authenticate token' });
        }
        // An MCP-only agent account may not hold a browser session.
        if (identity.mcpOnly) {
            store.destroy(rec.id);
            return res.status(403).json({ message: 'Failed to authenticate token' });
        }
        req.user = { username: identity.username, role: identity.role };
        req.authVia = 'session';
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
