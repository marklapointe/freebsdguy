import { describe, it, expect } from 'vitest';
import {
    JwtSecretFactory,
    JwtSecretError,
    INSECURE_DEFAULT_JWT_SECRET,
    isInsecureJwtSecret
} from '../server/lib/jwt-secret.ts';

describe('JwtSecretFactory (INV-SEC-2)', () => {
    it('prefers environment over config', () => {
        const result = JwtSecretFactory.forMode('development')
            .fromEnv('env-secret-at-least-16')
            .fromConfig({ jwtSecret: 'config-secret-16ch' })
            .create();
        expect(result.secret).toBe('env-secret-at-least-16');
        expect(result.source).toBe('env');
        expect(result.secure).toBe(true);
    });

    it('uses config when env missing', () => {
        const result = JwtSecretFactory.forMode('development')
            .fromEnv(undefined)
            .fromConfig({ jwtSecret: 'config-secret-16ch' })
            .create();
        expect(result.secret).toBe('config-secret-16ch');
        expect(result.source).toBe('config');
    });

    it('allows insecure default only outside production', () => {
        const result = JwtSecretFactory.forMode('development')
            .fromEnv(undefined)
            .fromConfig({})
            .create();
        expect(result.secret).toBe(INSECURE_DEFAULT_JWT_SECRET);
        expect(result.secure).toBe(false);
    });

    it('hard-fails in production with no secret', () => {
        expect(() =>
            JwtSecretFactory.forMode('production').fromEnv(undefined).fromConfig({}).create()
        ).toThrow(JwtSecretError);
    });

    it('hard-fails in production with default insecure secret', () => {
        expect(() =>
            JwtSecretFactory.forMode('production')
                .fromEnv(INSECURE_DEFAULT_JWT_SECRET)
                .create()
        ).toThrow(JwtSecretError);
    });

    it('hard-fails in production with short secret', () => {
        expect(() =>
            JwtSecretFactory.forMode('production').fromEnv('tooshort').create()
        ).toThrow(JwtSecretError);
    });

    it('isInsecureJwtSecret recognizes default and short values', () => {
        expect(isInsecureJwtSecret(INSECURE_DEFAULT_JWT_SECRET)).toBe(true);
        expect(isInsecureJwtSecret('short')).toBe(true);
        expect(isInsecureJwtSecret('long-enough-secret-01')).toBe(false);
    });
});
