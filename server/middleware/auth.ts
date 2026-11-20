/**
 * RoleGuardFactory — Express middleware for JWT, PAT, and classical session auth.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthMode } from '../lib/config.ts';
import { findUserByUsername } from '../lib/config.ts';
import { isPatToken, verifyToken } from '../lib/api-tokens.ts';
import {
    httpScopeDenied,
    roleAllowsMcpTool,
    scopeDeniedMessage,
    storedTokenScopes,
    tokenAllowsTool,
    type TokenScopes
} from '../lib/token-scope.ts';
import { writeAudit } from '../lib/audit-log.ts';
import {
    appRateLimiter,
    resolveTokenRateLimitSettings,
    tokenRateUnits,
    type TokenRateClass,
    type TokenRateSettings
} from '../lib/rate-limit.ts';
import { resolveAuditSite, type AuditFields } from '../lib/audit-context.ts';
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
    /** The id of the personal access token that authenticated the request. */
    tokenId?: string;
    /** Present for personal access tokens. JWT and session logins are not scoped. */
    tokenScopes?: TokenScopes;
}

export interface AuthGuardOptions {
    getMode: () => AuthMode;
    getSessionStore: () => FileSessionStore;
    getSessionCookieName: () => string;
    /** The per-token limits. Absent: the defaults from the env. */
    getTokenRateSettings?: () => TokenRateSettings;
    /** The site this server serves, for the audit rows. */
    getAuditSite?: () => string | undefined;
}

/** The body a caller gets when its personal access token cannot be trusted. */
export const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';

/**
 * A token the server cannot trust means "not authenticated", so the answer is 401
 * with a WWW-Authenticate header — not the 403 that a scope denial gets. The body
 * is the same for an unknown, revoked, expired or orphaned token, so it does not
 * tell the caller which one it was. The audit row keeps the reason.
 */
function denyPat(res: Response, reason: 'invalid' | 'user', fields?: AuditFields): Response {
    writeAudit({ event: 'token', action: 'denied', outcome: 'denied', reason, ...fields });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ message: INVALID_TOKEN_MESSAGE });
}

/**
 * A failed authentication on a route that must answer 401 (the /mcp route).
 * The audit row carries the reason and where the call came from, never the
 * credential that was presented.
 */
function denyMcp(
    res: Response,
    req: AuthenticatedRequest,
    reason: 'missing' | 'invalid',
    message: string,
    site?: string
): Response {
    writeAudit({
        event: 'token',
        action: 'denied',
        outcome: 'denied',
        reason,
        ...auditFields(req, site)
    });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ message });
}

/** Where the call came from, for an audit row. */
function auditFields(req: AuthenticatedRequest, site?: string): AuditFields {
    return { ip: req.ip, ...(site ? { site } : {}) };
}

export interface AuthenticateOptions {
    /** Answer 401 and write an audit row for every failed auth (the /mcp route). */
    mcp?: boolean;
}

export class RoleGuardFactory {
    private secret: string;
    private opts: AuthGuardOptions;

    constructor(secret: string, opts?: Partial<AuthGuardOptions>) {
        this.secret = secret;
        this.opts = {
            getMode: opts?.getMode || (() => 'jwt'),
            getSessionStore: opts?.getSessionStore || (() => new FileSessionStore()),
            getSessionCookieName: opts?.getSessionCookieName || (() => 'mdweb.sid'),
            getTokenRateSettings:
                opts?.getTokenRateSettings || (() => resolveTokenRateLimitSettings(undefined, process.env)),
            getAuditSite: opts?.getAuditSite || (() => resolveAuditSite(undefined))
        };
    }

