/**
 * Password comparison, and the fixed dummy hash a refusal compares against.
 *
 * A refusal that costs nothing tells the caller that the account exists: a
 * wrong password on a real account costs a bcrypt compare, a refusal that is
 * returned before the compare is measurably faster. So every refusal does the
 * same work, against a hash that matches nothing.
 */
import bcrypt from 'bcryptjs';

/**
 * A bcrypt hash of a random value nobody knows, at the same cost (10) as every
 * hash mdweb writes. It matches no password: it exists so that a refusal can
 * cost the same bcrypt work a wrong password costs.
 */
export const DUMMY_PASSWORD_HASH =
    '$2b$10$0eYnNKn0ynavOZ70dT1UtOwaP.595kDR/VPevGDic1nAmVi4QKurq';

/**
 * Compare a plaintext password with a hash. Never throws: an unusable hash or
 * an unusable password is simply a mismatch.
 */
export async function passwordMatches(
    plain: unknown,
    hash: string | undefined
): Promise<boolean> {
    if (!hash || typeof plain !== 'string' || !plain) return false;
    try {
        return await bcrypt.compare(plain, hash);
    } catch {
        return false;
    }
}
