/**
 * The mdweb port ships server/ + dist/ only — not src/. A server module that
 * imports from ../../src/... boots in the git checkout and dies in the
 * package (Track #1682, mdweb 1.1.0_16: ERR_MODULE_NOT_FOUND site-accent.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function walk(dir: string, acc: string[] = []): string[] {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else if (/\.(ts|js|mjs|cjs)$/.test(ent.name)) acc.push(p);
    }
    return acc;
}

describe('server tree is self-contained (package ships server/ + dist/, not src/)', () => {
    it('does not import from ../../src', () => {
        const root = path.resolve(__dirname, '../server');
        const hits: string[] = [];
        const re = /from\s+['"](?:\.\.\/)+src\//;
        for (const f of walk(root)) {
            const txt = fs.readFileSync(f, 'utf8');
            if (re.test(txt)) hits.push(path.relative(path.join(__dirname, '..'), f));
        }
        expect(hits).toEqual([]);
    });
});
