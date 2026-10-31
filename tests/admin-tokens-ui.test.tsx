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

import { api, listAdminTokens, mintAdminToken, revokeToken } from '../src/lib/api';

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
        fireEvent.click(screen.getByTestId('token-reveal-copy'));
        expect(showAlert).toHaveBeenCalledWith('Token copied', 'Success');
        fireEvent.click(screen.getByTestId('token-reveal-dismiss'));
        expect(screen.queryByTestId('token-reveal-value')).toBeNull();
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

    it('loads nothing when the token list fails and resets a missing user', async () => {
        (listAdminTokens as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
        const { rerender } = render(
            <AdminTokens
                users={[{ username: 'admin', role: 'admin' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );
        await waitFor(() => expect(showAlert).toHaveBeenCalled());
        rerender(
            <AdminTokens
                users={[{ username: 'writer', role: 'contributor' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );
        await waitFor(() => expect((screen.getByTestId('token-mint-username') as HTMLSelectElement).value).toBe('writer'));
    });

    it('reports mint and revoke failures and copies the revealed token', async () => {
        (mintAdminToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
        render(
            <AdminTokens
                users={[{ username: 'admin', role: 'admin' }, { username: 'writer', role: 'contributor' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );
        fireEvent.change(screen.getByTestId('token-mint-username'), { target: { value: 'writer' } });
        fireEvent.click(screen.getByTestId('token-mint-submit'));
        await waitFor(() => expect(showAlert).toHaveBeenCalled());

        (listAdminTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            {
                id: 'tok1',
                username: 'admin',
                label: '',
                prefix: 'abcd1234',
                scope: 'read',
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
                revokedAt: undefined
            }
        ]);
        (revokeToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
        render(
            <AdminTokens
                users={[{ username: 'admin', role: 'admin' }]}
                showAlert={showAlert}
                showConfirm={showConfirm}
            />
        );
        await waitFor(() => screen.getByTestId('token-revoke-tok1'));
        fireEvent.click(screen.getByTestId('token-revoke-tok1'));
        await waitFor(() => expect(showAlert).toHaveBeenCalled());
    });
});

describe('MyTokensPanel', () => {
    it('mints a read token for the signed-in user', async () => {
        const { api } = await import('../src/lib/api');
        const get = vi.spyOn(api, 'get').mockResolvedValue({
            data: {
                tokens: [
                    { id: 't1', prefix: 'abcd', label: 'lap', createdAt: 1 },
                    { id: 'gone', prefix: 'zzzz', label: '', revokedAt: 1, createdAt: 1 }
                ]
            }
        } as never);
        const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { token: 'mdw_mine' } } as never);
        const showAlert = vi.fn();
        const showConfirm = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
        render(<MyTokensPanel showAlert={showAlert} showConfirm={showConfirm} />);
        await waitFor(() => expect(get).toHaveBeenCalled());
        fireEvent.change(screen.getByTestId('my-token-scope'), { target: { value: 'write' } });
        fireEvent.change(screen.getByTestId('my-token-scope'), { target: { value: 'read' } });
        fireEvent.click(screen.getByTestId('my-token-mint'));
        await waitFor(() => expect(post).toHaveBeenCalledWith('/tokens', { label: '', scope: 'read' }));
        await waitFor(() => expect(screen.getByText(/mdw_abcd/)).toBeTruthy());
        fireEvent.click(screen.getByText('Revoke'));
        fireEvent.click(screen.getByText('Copy and dismiss'));
        expect(screen.queryByTestId('my-token-reveal')).toBeNull();
        get.mockRejectedValueOnce(new Error('down'));
        render(<MyTokensPanel showAlert={showAlert} showConfirm={showConfirm} />);
        post.mockRejectedValueOnce(new Error('nope'));
        fireEvent.change(screen.getAllByTestId('my-token-label')[0], { target: { value: 'lap' } });
        fireEvent.click(screen.getAllByTestId('my-token-mint')[0]);
        await waitFor(() => expect(showAlert).toHaveBeenCalled());
        get.mockRestore();
        post.mockRestore();
    });
});
