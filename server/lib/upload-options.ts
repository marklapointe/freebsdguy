/**
 * UploadOptionsBuilder — centralized multer policy (INV: bounded uploads).
 *
 * Builder validates limits and MIME allowlist at build time.
 */

import multer from 'multer';
import type { Request } from 'express';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
const DEFAULT_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif'
]);

export class UploadOptionsBuilder {
    private maxBytes = DEFAULT_MAX_BYTES;
    private mimeAllow = new Set(DEFAULT_MIME);

    maxFileSize(bytes: number): this {
        if (bytes <= 0) throw new Error('maxFileSize must be positive');
        this.maxBytes = bytes;
        return this;
    }

    allowMime(...types: string[]): this {
        this.mimeAllow = new Set(types);
        return this;
    }

    build(): multer.Multer {
        const mimeAllow = this.mimeAllow;
        const maxBytes = this.maxBytes;

        return multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: maxBytes, files: 1 },
            fileFilter: (_req: Request, file, cb) => {
                if (!file.mimetype || !mimeAllow.has(file.mimetype)) {
                    cb(new Error(`Unsupported image type: ${file.mimetype || 'unknown'}`));
                    return;
                }
                cb(null, true);
            }
        });
    }
}

export function createDefaultImageUpload(): multer.Multer {
    return new UploadOptionsBuilder().build();
}
