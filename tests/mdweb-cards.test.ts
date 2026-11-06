/**
 * Generic test cards (Track #1682): theme styles .mdweb-card* so posts can
 * emit one card per test from shared data. No post-specific code in mdweb.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('mdweb cards CSS', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    it('defines generic card / group / grid classes', () => {
        for (const sel of ['.mdweb-card-grid', '.mdweb-card-group', '.mdweb-card', '.mdweb-card-name', '.mdweb-card-label']) {
            expect(css).toContain(sel);
        }
    });
    it('is responsive (auto-fill grid, not a fixed desktop width)', () => {
        expect(css).toMatch(/\.mdweb-card-grid[^}]*auto-fill/);
        expect(css).toMatch(/minmax\(/);
    });
});
