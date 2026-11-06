// Track #1682 slice 1: a package upgrade must deliver fixed shipped themes to the runtime
// themeDir when the runtime copy is the unmodified old shipped file, but never clobber edits.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { ensureRuntimeThemeCatalog } from '../server/lib/themes';

const old110 = (id: string) => execSync(`git show v1.1.0:server/themes/${id}.json`, { encoding: 'utf8' });
const shipped = (id: string) => fs.readFileSync(path.resolve('server/themes', `${id}.json`), 'utf8');

describe('ensureRuntimeThemeCatalog on upgrade', () => {
    it('replaces an unmodified 1.1.0 dark.json with the shipped (fixed) one', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-themes-'));
        fs.writeFileSync(path.join(dir, 'dark.json'), old110('dark'));
        fs.writeFileSync(path.join(dir, 'light.json'), old110('light'));
        const r = ensureRuntimeThemeCatalog(dir);
        expect(fs.readFileSync(path.join(dir, 'dark.json'), 'utf8')).toBe(shipped('dark'));
        expect(fs.readFileSync(path.join(dir, 'light.json'), 'utf8')).toBe(shipped('light'));
        expect(r.refreshed).toEqual(expect.arrayContaining(['dark', 'light']));
        fs.rmSync(dir, { recursive: true, force: true });
    });
    it('leaves an admin-edited theme alone', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-themes-'));
        const edited = old110('dark').replace('#3a297a', '#ff00ff');
        fs.writeFileSync(path.join(dir, 'dark.json'), edited);
        ensureRuntimeThemeCatalog(dir);
        expect(fs.readFileSync(path.join(dir, 'dark.json'), 'utf8')).toBe(edited);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
