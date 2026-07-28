/**
 * Path containment algorithm (INV-SEC-3).
 *
 * Pure predicate — no I/O.
 *
 * Spec: isSafePath(base, target) ⇔
 *   let B = resolve(base), T = resolve(target)
 *   relative(B, T) does not escape B (no ".." prefix, not absolute).
 *
 * Complexity: O(|path|) string operations.
 */

import path from 'path';

export function isSafePath(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
