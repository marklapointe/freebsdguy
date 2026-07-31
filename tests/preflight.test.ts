import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { runPreflight } from '../server/lib/preflight.ts';
import * as config from '../server/lib/config.ts';

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

describe('Preflight Check', () => {
    let existsSpy: ReturnType<typeof vi.spyOn>;
    let mkdirSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'test-secret-at-least-16'
        });
        (config.loadUsers as any).mockReturnValue({
            admin: { username: 'admin' },
            users: []
        });
    });

    afterEach(() => {
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
    });

    it('should pass when everything is correct', async () => {
        const issues = await runPreflight(false);
        expect(issues).toHaveLength(0);
    });

    it('auto-creates missing posts directory in non-interactive mode', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            if (String(p).includes('posts') && !String(p).includes('images')) return false;
            return true;
        });

        const issues = await runPreflight(false);
        expect(mkdirSpy).toHaveBeenCalled();
        expect(issues.some(i => i.id === 'DIR_POSTS_MISSING')).toBe(false);
    });

    it('reports DIR_POSTS_MISSING when auto-create fails', async () => {
        existsSpy.mockImplementation((p: fs.PathLike) => {
            if (String(p).includes('posts') && !String(p).includes('images')) return false;
            return true;
        });
        mkdirSpy.mockImplementation(() => {
            throw new Error('EACCES');
        });

        const issues = await runPreflight(false);
        expect(issues.some(i => i.id === 'DIR_POSTS_MISSING')).toBe(true);
    });

    it('should detect default JWT secret in production', async () => {
        process.env.NODE_ENV = 'production';
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'freebsd_guy_secret_key'
        });

        const issues = await runPreflight(false);
        const jwtIssue = issues.find(i => i.id === 'JWT_SECRET_DEFAULT');
        expect(jwtIssue).toBeDefined();
        expect(jwtIssue?.critical).toBe(true);

        process.env.NODE_ENV = 'test';
    });

    it('should detect missing admin user', async () => {
        (config.loadUsers as any).mockReturnValue({
            users: []
        });

        const issues = await runPreflight(false);
        expect(issues.some(i => i.id === 'ADMIN_USER_MISSING')).toBe(true);
    });
});
