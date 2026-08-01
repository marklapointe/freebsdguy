/**
 * Path algorithms (INV-SEC-3).
 *
 * Pure functions — no I/O.
 *
 * Spec: isSafePath(base, target) ⇔
 *   let B = resolve(base), T = resolve(target)
 *   relative(B, T) does not escape B (no ".." prefix, not absolute).
 *
 * Spec: resolveConfiguredPath(base, configured) ⇔
 *   absolute(configured) ? configured : resolve(base, configured)
 *   (empty configured → resolve(base)).
 *
 * Complexity: O(|path|) string operations.
 *
 * TAOCP: factor the single path-resolution rule used by config, preflight,
 * routes, and seed — one definition, many call sites.
 */

import path from 'path';

export function isSafePath(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Resolve a config path that may be absolute or relative to baseDir. */
export function resolveConfiguredPath(baseDir: string, configured: string | undefined | null): string {
    const raw = (configured ?? '').trim();
    if (!raw) return path.resolve(baseDir);
    return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

/** Posts directory absolute path from config fields. */
export function resolvePostsDir(configDir: string, postsDir: string | undefined | null): string {
    return resolveConfiguredPath(configDir, postsDir || './posts');
}

/** Images live under postsDir/images (INV: single tree for content assets). */
export function resolveImagesDir(configDir: string, postsDir: string | undefined | null): string {
    return path.join(resolvePostsDir(configDir, postsDir), 'images');
}
