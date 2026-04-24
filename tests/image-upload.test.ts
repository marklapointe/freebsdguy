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
        // Create a dummy PNG for testing
        // A minimal 1x1 transparent PNG
        const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        fs.writeFileSync(testImagePath, pngBuffer);
    });

    afterAll(() => {
        if (fs.existsSync(testImagePath)) {
            fs.unlinkSync(testImagePath);
        }
    });

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
    });

    it('POST /api/admin/upload should convert PNG to WebP and rename it', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', testImagePath);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('filename');
        expect(res.body.filename).toMatch(/\.webp$/);
        expect(res.body).toHaveProperty('url');
        expect(res.body.url).toContain(res.body.filename);

        // Verify file exists on disk
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');
        const uploadedFilePath = path.join(imagesDir, res.body.filename);

        expect(fs.existsSync(uploadedFilePath)).toBe(true);

        // Cleanup uploaded file
        fs.unlinkSync(uploadedFilePath);
    });

    it('POST /api/admin/upload should return 400 if no file is uploaded', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
    });

    it('POST /api/admin/upload should return 401 if unauthenticated', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .attach('image', testImagePath);

        expect(res.status).toBe(401);
    });
});
