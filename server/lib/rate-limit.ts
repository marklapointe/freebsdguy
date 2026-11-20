/**
 * In-process rate limits for /api/login, /api, and /mcp.
 * Windows are separate so a login flood does not lock the health check.
 */
import type { Request, Response, NextFunction } from 'express';
import type { SecurityConfig } from './config.ts';
import { ADMIN_ONLY_MCP_TOOLS, WRITER_MCP_TOOLS, isMutatingHttpRequest } from './token-scope.ts';

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

/**
 * The class of a request, counted per token (Track #2119 U8).
 *
 * publish is the rarest and the strictest: a publish also spends a write.
 */
export type TokenRateClass = 'read' | 'write' | 'publish';

export interface TokenRateSettings {
    read: RateRule;
    write: RateRule;
    publish: RateRule;
}

/** The default limits of one token. */
export const TOKEN_RATE_DEFAULTS = {
    readPerMinute: 60,
    writePerMinute: 10,
    publishPerHour: 3
} as const;

/**
 * The per-token limits. The env wins; a value that is not a number or is
 * negative is ignored, so a typo cannot open a bucket. Under VITEST the
 * limits are relaxed, exactly as the per-IP limits are, unless
 * MDWEB_ENFORCE_RATE_LIMIT=1.
 */
export function resolveTokenRateLimitSettings(
    security: SecurityConfig | undefined | null,
    env: NodeJS.ProcessEnv = process.env
): TokenRateSettings {
    const relaxed = Boolean(env.VITEST) && env.MDWEB_ENFORCE_RATE_LIMIT !== '1';
    const configured = security?.tokenRateLimits;
    const maxOf = (envName: string, configuredMax: number | undefined, fallback: number) => {
        const fromEnv = finiteNonNeg(env[envName]);
        if (fromEnv !== undefined) return fromEnv;
        if (typeof configuredMax === 'number' && Number.isFinite(configuredMax) && configuredMax >= 0) {
            return configuredMax;
        }
        return relaxed ? 1_000_000 : fallback;
    };
    return {
        read: {
            max: maxOf('MDWEB_TOKEN_READ_PER_MIN', configured?.readPerMinute, TOKEN_RATE_DEFAULTS.readPerMinute),
            windowMs: 60 * 1000
        },
        write: {
            max: maxOf('MDWEB_TOKEN_WRITE_PER_MIN', configured?.writePerMinute, TOKEN_RATE_DEFAULTS.writePerMinute),
            windowMs: 60 * 1000
        },
        publish: {
            max: maxOf('MDWEB_TOKEN_PUBLISH_PER_HOUR', configured?.publishPerHour, TOKEN_RATE_DEFAULTS.publishPerHour),
            windowMs: 60 * 60 * 1000
        }
    };
}

/** The MCP tools whose call publishes or unpublishes a post. */
export const PUBLISH_MCP_TOOLS: ReadonlySet<string> = new Set(['publish_post', 'unpublish_post']);

/** One bucket hit a request makes. */
export interface TokenRateUnit {
    /** The class whose bucket this hit belongs to. */
    cls: TokenRateClass;
    /** A publish also spends a write: the second bucket it touches. */
    also?: TokenRateClass;
    /** The MCP tool this unit came from, when it came from one. */
    tool?: string;
}

/** The tools/call entries of a JSON-RPC body, one object or a batch. */
export function mcpToolCalls(body: unknown): { name: string; args: unknown }[] {
    const entries = Array.isArray(body) ? body : body ? [body] : [];
    const calls: { name: string; args: unknown }[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const rpc = entry as { method?: unknown; params?: unknown };
        if (rpc.method !== 'tools/call') continue;
        const params = (
            rpc.params && typeof rpc.params === 'object' ? rpc.params : {}
        ) as { name?: unknown; arguments?: unknown };
        calls.push({
            name: typeof params.name === 'string' ? params.name : '',
            args: params.arguments
        });
    }
    return calls;
}

/** A REST route that publishes or unpublishes a post. */
export function isPublishHttpPath(rawPath: string): boolean {
    const segments = (rawPath || '').split('?')[0].toLowerCase().split('/').filter(Boolean);
    return segments.some((segment) => segment === 'publish' || segment === 'unpublish');
}

/**
 * The buckets a request spends, in the order they are spent.
 *
 * A /mcp request is classified from the body it already carries: every
 * tools/call entry of a batch counts on its own, and a publish counts as a
 * write as well. Every other request is a write when it mutates and a read
 * when it does not.
 */
export function tokenRateUnits(req: {
    method: string;
    path?: string;
    originalUrl?: string;
    body?: unknown;
}): TokenRateUnit[] {
    const pathOnly = (req.path || req.originalUrl || '').split('?')[0].toLowerCase();
    if (pathOnly === '/mcp' || pathOnly.startsWith('/mcp/')) {
        const calls = mcpToolCalls(req.body);
        if (!calls.length) return [{ cls: 'read' }];
        return calls.map((call) => {
            if (PUBLISH_MCP_TOOLS.has(call.name)) {
                return { cls: 'publish' as TokenRateClass, also: 'write' as TokenRateClass, tool: call.name };
            }
            if (WRITER_MCP_TOOLS.has(call.name) || ADMIN_ONLY_MCP_TOOLS.has(call.name)) {
                return { cls: 'write' as TokenRateClass, tool: call.name };
            }
            return { cls: 'read' as TokenRateClass, tool: call.name };
        });
    }
    const method = (req.method || '').toUpperCase();
    if (method === 'POST' && isPublishHttpPath(pathOnly)) {
        return [{ cls: 'publish', also: 'write' }];
    }
    if (isMutatingHttpRequest(method, pathOnly)) return [{ cls: 'write' }];
    return [{ cls: 'read' }];
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

    /**
     * Non-consuming preview of what `hit` would decide right now. Useful when a
     * single request touches several buckets and must either consume all of them
     * or none of them.
     */
    peek(bucket: string, max: number, windowMs: number): RateDecision {
        const t = this.now();
        const start = t - windowMs;
        const prev = (this.buckets.get(bucket) || []).filter((ts) => ts > start);
        if (prev.length >= max) {
            const oldest = prev[0] ?? t;
            const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
            return { allowed: false, limit: max, remaining: 0, retryAfterSeconds };
        }
        return { allowed: true, limit: max, remaining: Math.max(0, max - prev.length - 1), retryAfterSeconds: 0 };
    }

    /** Current number of hits left in the bucket, without consuming one. */
    remaining(bucket: string, max: number, windowMs: number): number {
        const t = this.now();
        const start = t - windowMs;
        const prev = (this.buckets.get(bucket) || []).filter((ts) => ts > start);
        return Math.max(0, max - prev.length);
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
