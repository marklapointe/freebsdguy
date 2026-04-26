import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { runPreflight } from '../server/lib/preflight.ts';
import * as config from '../server/lib/config.ts';

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs') as any;
    const mocked = {
        ...actual,
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn()
    };
    return {
        ...mocked,
        default: mocked
    };
});

vi.mock('../server/lib/config.ts', async () => {
    const actual = await vi.importActual('../server/lib/config.ts') as any;
    return {
        ...actual,
        loadConfig: vi.fn(),
        saveConfig: vi.fn(),
        loadUsers: vi.fn(),
        configPath: () => '/mock/config.json'
    };
});

describe('Preflight Check', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (config.loadConfig as any).mockReturnValue({
            postsDir: './posts',
            jwtSecret: 'test_secret'
        });
        (config.loadUsers as any).mockReturnValue({
            admin: { username: 'admin' },
            users: []
        });
        (fs.existsSync as any).mockReturnValue(true);
    });

    it('should pass when everything is correct', async () => {
        const issues = await runPreflight(false);
        expect(issues).toHaveLength(0);
    });

    it('should detect missing posts directory', async () => {
        (fs.existsSync as any).mockImplementation((path: string) => {
            if (path.includes('posts') && !path.includes('images')) return false;
            return true;
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