    /**
     * Product: require valid PAT, JWT, or session; attaches req.user from live users.json.
     * Bearer PAT wins when present (works in both jwt and session site modes).
     */
    authenticate(options?: AuthenticateOptions) {
        const secret = this.secret;
        const opts = this.opts;
        const mcp = options?.mcp === true;
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            const bearer = req.headers['authorization']?.split(' ')[1];
            if (bearer && isPatToken(bearer)) {
                return this.authenticatePat(req, res, next, bearer);
            }
            const mode = opts.getMode();
            if (mode === 'session') {
                return this.authenticateSession(req, res, next, mcp);
            }
            return this.authenticateJwt(req, res, next, secret, mcp);
        };
    }

    private authenticatePat(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
        plaintext: string
    ) {
        const site = this.opts.getAuditSite ? this.opts.getAuditSite() : undefined;
        const tok = verifyToken(plaintext);
        if (!tok) {
            return denyPat(res, 'invalid', { ip: req.ip, ...(site ? { site } : {}) });
        }
        const identity = liveIdentity(tok.username);
        const tokenFields: AuditFields = {
            tokenId: tok.id,
            via: 'pat',
            ip: req.ip,
            ...(site ? { site } : {})
        };
        if (!identity) {
            return denyPat(res, 'user', tokenFields);
        }
        req.user = { username: identity.username, role: identity.role };
        req.authVia = 'pat';
        req.tokenId = tok.id;
        // storedTokenScopes, not tok.scopes: a token that somehow skipped
        // toPublic then fails closed to read-only instead of to no scope.
        const scopes = storedTokenScopes(tok);
        req.tokenScopes = scopes;
        writeAudit({
            event: 'token',
            action: 'use',
            username: identity.username,
            tokenId: tok.id,
            scope: tok.scope,
            outcome: 'accepted',
            ...tokenFields
        });
        const missing = httpScopeDenied(scopes, req.method, req.originalUrl || req.path);
        if (missing) {
            // A request refused for its scope never spends a bucket.
            writeAudit({
                event: 'token',
                action: 'denied',
                outcome: 'denied',
                reason: `scope:${missing}`,
                username: identity.username,
                ...tokenFields
            });
            return res.status(403).json({ message: scopeDeniedMessage(missing) });
        }
        const refused = this.spendTokenBudget(req, res, tok.id, tokenFields);
        if (refused) return refused;
        next();
    }

    /**
     * Spend the token's budget (Track #2119 U8). Behind the gateway every agent
     * shares one address, so the per-IP limits cannot tell one token from
     * another: each token gets its own read, write and publish buckets.
     *
     * A request that is refused for its auth or its scope never reaches this
     * method, so it never spends a bucket either.
     */
    private spendTokenBudget(
        req: AuthenticatedRequest,
        res: Response,
        tokenId: string,
        fields: AuditFields
    ): Response | void {
        const settings = this.opts.getTokenRateSettings
            ? this.opts.getTokenRateSettings()
            : resolveTokenRateLimitSettings(undefined, process.env);
        // A call this token may not make does not spend its budget.
        const units = tokenRateUnits(req).filter(
            (unit) => !unit.tool || this.mcpToolAllowed(req, unit.tool)
        );

        // First pass: peek every bucket this request would touch. A request that
        // needs multiple buckets (a publish also spends a write, and a batch may
        // call the same tool twice) must consume all of them or none of them,
        // so we refuse before any bucket is spent. `pending` counts the hits
        // this same request has already planned for one bucket.
        const pending = new Map<TokenRateClass, number>();
        for (const unit of units) {
            for (const cls of [unit.cls, unit.also].filter(Boolean) as TokenRateClass[]) {
                const rule = settings[cls];
                const decision = appRateLimiter.peek(`tok:${tokenId}:${cls}`, rule.max, rule.windowMs);
                const planned = pending.get(cls) || 0;
                // peek() reports what is left after one hit, so this hit fits
                // only when what peek() leaves covers the hits already planned.
                if (!decision.allowed || decision.remaining < planned) {
                    writeAudit({
                        event: 'token',
                        action: 'rate_limited',
                        outcome: 'denied',
                        tokenId,
                        class: cls,
                        ...fields
                    });
                    res.setHeader('Retry-After', String(Math.max(1, decision.retryAfterSeconds)));
                    res.setHeader('RateLimit-Limit', String(decision.limit));
                    res.setHeader('RateLimit-Remaining', '0');
                    return res.status(429).json({ message: 'Too many requests' });
                }
                pending.set(cls, planned + 1);
            }
        }

        // Second pass: every bucket that peeked OK is now consumed.
        for (const unit of units) {
            for (const cls of [unit.cls, unit.also].filter(Boolean) as TokenRateClass[]) {
                const rule = settings[cls];
                appRateLimiter.hit(`tok:${tokenId}:${cls}`, rule.max, rule.windowMs);
            }
        }
    }

    /** Whether this caller may run the MCP tool at all (role and scope). */
    private mcpToolAllowed(req: AuthenticatedRequest, tool: string): boolean {
        const role = req.user?.role;
        if (!role || !roleAllowsMcpTool(tool, role)) return false;
        const scopes = req.tokenScopes;
        if (scopes && !tokenAllowsTool(scopes, tool)) return false;
        return true;
    }

    private authenticateJwt(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
        secret: string,
        mcp = false
    ) {
        const token = req.headers['authorization']?.split(' ')[1];
        const site = this.opts.getAuditSite ? this.opts.getAuditSite() : undefined;
        if (!token) {
            return mcp
                ? denyMcp(res, req, 'missing', 'No token', site)
                : res.status(401).json({ message: 'No token' });
        }
        // A credential the server cannot trust (on /mcp and on REST routes) is "not authenticated": 401,
        // the same body for every cause, an audit row, and no token text anywhere.
        const refuse = (res2: Response) =>
            denyMcp(res2, req, 'invalid', INVALID_TOKEN_MESSAGE, site);

        jwt.verify(token, secret, (err, decoded) => {
            if (err) {
                console.error(`[AUTH] JWT verification failed: ${err.message}`);
                return refuse(res);
            }
            const payload = decoded as { username?: string };
            const identity = liveIdentity(payload?.username);
            if (!identity) {
                return refuse(res);
            }
            // An MCP-only agent account has no browser identity: its token is all it gets.
            if (identity.mcpOnly) {
                return refuse(res);
            }
            req.user = { username: identity.username, role: identity.role };
            req.authVia = 'jwt';
            next();
        });
    }

    private authenticateSession(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
        mcp = false
    ) {
        const site = this.opts.getAuditSite ? this.opts.getAuditSite() : undefined;
        const refuse = () =>
            denyMcp(res, req, 'invalid', INVALID_TOKEN_MESSAGE, site);
        const name = this.opts.getSessionCookieName();
        const cookies = parseCookies(req.headers.cookie);
        const sid = cookies[name];
        if (!sid) {
            if (!mcp) return res.status(401).json({ message: 'No token' });
            // A bearer that is not a personal access token was presented and cannot
            // be trusted in session mode: that is "invalid", not "missing".
            const presented = req.headers['authorization']?.split(' ')[1];
            return denyMcp(res, req, presented ? 'invalid' : 'missing', presented ? INVALID_TOKEN_MESSAGE : 'No token', site);
        }

        const store = this.opts.getSessionStore();
        const rec: SessionRecord | null = store.get(sid);
        if (!rec) return refuse();

        const identity = liveIdentity(rec.username, store, rec.id);
        if (!identity) {
            return refuse();
        }
        // An MCP-only agent account may not hold a browser session.
        if (identity.mcpOnly) {
            store.destroy(rec.id);
            return refuse();
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
