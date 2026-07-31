/**
 * Cover interactive preflight, fixIssue paths, absolute postsDir, images-only missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { generateSecret, runPreflight } from '../server/lib/preflight.ts';
import * as config from '../server/lib/config.ts';

const prompt = vi.fn();

vi.mock('enquirer', () => ({
    default: {
        prompt: (...a: unknown[]) => prompt(...a)
    }
}));

vi.mock('../server/lib/config.ts', async () => {
    const actual = (await vi.importActual('../server/lib/config.ts')) as any;
    return {
        ...actual,
        loadConfig: vi.fn(),
        saveConfig: vi.fn(),
        loadUsers: vi.fn(),
        configPath: () => '/mock/config.json'
    };
});

describe('Preflight interactive + fixIssue', () => {
    const origEnv = process.env.NODE_ENV;
    const origVitest = process.env.VITEST;
    let existsSpy: ReturnType<typeof vi.spyOn>;
    let mkdirSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        process.env.VITEST = '1';
        existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'test-secret-at-least-16-chars'
        });
        (config.loadUsers as any).mockReturnValue({
            admin: { username: 'admin' },
            users: []
        });
        prompt.mockResolvedValue({ fix: true });
    });

    afterEach(() => {
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
        process.env.NODE_ENV = origEnv;
        if (origVitest === undefined) delete process.env.VITEST;
        else process.env.VITEST = origVitest;
    });

    it('generateSecret returns hex string', () => {
        const s = generateSecret();
        expect(s).toMatch(/^[0-9a-f]{64}$/);
    });

    it('interactive: reports DIR_POSTS_MISSING and fixes with mkdir', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('posts') && !s.includes('images')) return false;
            return true;
        });
        const issues = await runPreflight(true);
        expect(issues.some(i => i.id === 'DIR_POSTS_MISSING')).toBe(true);
        expect(prompt).toHaveBeenCalled();
        expect(mkdirSpy).toHaveBeenCalled();
        expect(issues.find(i => i.id === 'DIR_POSTS_MISSING')?.fixed).toBe(true);
    });

    it('interactive: images dir missing when posts exists', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('images')) return false;
            return true;
        });
        const issues = await runPreflight(true);
        expect(issues.some(i => i.id === 'DIR_IMAGES_MISSING')).toBe(true);
        expect(issues.find(i => i.id === 'DIR_IMAGES_MISSING')?.fixed).toBe(true);
    });

    it('non-interactive: images mkdir failure', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('images')) return false;
            if (s.includes('posts')) return true;
            return true;
        });
        mkdirSpy.mockImplementation(() => {
            throw new Error('EACCES');
        });
        const issues = await runPreflight(false);
        expect(issues.some(i => i.id === 'DIR_IMAGES_MISSING' && i.fixable === false)).toBe(true);
    });

    it('images missing when posts also missing (else branch)', async () => {
        existsSpy.mockReturnValue(false);
        mkdirSpy.mockImplementation(() => {
            throw new Error('fail');
        });
        const issues = await runPreflight(false);
        expect(issues.some(i => i.id === 'DIR_IMAGES_MISSING')).toBe(true);
    });

    it('interactive declines fix', async () => {
        prompt.mockResolvedValue({ fix: false });
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'short'
        });
        process.env.NODE_ENV = 'development';
        const issues = await runPreflight(true);
        expect(issues.some(i => i.id === 'JWT_SECRET_DEFAULT')).toBe(true);
        expect(config.saveConfig).not.toHaveBeenCalled();
    });

    it('interactive fixes JWT_SECRET_DEFAULT', async () => {
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'freebsd_guy_secret_key'
        });
        process.env.NODE_ENV = 'development';
        const issues = await runPreflight(true);
        const jwt = issues.find(i => i.id === 'JWT_SECRET_DEFAULT');
        expect(jwt).toBeDefined();
        expect(jwt?.fixed).toBe(true);
        expect(config.saveConfig).toHaveBeenCalled();
    });

    it('absolute postsDir path', async () => {
        (config.loadConfig as any).mockReturnValue({
            postsDir: '/abs/posts',
            jwtSecret: 'test-secret-at-least-16-chars'
        });
        existsSpy.mockImplementation((p: fs.PathLike) => !String(p).includes('/abs/posts'));
        await runPreflight(false);
        expect(mkdirSpy).toHaveBeenCalledWith('/abs/posts', { recursive: true });
    });

    it('fixIssue failure returns false (mkdir throws in interactive fix)', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('posts') && !s.includes('images')) return false;
            return true;
        });
        mkdirSpy.mockImplementation(() => {
            throw new Error('boom');
        });
        const issues = await runPreflight(true);
        expect(issues.some(i => i.id === 'DIR_POSTS_MISSING')).toBe(true);
    });

    it('logs when VITEST unset (pass path)', async () => {
        delete process.env.VITEST;
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const issues = await runPreflight(false);
        expect(issues).toHaveLength(0);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Pre-flight check passed'));
        log.mockRestore();
        process.env.VITEST = '1';
    });

    it('logs issues when VITEST unset', async () => {
        delete process.env.VITEST;
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        (config.loadUsers as any).mockReturnValue({ users: [] });
        await runPreflight(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'));
        log.mockRestore();
        process.env.VITEST = '1';
    });
});
