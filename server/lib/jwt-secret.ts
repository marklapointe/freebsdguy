/**
 * JwtSecretFactory — resolves the signing secret for JWTs.
 *
 * Factory pattern: product is a verified secret string; strategy varies by env.
 *
 * TAOCP-style invariant (INV-SEC-2):
 *   Production processes never sign with the known-insecure default.
 *
 * Algorithm (stepwise):
 *   1. Prefer process.env.JWT_SECRET if non-empty
 *   2. Else config.jwtSecret if non-empty
 *   3. Else if production → hard fail
 *   4. Else allow default with explicit insecure flag (dev/test only)
 */

import type { Config } from './config.ts';

export const INSECURE_DEFAULT_JWT_SECRET = 'freebsd_guy_secret_key';

export type JwtResolveMode = 'production' | 'development' | 'test';

export interface JwtSecretResult {
    secret: string;
    source: 'env' | 'config' | 'insecure-default';
    secure: boolean;
}

export class JwtSecretError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JwtSecretError';
    }
}

function detectMode(explicit?: JwtResolveMode): JwtResolveMode {
    if (explicit) return explicit;
    if (process.env.VITEST) return 'test';
    if (process.env.NODE_ENV === 'production') return 'production';
    return 'development';
}

export class JwtSecretFactory {
    private mode: JwtResolveMode;
    private envSecret?: string;
    private configSecret?: string;

    private constructor(mode: JwtResolveMode) {
        this.mode = mode;
    }

    static forMode(mode?: JwtResolveMode): JwtSecretFactory {
        return new JwtSecretFactory(detectMode(mode));
    }

    fromEnv(secret: string | undefined): this {
        this.envSecret = secret?.trim() || undefined;
        return this;
    }

    fromConfig(config: Pick<Config, 'jwtSecret'> | null | undefined): this {
        this.configSecret = config?.jwtSecret?.trim() || undefined;
        return this;
    }

    /**
     * Resolve secret.
     * Precondition: mode is set.
     * Postcondition: if result.secure then secret !== INSECURE_DEFAULT_JWT_SECRET
     *                if mode === production then result.secure === true
     */
    create(): JwtSecretResult {
        if (this.envSecret) {
            return this.finalize(this.envSecret, 'env');
        }
        if (this.configSecret) {
            return this.finalize(this.configSecret, 'config');
        }

        if (this.mode === 'production') {
            throw new JwtSecretError(
                'INV-SEC-2: JWT_SECRET is required in production (set env JWT_SECRET or config.jwtSecret)'
            );
        }

        // Dev/test only — known insecure default
        return {
            secret: INSECURE_DEFAULT_JWT_SECRET,
            source: 'insecure-default',
            secure: false
        };
    }

    private finalize(secret: string, source: 'env' | 'config'): JwtSecretResult {
        const secure = secret !== INSECURE_DEFAULT_JWT_SECRET && secret.length >= 16;
        if (this.mode === 'production' && !secure) {
            throw new JwtSecretError(
                'INV-SEC-2: production JWT secret is missing, too short (<16), or equals the insecure default'
            );
        }
        return { secret, source, secure };
    }
}

/** Convenience for call sites that only need the string. */
export function resolveJwtSecret(config?: Pick<Config, 'jwtSecret'> | null, mode?: JwtResolveMode): string {
    return JwtSecretFactory.forMode(mode)
        .fromEnv(process.env.JWT_SECRET)
        .fromConfig(config ?? undefined)
        .create().secret;
}

export function isInsecureJwtSecret(secret: string): boolean {
    return secret === INSECURE_DEFAULT_JWT_SECRET || secret.length < 16;
}
