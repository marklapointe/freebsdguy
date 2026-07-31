import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureDirectories } from '../server/scripts/setup.ts';
import { generateSecret } from '../server/lib/preflight.ts';
import fs from 'fs';
import enquirer from 'enquirer';

vi.mock('enquirer', () => ({
    default: {
        prompt: vi.fn()
    }
}));

describe('Setup Logic', () => {
    let existsSpy: ReturnType<typeof vi.spyOn>;
    let mkdirSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        existsSpy = vi.spyOn(fs, 'existsSync');
        mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
        vi.mocked(enquirer.prompt).mockReset();
    });

    afterEach(() => {
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
    });

    it('generateSecret should return a 64-character hex string', () => {
        const secret = generateSecret();
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('ensureDirectories should prompt to create missing directories', async () => {
        existsSpy.mockReturnValue(false);
        vi.mocked(enquirer.prompt).mockResolvedValue({ create: true });

        await ensureDirectories();

        expect(existsSpy).toHaveBeenCalled();
        expect(enquirer.prompt).toHaveBeenCalled();
        expect(mkdirSpy).toHaveBeenCalled();
    });

    it('ensureDirectories should not prompt if directories exist', async () => {
        existsSpy.mockReturnValue(true);

        await ensureDirectories();

        expect(enquirer.prompt).not.toHaveBeenCalled();
        expect(mkdirSpy).not.toHaveBeenCalled();
    });
});
