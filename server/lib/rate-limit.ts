/**
 * In-process rate limits for /api/login, /api, and /mcp.
 * Windows are separate so a login flood does not lock the health check.
 */
import type { Request, Response, NextFunction } from 'express';
import type { SecurityConfig } from './config.ts';

export interface RateRule {
    max: number;
    windowMs: number;
}

export interface RateSettings {
    login: RateRule;
    api: RateRule;
    mcp: RateRule;
}

export type RateKind = 'login' | 'api' | 'mcp';

export interface RateDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
}

function finiteNonNeg(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
}

export function classifyRoute(rawPath: string): RateKind | null {
    const pathOnly = (rawPath || '').split('?')[0];
    if (pathOnly === '/api/login') return 'login';
    if (pathOnly === '/mcp' || pathOnly.startsWith('/mcp/')) return 'mcp';
    if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return 'api';
    return null;
}

export function resolveRateLimitSettings(
    security: SecurityConfig | undefined | null,
    env: NodeJS.ProcessEnv = process.env
): RateSettings {
    const relaxed = Boolean(env.VITEST) && env.MDWEB_ENFORCE_RATE_LIMIT !== '1';
    const maxOf = (envName: string, configured: number | undefined, fallback: number) => {
        const fromEnv = finiteNonNeg(env[envName]);
        if (fromEnv !== undefined) return fromEnv;
        if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) return configured;
        return relaxed ? 1_000_000 : fallback;
    };
    const windowOf = (envName: string, configuredSeconds: number | undefined, fallbackSeconds: number) => {
        const fromEnv = finiteNonNeg(env[envName]);
        if (fromEnv !== undefined) return fromEnv;
        if (typeof configuredSeconds === 'number' && configuredSeconds > 0) return configuredSeconds * 1000;
        return fallbackSeconds * 1000;
    };
    return {
        login: {
            max: maxOf('MDWEB_LOGIN_RATE_MAX', security?.loginRateLimitMax, 10),
            windowMs: windowOf('MDWEB_LOGIN_RATE_WINDOW_MS', security?.loginRateLimitWindow, 60)
        },
        api: {
            max: maxOf('MDWEB_API_RATE_MAX', security?.apiRateLimitMax, 300),
            windowMs: windowOf('MDWEB_API_RATE_WINDOW_MS', security?.apiRateLimitWindow, 60)
        },
        mcp: {
            max: maxOf('MDWEB_MCP_RATE_MAX', security?.mcpRateLimitMax, 120),
            windowMs: windowOf('MDWEB_MCP_RATE_WINDOW_MS', security?.mcpRateLimitWindow, 60)
        }
    };
}

export class MemoryRateLimiter {
    private buckets = new Map<string, number[]>();

    constructor(private now: () => number = Date.now) {}

    hit(bucket: string, max: number, windowMs: number): RateDecision {
        const t = this.now();
        const start = t - windowMs;
        const prev = (this.buckets.get(bucket) || []).filter((ts) => ts > start);
        if (prev.length >= max) {
            const oldest = prev[0] ?? t;
            const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
            this.buckets.set(bucket, prev);
            return { allowed: false, limit: max, remaining: 0, retryAfterSeconds };
        }
        prev.push(t);
        this.buckets.set(bucket, prev);
        return { allowed: true, limit: max, remaining: Math.max(0, max - prev.length), retryAfterSeconds: 0 };
    }

    reset(): void {
        this.buckets.clear();
    }
}

export const appRateLimiter = new MemoryRateLimiter();

export function resetRateLimits(): void {
    appRateLimiter.reset();
}

export function createRateLimitMiddleware(opts: {
    limiter?: MemoryRateLimiter;
    getSettings?: () => RateSettings;
} = {}) {
    const limiter = opts.limiter || appRateLimiter;
    const getSettings = opts.getSettings || (() => resolveRateLimitSettings(undefined, process.env));
    return (req: Request, res: Response, next: NextFunction) => {
        const kind = classifyRoute(req.path || req.url || '');
        if (!kind) return next();
        const rule = getSettings()[kind];
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const decision = limiter.hit(`${kind}:${ip}`, rule.max, rule.windowMs);
        res.setHeader('RateLimit-Limit', String(decision.limit));
        res.setHeader('RateLimit-Remaining', String(decision.remaining));
        if (!decision.allowed) {
            res.setHeader('Retry-After', String(decision.retryAfterSeconds));
            return res.status(429).json({ message: 'Too many requests' });
        }
        next();
    };
}
