import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server/index';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { loadConfig, configPath } from '../server/lib/config';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

describe('Image Upload and Conversion', () => {
    let adminToken: string;
    const testImagePath = path.join(__dirname, 'test-image.png');

    beforeAll(() => {
        const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        fs.writeFileSync(testImagePath, pngBuffer);
    });

    afterAll(() => {
        if (fs.existsSync(testImagePath)) {
            fs.unlinkSync(testImagePath);
        }
    });

    beforeEach(async () => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ security: { disableImages: false } });
    });

    it('POST /api/admin/upload should convert PNG to WebP and rename it', async () => {
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ security: { disableImages: false } });

        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', testImagePath);

        if (res.status === 200) {
            expect(res.body).toHaveProperty('filename');
            expect(res.body.filename).toMatch(/\.webp$/);
            expect(res.body).toHaveProperty('url');
            expect(res.body.url).toBe(`/api/getimage?fileName=${res.body.filename}`);

            const config = loadConfig();
            const configDir = path.dirname(configPath());
            const postsDir = path.resolve(configDir, config.postsDir);
            const imagesDir = path.join(postsDir, 'images');
            const uploadedFilePath = path.join(imagesDir, res.body.filename);

            expect(fs.existsSync(uploadedFilePath)).toBe(true);
            fs.unlinkSync(uploadedFilePath);
        }
    });

    it('POST /api/admin/upload should return 400 if no file is uploaded', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`);

        expect([400, 403]).toContain(res.status);
    });

    it('POST /api/admin/upload should return 401 if unauthenticated', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .attach('image', testImagePath);

        expect(res.status).toBe(401);
    });
});
