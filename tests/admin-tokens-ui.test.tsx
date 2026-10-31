/**
 * Admin Tokens UI — generate / reveal / revoke.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { AdminTokens, MyTokensPanel } from '../src/components/admin/AdminTokens';

vi.mock('../src/lib/api', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
    return {
        ...actual,
        listAdminTokens: vi.fn(),
        mintAdminToken: vi.fn(),
        revokeToken: vi.fn()
    };
});

import { listAdminTokens, mintAdminToken, revokeToken } from '../src/lib/api';

describe('AdminTokens', () => {
    const showAlert = vi.fn();
    const showConfirm = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());

    beforeEach(() => {
        vi.clearAllMocks();
        (listAdminTokens as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (mintAdminToken as ReturnType<typeof vi.fn>).mockResolvedValue({
            token: 'mdw_secrettokenvalue123',
            id: 'abc',
            prefix: 'secretto',
            label: 'cursor',
            username: 'admin',
            createdAt: Date.now()
        });
        (revokeToken as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('renders and mints with one-time reveal', async () => {
        render(
            <AdminTokens
                users={[{ username: 'admin', role: 'admin' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );

        await waitFor(() => expect(listAdminTokens).toHaveBeenCalled());
        expect(screen.getByTestId('tokens-settings-heading')).toBeTruthy();

        fireEvent.change(screen.getByTestId('token-mint-label'), {
            target: { value: 'cursor' }
        });
        fireEvent.change(screen.getByTestId('token-mint-scope'), { target: { value: 'read' } });
        fireEvent.change(screen.getByTestId('token-mint-scope'), { target: { value: 'write' } });
        fireEvent.click(screen.getByTestId('token-mint-submit'));

        await waitFor(() => expect(mintAdminToken).toHaveBeenCalledWith('admin', 'cursor', 'write'));
        await waitFor(() =>
            expect(screen.getByTestId('token-reveal-value').textContent).toContain('mdw_')
        );
    });

    it('revokes from table', async () => {
        (listAdminTokens as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'tok1',
                username: 'admin',
                label: 'x',
                prefix: 'abcd1234',
                createdAt: Date.now()
            }
        ]);

        render(
            <AdminTokens
                users={[{ username: 'admin', role: 'admin' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );

        await waitFor(() => screen.getByTestId('token-revoke-tok1'));
        fireEvent.click(screen.getByTestId('token-revoke-tok1'));
        await waitFor(() => expect(revokeToken).toHaveBeenCalledWith('tok1'));
    });
});

describe('MyTokensPanel', () => {
    it('mints a read token for the signed-in user', async () => {
        const { api } = await import('../src/lib/api');
        const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { tokens: [] } } as never);
        const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { token: 'mdw_mine' } } as never);
        const showAlert = vi.fn();
        const showConfirm = vi.fn();
        render(<MyTokensPanel showAlert={showAlert} showConfirm={showConfirm} />);
        await waitFor(() => expect(get).toHaveBeenCalled());
        fireEvent.change(screen.getByTestId('my-token-scope'), { target: { value: 'write' } });
        fireEvent.change(screen.getByTestId('my-token-scope'), { target: { value: 'read' } });
        fireEvent.click(screen.getByTestId('my-token-mint'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/tokens', { label: '', scope: 'read' }));
        get.mockRestore();
        post.mockRestore();
    });
});
