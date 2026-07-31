import { describe, it, expect } from 'vitest';
import { UploadOptionsBuilder, createDefaultImageUpload } from '../server/lib/upload-options.ts';

describe('UploadOptionsBuilder', () => {
    it('createDefaultImageUpload returns multer', () => {
        const m = createDefaultImageUpload();
        expect(m).toBeTruthy();
        expect(typeof m.single).toBe('function');
    });

    it('maxFileSize rejects non-positive', () => {
        expect(() => new UploadOptionsBuilder().maxFileSize(0)).toThrow(/positive/);
        expect(() => new UploadOptionsBuilder().maxFileSize(-1)).toThrow(/positive/);
    });

    it('maxFileSize and allowMime configure filter', () => {
        const m = new UploadOptionsBuilder().maxFileSize(1024).allowMime('image/png').build();
        expect(m).toBeTruthy();
        // exercise fileFilter via internal options if available
        const opts = (m as any).options || (m as any);
        const filter = opts.fileFilter || (m as any)._fileFilter;
        if (typeof filter === 'function') {
            let err: any;
            let ok: any;
            filter({}, { mimetype: 'image/png' }, (e: any, accept?: boolean) => {
                err = e;
                ok = accept;
            });
            expect(err).toBeNull();
            expect(ok).toBe(true);
            filter({}, { mimetype: 'text/plain' }, (e: any) => {
                err = e;
            });
            expect(err).toBeInstanceOf(Error);
            filter({}, { mimetype: '' }, (e: any) => {
                err = e;
            });
            expect(err).toBeInstanceOf(Error);
        }
    });
});
