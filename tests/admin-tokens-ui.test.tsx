/**
 * Admin Tokens UI — generate / reveal / revoke.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { AdminTokens } from '../src/components/admin/AdminTokens';

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
        fireEvent.click(screen.getByTestId('token-mint-submit'));

        await waitFor(() => expect(mintAdminToken).toHaveBeenCalledWith('admin', 'cursor'));
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
