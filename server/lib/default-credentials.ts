/**
 * Canonical first-boot admin credentials.
 * Unit tests pin: passwordHash must verify against DEFAULT_ADMIN_PASSWORD.
 */
export const DEFAULT_ADMIN_USERNAME = 'admin';

/** Plaintext password for the shipped sample users.json / first-boot default. */
export const DEFAULT_ADMIN_PASSWORD = 'admin';

/**
 * bcrypt hash of DEFAULT_ADMIN_PASSWORD (cost 10).
 * Regenerating this requires updating unit tests and sample users.json.
 */
export const DEFAULT_ADMIN_PASSWORD_HASH =
    '$2b$10$aec45wHR7e4wuCbZDL2SNuzHTZ/5caQoygpy2dd6anaY4Bb9hi/sW';
