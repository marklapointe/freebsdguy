import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Config Path Resolution', () => {
    const originalPlatform = process.platform;
    const originalHome = os.homedir();

    beforeEach(() => {
        vi.resetModules();
        // Clear env vars that might interfere
        vi.stubEnv('CONFIG_DIR', '');
        vi.stubEnv('CONFIG_PATH', '');
        vi.stubEnv('USERS_PATH', '');
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        vi.unstubAllEnvs();
    });

    it('should use CONFIG_DIR if provided', async () => {
        vi.stubEnv('CONFIG_DIR', '/tmp/custom-config');
        const { configPath } = await import('../server/lib/config');
        expect(configPath()).toBe('/tmp/custom-config/config.json');
    });

    it('should prioritize /usr/local/etc/freebsdguy on FreeBSD if it exists', async () => {
        Object.defineProperty(process, 'platform', { value: 'freebsd' });
        
        // Mock fs.existsSync and fs.accessSync
        const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
            if (p === '/usr/local/etc/freebsdguy') return true;
            return false;
        });
        const accessSpy = vi.spyOn(fs, 'accessSync').mockImplementation(() => {});

        const { configPath } = await import('../server/lib/config');
        expect(configPath()).toBe('/usr/local/etc/freebsdguy/config.json');
        
        existsSpy.mockRestore();
        accessSpy.mockRestore();
    });

    it('should prioritize /etc/freebsdguy on Linux if it exists', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        
        const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
            if (p === '/etc/freebsdguy') return true;
            return false;
        });
        const accessSpy = vi.spyOn(fs, 'accessSync').mockImplementation(() => {});

        const { configPath } = await import('../server/lib/config');
        expect(configPath()).toBe('/etc/freebsdguy/config.json');
        
        existsSpy.mockRestore();
        accessSpy.mockRestore();
    });

    it('should use home directory fallback if system paths are not available', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const homeDir = os.homedir();
        const expectedPath = path.join(homeDir, '.local', 'etc', 'freebsdguy');

        const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
            if (p === expectedPath) return true;
            if (p === path.dirname(expectedPath)) return true;
            return false;
        });
        const accessSpy = vi.spyOn(fs, 'accessSync').mockImplementation(() => {});

        const { configPath } = await import('../server/lib/config');
        expect(configPath()).toBe(path.join(expectedPath, 'config.json'));
        
        existsSpy.mockRestore();
        accessSpy.mockRestore();
    });
});
