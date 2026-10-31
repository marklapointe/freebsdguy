/**
 * Client helpers for personal access tokens.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, applyTheme, getPublicConfig, listAdminTokens, listMyTokens, mintAdminToken, mintMyToken, revokeToken } from '../src/lib/api';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('token client helpers', () => {
    it('lists, mints, and revokes through the API client', async () => {
        const get = vi.spyOn(api, 'get');
        const post = vi.spyOn(api, 'post');
        const del = vi.spyOn(api, 'delete');
        get.mockResolvedValueOnce({ data: { tokens: [{ id: '1' }] } } as never);
        expect(await listMyTokens()).toEqual([{ id: '1' }]);
        get.mockResolvedValueOnce({ data: {} } as never);
        expect(await listMyTokens()).toEqual([]);
        get.mockResolvedValueOnce({ data: { tokens: [] } } as never);
        expect(await listAdminTokens()).toEqual([]);
        get.mockResolvedValueOnce({ data: { tokens: [{ id: '2' }] } } as never);
        expect(await listAdminTokens('ada')).toEqual([{ id: '2' }]);
        post.mockResolvedValueOnce({ data: { token: 'mdw_a', id: 'a' } } as never);
        expect(await mintMyToken('laptop')).toMatchObject({ token: 'mdw_a' });
        expect(post).toHaveBeenCalledWith('/tokens', { label: 'laptop', scope: 'read' });
        post.mockResolvedValueOnce({ data: { token: 'mdw_b', id: 'b' } } as never);
        expect(await mintAdminToken('ada', 'box', 'write')).toMatchObject({ token: 'mdw_b' });
        del.mockResolvedValueOnce({} as never);
        await revokeToken('a/b');
        expect(del).toHaveBeenCalledWith('/tokens/a%2Fb');
        get.mockRejectedValueOnce(new Error('no config'));
        await expect(getPublicConfig(true)).rejects.toThrow(/no config/);
        get.mockRejectedValueOnce(new Error('no theme'));
        await expect(applyTheme(undefined as unknown as string)).resolves.toBeNull();
    });
});
