import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { app } from '../server/index.ts';
import {
    isValidThemeId,
    listThemeIds,
    listThemeCatalog,
    loadThemeColors,
    REQUIRED_THEME_KEYS
} from '../server/lib/themes.ts';

const themesDir = path.resolve(process.cwd(), 'server/themes');

describe('Theme catalog (pre-generated packs)', () => {
    it('validates theme ids', () => {
        expect(isValidThemeId('dark')).toBe(true);
        expect(isValidThemeId('miami-vice')).toBe(true);
        expect(isValidThemeId('../etc/passwd')).toBe(false);
        expect(isValidThemeId('Bad Name')).toBe(false);
    });

    it('ships a large retro/game catalog on disk', () => {
        const ids = listThemeIds(themesDir);
        expect(ids.length).toBeGreaterThanOrEqual(20);
        expect(ids).toContain('dark');
        expect(ids).toContain('light');
        expect(ids).toContain('miami-vice');
        expect(ids).toContain('c64-green');
        expect(ids).toContain('gameboy');
        expect(ids).toContain('doom');
        expect(ids).toContain('portal');
    });

    it('every theme JSON has required CSS variables', () => {
        const ids = listThemeIds(themesDir);
        for (const id of ids) {
            const colors = loadThemeColors(themesDir, id);
            expect(colors, id).toBeTruthy();
            for (const key of REQUIRED_THEME_KEYS) {
                expect(colors![key], `${id} missing ${key}`).toMatch(/^#/);
            }
        }
    });

    it('listThemeCatalog includes labels and mdEditorTheme', () => {
        const cat = listThemeCatalog(themesDir);
        expect(cat.length).toBeGreaterThanOrEqual(20);
        for (const t of cat) {
            expect(t.id).toBeTruthy();
            expect(t.label).toBeTruthy();
            expect(['light', 'dark']).toContain(t.mdEditorTheme);
        }
    });
});

describe('Themes API', () => {
    it('GET /api/themes returns catalog', async () => {
        // Ensure config themeDir points at shipped themes when possible
        const res = await request(app).get('/api/themes');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // In test CONFIG_DIR may not include themes; still should not 500
        if (res.body.length) {
            expect(res.body[0]).toHaveProperty('id');
            expect(res.body[0]).toHaveProperty('label');
        }
    });

    it('GET /api/theme?name=dark returns CSS vars', async () => {
        const res = await request(app).get('/api/theme?name=dark');
        expect(res.status).toBe(200);
        expect(res.body['--bg'] || res.body['--primary']).toBeTruthy();
    });

    it('GET /api/theme?name=traversal-blocked falls back safely', async () => {
        const res = await request(app).get('/api/theme?name=' + encodeURIComponent('../etc/passwd'));
        expect(res.status).toBe(200);
        // invalid name → fallback dark palette
        expect(res.body['--bg']).toBeTruthy();
    });
});

describe('Theme files on disk integrity', () => {
    it('no theme file is empty JSON', () => {
        for (const f of fs.readdirSync(themesDir).filter(x => x.endsWith('.json'))) {
            const raw = JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8'));
            expect(Object.keys(raw).length).toBeGreaterThan(5);
        }
    });
});
