import { describe, it, expect } from 'vitest';
import { isAllowedRole, ALLOWED_ROLES } from '../server/middleware/auth.ts';

describe('Role allowlist (INV-AUTH)', () => {
    it('accepts only admin and contributor', () => {
        expect(isAllowedRole('admin')).toBe(true);
        expect(isAllowedRole('contributor')).toBe(true);
        expect(isAllowedRole('superadmin')).toBe(false);
        expect(isAllowedRole('')).toBe(false);
        expect(isAllowedRole(null)).toBe(false);
    });

    it('exports closed set of size 2', () => {
        expect(ALLOWED_ROLES).toHaveLength(2);
    });
});
