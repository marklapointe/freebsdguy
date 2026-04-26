import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../server/index';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { loadConfig, configPath } from '../server/lib/config';

const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

describe('Image Deduplication', () => {
    let adminToken: string;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const manifestPath = path.join(imagesDir, 'metadata.json');

    beforeEach(() => {
        adminToken = jwt.sign({ username: 'admin', role: 'admin' }, SECRET);
        // Ensure clean state
        if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
        if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir);
            for (const file of files) {
                if (file !== '.keep') { // keep .keep if it exists
                    try {
                        fs.unlinkSync(path.join(imagesDir, file));
                    } catch (e) {}
                }
            }
        }
    });

    it('should upload a new image and create metadata', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', TINY_PNG, 'test1.jpg');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('filename');
        expect(res.body.duplicated).toBeUndefined();

        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest[res.body.filename].originalName).toBe('test1.jpg');
    });

    it('should deduplicate exactly same content', async () => {
        const content = TINY_PNG;
        
        // First upload
        const res1 = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', content, 'first.jpg');
        
        const firstFilename = res1.body.filename;

        // Second upload with same content but different name
        const res2 = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', content, 'second.jpg');

        expect(res2.status).toBe(200);
        expect(res2.body.filename).toBe(firstFilename);
        expect(res2.body.duplicated).toBe(true);
    });

    it('should return 409 for same name but different content', async () => {
        // First upload
        await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', Buffer.concat([TINY_PNG, Buffer.from('A')]), 'conflict.jpg');

        // Second upload with same name but different content
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', Buffer.concat([TINY_PNG, Buffer.from('B')]), 'conflict.jpg');

        expect(res.status).toBe(409);
        expect(res.body.conflict).toBe(true);
    });

    it('should allow force upload for same name but different content', async () => {
        // First upload
        await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', Buffer.concat([TINY_PNG, Buffer.from('A')]), 'force.jpg');

        // Second upload with force=true
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .query({ force: 'true' })
            .attach('image', Buffer.concat([TINY_PNG, Buffer.from('B')]), 'force.jpg');

        expect(res.status).toBe(200);
        expect(res.body.duplicated).toBeUndefined();
    });

    it('should cleanup metadata on delete', async () => {
        const res = await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', TINY_PNG, 'delete.jpg');
        
        const filename = res.body.filename;
        let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest[filename]).toBeDefined();

        await request(app)
            .delete(`/api/admin/images/${filename}`)
            .set('Authorization', `Bearer ${adminToken}`);

        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest[filename]).toBeUndefined();
    });

    it('GET /api/admin/images should return metadata', async () => {
        await request(app)
            .post('/api/admin/upload')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('image', TINY_PNG, 'list.jpg');

        const res = await request(app)
            .get('/api/admin/images')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.images[0]).toHaveProperty('originalName', 'list.jpg');
        expect(res.body.images[0]).toHaveProperty('filename');
    });
});
