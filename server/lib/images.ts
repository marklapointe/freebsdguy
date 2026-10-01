import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ImageMetadata {
    filename: string; // The generated .webp name
    originalName: string;
    md5: string;
    size: number;
    uploadedAt: number;
}

export interface ImageManifest {
    [filename: string]: ImageMetadata;
}

export function calculateMD5(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

export function loadManifest(imagesDir: string): ImageManifest {
    const manifestPath = path.join(imagesDir, 'metadata.json');
    if (!fs.existsSync(manifestPath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        console.error('Error loading image manifest:', e);
        return {};
    }
}

export function saveManifest(imagesDir: string, manifest: ImageManifest): void {
    const manifestPath = path.join(imagesDir, 'metadata.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

export function findDuplicate(manifest: ImageManifest, md5: string, size: number): ImageMetadata | null {
    for (const filename in manifest) {
        if (manifest[filename].md5 === md5 && manifest[filename].size === size) {
            return manifest[filename];
        }
    }
    return null;
}

export function findByName(manifest: ImageManifest, originalName: string): ImageMetadata | null {
    for (const filename in manifest) {
        if (manifest[filename].originalName === originalName) {
            return manifest[filename];
        }
    }
    return null;
}

/** Per-directory promise chain so manifest read-modify-write sequences never interleave. */
const manifestLocks = new Map<string, Promise<unknown>>();

/**
 * Run `task` with exclusive access to the manifest of `imagesDir`.
 * Tasks for the same directory execute strictly in FIFO order; a rejected
 * task releases the lock for the next one.
 */
export function withManifestLock<T>(imagesDir: string, task: () => Promise<T>): Promise<T> {
    const key = path.resolve(imagesDir);
    const prev = manifestLocks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(task);
    const settled = run.catch(() => undefined);
    manifestLocks.set(key, settled);
    settled.then(() => {
        if (manifestLocks.get(key) === settled) manifestLocks.delete(key);
    });
    return run;
}
