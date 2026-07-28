/**
 * RoleGuardFactory — Express middleware products for JWT auth + role checks.
 *
 * Factory pattern: one family of middleware from role discriminators.
 * INV-AUTH-1 / INV-AUTH-2 enforced at the edge.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export class RoleGuardFactory {
    private secret: string;

    constructor(secret: string) {
        this.secret = secret;
    }

    /** Product: require valid JWT; attaches req.user */
    authenticate() {
        const secret = this.secret;
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
        };
    }

    /**
     * Product: require role ∈ allowed set.
     * Precondition: authenticate() ran first (req.user set).
     */
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

    /** Convenience products */
    requireAdmin() {
        return this.requireRole('admin');
    }

    requireContributorOrAdmin() {
        return this.requireRole('admin', 'contributor');
    }
}
