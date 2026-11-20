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

import fs from 'fs';
import path from 'path';

export function isSafePath(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** True when `target` is `base` or lies inside it (pure string check on real paths). */
function insideReal(realBase: string, realTarget: string): boolean {
    const rel = path.relative(realBase, realTarget);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Disk-aware variant of isSafePath (P0 C1). isSafePath is a pure string check
 * and follows no links, so a symlink inside the tree that points outside it
 * passes. This one also looks at the disk:
 *   - the lexical check must pass;
 *   - the directory that holds the target must resolve (realpath) inside the
 *     real base, so no symlinked sub-directory leads out;
 *   - an existing target must not be a symlink at all (not even one that
 *     points inside the tree) and its realpath must stay inside the real base.
 * A target that does not exist yet is safe when its directory is.
 * A base that does not exist holds nothing to follow, so it is safe.
 */
export function isSafeExistingPath(baseDir: string, targetPath: string): boolean {
    if (!isSafePath(baseDir, targetPath)) return false;
    let realBase: string;
    try {
        realBase = fs.realpathSync(baseDir);
    } catch (e) {
        // A base that does not exist holds nothing to follow; any other failure (EACCES, ELOOP, ...) fails closed.
        return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
    }
    const target = path.resolve(targetPath);
    if (path.relative(path.resolve(baseDir), target) === '') return true;
    try {
        const realParent = fs.realpathSync(path.dirname(target));
        if (!insideReal(realBase, realParent)) return false;
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') return false;
    }
    let st: fs.Stats;
    try {
        st = fs.lstatSync(target);
    } catch (e) {
        return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
    }
    if (st.isSymbolicLink()) return false;
    try {
        return insideReal(realBase, fs.realpathSync(target));
    } catch {
        return false;
    }
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
