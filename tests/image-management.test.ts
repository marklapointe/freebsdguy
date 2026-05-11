import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { loadConfig, configPath } from '../server/lib/config';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function createUniquePng(seed: number): Buffer {
    return Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==${seed}`, 'base64');
}

describe('Image Management End-to-End', () => {
    let adminToken: string;
    let contributorToken: string;

    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const manifestPath = path.join(imagesDir, 'metadata.json');

    beforeAll(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
        contributorToken = jwt.sign({ username: 'contributor', role: 'contributor' }, SECRET);
    });

    beforeEach(async () => {
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ security: { disableImages: false } });

        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
        }
    });

    afterEach(() => {
        if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir);
            for (const file of files) {
                if (file !== '.keep' && file.endsWith('.webp')) {
                    try {
                        fs.unlinkSync(path.join(imagesDir, file));
                    } catch (e) {}
                }
            }
        }
        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
        }
    });

    describe('Image Upload', () => {
        it('should upload an image and receive correct filename for retrieval', async () => {
            const res = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'test-upload.png');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('filename');
            expect(res.body.filename).toMatch(/\.webp$/);
            expect(res.body).toHaveProperty('url');
            expect(res.body.url).toBe(`/api/getimage?fileName=${res.body.filename}`);

            const uploadedFilePath = path.join(imagesDir, res.body.filename);
            expect(fs.existsSync(uploadedFilePath)).toBe(true);
        });

        it('should reject upload when images are disabled', async () => {
            await request(app)
                .post('/api/admin/config')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ security: { disableImages: true } });

            const res = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'blocked.png');

            expect(res.status).toBe(403);
        });

        it('should allow contributor to upload images', async () => {
            const res = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${contributorToken}`)
                .attach('image', TINY_PNG, 'contributor-upload.png');

            expect(res.status).toBe(200);
        });

        it('should reject unauthenticated upload', async () => {
            const res = await request(app)
                .post('/api/admin/upload')
                .attach('image', TINY_PNG, 'unauth.png');

            expect(res.status).toBe(401);
        });
    });

    describe('Image Listing', () => {
        it('should list uploaded images with correct metadata', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'listed-image.png');

            const filename = uploadRes.body.filename;

            const listRes = await request(app)
                .get('/api/admin/images')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(listRes.status).toBe(200);
            expect(listRes.body).toHaveProperty('images');
            expect(listRes.body).toHaveProperty('total');
            expect(Array.isArray(listRes.body.images)).toBe(true);
            expect(listRes.body.total).toBeGreaterThan(0);

            const foundImage = listRes.body.images.find((img: any) => img.filename === filename);
            expect(foundImage).toBeDefined();
            expect(foundImage.originalName).toBe('listed-image.png');
            expect(foundImage).toHaveProperty('uploadedAt');
        });

        it('should return images with filename that can be used to construct thumbnail URL', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'thumbnail-test.png');

            const filename = uploadRes.body.filename;

            const listRes = await request(app)
                .get('/api/admin/images')
                .set('Authorization', `Bearer ${adminToken}`);

            const foundImage = listRes.body.images.find((img: any) => img.filename === filename);
            expect(foundImage).toBeDefined();
            expect(foundImage.filename).toBe(filename);

            const constructedUrl = `/api/getimage?fileName=${filename}`;

            const getRes = await request(app).get(constructedUrl);
            expect(getRes.status).toBe(200);
            expect(getRes.headers['content-type']).toMatch(/image/);
        });

        it('should support pagination with different images', async () => {
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/admin/upload')
                    .set('Authorization', `Bearer ${adminToken}`)
                    .attach('image', createUniquePng(i), `page-test-${i}.png`);
            }

            const page1 = await request(app)
                .get('/api/admin/images?limit=2&offset=0')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(page1.body.images.length).toBeLessThanOrEqual(2);

            const page2 = await request(app)
                .get('/api/admin/images?limit=2&offset=2')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(page2.body.images.length).toBeLessThanOrEqual(2);
        });

        it('should support limit=all for getting all images', async () => {
            for (let i = 0; i < 3; i++) {
                await request(app)
                    .post('/api/admin/upload')
                    .set('Authorization', `Bearer ${adminToken}`)
                    .attach('image', createUniquePng(i + 100), `all-test-${i}.png`);
            }

            const res = await request(app)
                .get('/api/admin/images?limit=all')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.body.images.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Image Retrieval via /api/getimage', () => {
        it('should retrieve an uploaded image by filename', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'retrieve-test.png');

            const filename = uploadRes.body.filename;

            const getRes = await request(app)
                .get(`/api/getimage?fileName=${filename}`);

            expect(getRes.status).toBe(200);
            expect(getRes.headers['content-type']).toMatch(/image/);
        });

        it('should retrieve image via /api/images/:filename (legacy route)', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'legacy-route.png');

            const filename = uploadRes.body.filename;

            const getRes = await request(app)
                .get(`/api/images/${filename}`);

            expect(getRes.status).toBe(200);
        });

        it('should return 404 for nonexistent image', async () => {
            const res = await request(app)
                .get('/api/getimage?fileName=nonexistent-image-12345.webp');

            expect(res.status).toBe(404);
        });

        it('should return 400 when no filename provided', async () => {
            const res = await request(app)
                .get('/api/getimage');

            expect(res.status).toBe(400);
        });

        it('should block directory traversal attempts', async () => {
            const res = await request(app)
                .get('/api/getimage?fileName=../config.json');

            expect(res.status).toBe(403);
        });

        it('should decode URI encoded filenames', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'spaced file.png');

            const filename = uploadRes.body.filename;
            const encodedFilename = encodeURIComponent(filename);

            const getRes = await request(app)
                .get(`/api/getimage?fileName=${encodedFilename}`);

            expect(getRes.status).toBe(200);
        });
    });

    describe('Image Deletion', () => {
        it('should delete an image and remove from filesystem', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'delete-me.png');

            const filename = uploadRes.body.filename;
            const filePath = path.join(imagesDir, filename);

            expect(fs.existsSync(filePath)).toBe(true);

            const deleteRes = await request(app)
                .delete(`/api/admin/images/${filename}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(deleteRes.status).toBe(200);

            expect(fs.existsSync(filePath)).toBe(false);

            const getRes = await request(app)
                .get(`/api/getimage?fileName=${filename}`);

            expect(getRes.status).toBe(404);
        });

        it('should return 404 when deleting nonexistent image', async () => {
            const res = await request(app)
                .delete('/api/admin/images/nonexistent-file-12345.webp')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(404);
        });

        it('should block directory traversal on delete via route param', async () => {
            const res = await request(app)
                .delete('/api/admin/images/../config.json')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([403, 404]).toContain(res.status);
        });

        it('should remove image from manifest after deletion', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'manifest-test.png');

            const filename = uploadRes.body.filename;

            let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(manifest[filename]).toBeDefined();

            await request(app)
                .delete(`/api/admin/images/${filename}`)
                .set('Authorization', `Bearer ${adminToken}`);

            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(manifest[filename]).toBeUndefined();
        });

        it('should allow contributor to delete their own uploaded image', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${contributorToken}`)
                .attach('image', TINY_PNG, 'contributor-delete.png');

            const filename = uploadRes.body.filename;

            const deleteRes = await request(app)
                .delete(`/api/admin/images/${filename}`)
                .set('Authorization', `Bearer ${contributorToken}`);

            expect(deleteRes.status).toBe(200);
        });

        it('contributors can currently delete any image (ownership check not implemented)', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'admin-only.png');

            const filename = uploadRes.body.filename;

            const deleteRes = await request(app)
                .delete(`/api/admin/images/${filename}`)
                .set('Authorization', `Bearer ${contributorToken}`);

            expect(deleteRes.status).toBe(200);
        });
    });

    describe('Bulk Delete', () => {
        it('should delete multiple unique images at once', async () => {
            const filenames: string[] = [];
            for (let i = 0; i < 3; i++) {
                const res = await request(app)
                    .post('/api/admin/upload')
                    .set('Authorization', `Bearer ${adminToken}`)
                    .attach('image', createUniquePng(i + 200), `bulk-${i}.png`);
                filenames.push(res.body.filename);
            }

            const uniqueFilenames = [...new Set(filenames)];

            for (const fn of uniqueFilenames) {
                expect(fs.existsSync(path.join(imagesDir, fn))).toBe(true);
            }

            const deleteRes = await request(app)
                .post('/api/admin/images/delete-bulk')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ filenames });

            expect(deleteRes.status).toBe(200);
            expect(deleteRes.body.deletedCount).toBe(uniqueFilenames.length);

            for (const fn of uniqueFilenames) {
                expect(fs.existsSync(path.join(imagesDir, fn))).toBe(false);
            }
        });
    });

    describe('Thumbnail URL Consistency', () => {
        it('should return filenames that can be used to construct working thumbnail URLs', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'thumbnail-consistency.png');

            const filename = uploadRes.body.filename;

            const listRes = await request(app)
                .get('/api/admin/images')
                .set('Authorization', `Bearer ${adminToken}`);

            const image = listRes.body.images.find((img: any) => img.filename === filename);

            expect(image.filename).toBe(filename);

            const thumbnailUrl = `/api/getimage?fileName=${filename}`;
            const getRes = await request(app).get(thumbnailUrl);
            expect(getRes.status).toBe(200);
            expect(getRes.headers['content-type']).toMatch(/image/);
        });

        it('should handle special characters in filenames correctly', async () => {
            const uploadRes = await request(app)
                .post('/api/admin/upload')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('image', TINY_PNG, 'test with spaces and (parens).png');

            const filename = uploadRes.body.filename;

            const listRes = await request(app)
                .get('/api/admin/images')
                .set('Authorization', `Bearer ${adminToken}`);

            const image = listRes.body.images.find((img: any) => img.originalName === 'test with spaces and (parens).png');
            expect(image).toBeDefined();

            const encodedFilename = encodeURIComponent(filename);
            const getRes = await request(app)
                .get(`/api/getimage?fileName=${encodedFilename}`);

            expect(getRes.status).toBe(200);
        });
    });
});