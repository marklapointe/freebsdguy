import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureDirectories } from '../server/scripts/setup.ts';
import { generateSecret } from '../server/lib/preflight.ts';
import fs from 'fs';
import path from 'path';
import enquirer from 'enquirer';

vi.mock('enquirer', () => ({
    default: {
        prompt: vi.fn()
    }
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs') as any;
    const mocked = {
        ...actual,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        existsSync: vi.fn()
    };
    return {
        ...mocked,
        default: mocked
    };
});

describe('Setup Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generateSecret should return a 64-character hex string', () => {
        const secret = generateSecret();
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('ensureDirectories should prompt to create missing directories', async () => {
        // Mock fs.existsSync to return false for everything
        vi.mocked(fs.existsSync).mockReturnValue(false);
        // Mock enquirer to always say "yes"
        vi.mocked(enquirer.prompt).mockResolvedValue({ create: true });

        await ensureDirectories();

        // Should check for config, posts, and images directories
        expect(fs.existsSync).toHaveBeenCalled();
        expect(enquirer.prompt).toHaveBeenCalled();
        expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('ensureDirectories should not prompt if directories exist', async () => {
        // Mock fs.existsSync to return true
        vi.mocked(fs.existsSync).mockReturnValue(true);

        await ensureDirectories();

        expect(enquirer.prompt).not.toHaveBeenCalled();
        expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
});
