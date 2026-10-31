/**
 * Admin Tokens pane — mint / list / revoke PATs; one-time reveal.
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Copy, Trash2 } from 'lucide-react';
import {
    api,
    listAdminTokens,
    mintAdminToken,
    revokeToken,
    type TokenPublic
} from '../../lib/api';
import { axiosErrorMessage } from '../../lib/errors';

export type AdminTokensProps = {
    users: { username: string; role: string }[];
    showAlert: (msg: string, title?: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, title?: string) => void;
};

function mcpSnippet(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    return `URL: ${origin}/mcp\nAuthorization: Bearer ${token}`;
}

export const AdminTokens = ({ users, showAlert, showConfirm }: AdminTokensProps) => {
    const [tokens, setTokens] = useState<TokenPublic[]>([]);
    const [username, setUsername] = useState(users[0]?.username || 'admin');
    const [label, setLabel] = useState('');
    const [scope, setScope] = useState<'read' | 'write'>('write');
    const [revealed, setRevealed] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(() => {
        listAdminTokens()
            .then(setTokens)
            .catch((err: unknown) => showAlert(axiosErrorMessage(err, 'Failed to load tokens'), 'Error'));
    }, [showAlert]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (users.length && !users.find((u) => u.username === username)) {
            setUsername(users[0].username);
        }
    }, [users, username]);

    const handleGenerate = () => {
        setLoading(true);
        mintAdminToken(username, label, scope)
            .then((res) => {
                setRevealed(res.token);
                setLabel('');
                refresh();
            })
            .catch((err: unknown) => showAlert(axiosErrorMessage(err, 'Failed to mint token'), 'Error'))
            .finally(() => setLoading(false));
    };

    const handleRevoke = (id: string) => {
        showConfirm(
            'Revoke this token? MCP clients using it will stop working immediately.',
            () => {
                revokeToken(id)
                    .then(() => {
                        refresh();
                        showAlert('Token revoked', 'Success');
                    })
                    .catch((err: unknown) =>
                        showAlert(axiosErrorMessage(err, 'Failed to revoke'), 'Error')
                    );
            },
            'Revoke token'
        );
    };

    return (
        <div data-testid="admin-tokens-panel">
            <h1 className="text-3xl font-bold mb-6" data-testid="tokens-settings-heading">
                API Tokens
            </h1>
            <p className="mb-6 opacity-70 text-sm max-w-2xl">
                Personal access tokens authenticate MCP clients and REST with the owning user&apos;s
                rights. The secret is shown once at creation — store it outside the model.
            </p>

            <div className="bg-secondary rounded-lg p-6 mb-6 space-y-4" data-testid="token-mint-panel">
                <h2 className="font-bold flex items-center gap-2">
                    <KeyRound size={18} /> Generate token
                </h2>
                <div className="grid sm:grid-cols-4 gap-3">
                    <select
                        data-testid="token-mint-username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="p-3 bg-bg border border-accent rounded text-text"
                    >
                        {users.map((u) => (
                            <option key={u.username} value={u.username}>
                                {u.username} ({u.role})
                            </option>
                        ))}
                    </select>
                    <input
                        data-testid="token-mint-label"
                        type="text"
                        placeholder="Label (e.g. cursor laptop)"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        className="p-3 bg-bg border border-accent rounded text-text sm:col-span-1"
                    />
                    <select
                        data-testid="token-mint-scope"
                        value={scope}
                        onChange={(e) => setScope(e.target.value === 'read' ? 'read' : 'write')}
                        className="p-3 bg-bg border border-accent rounded text-text"
                    >
                        <option value="write">write</option>
                        <option value="read">read</option>
                    </select>
                    <button
                        type="button"
                        data-testid="token-mint-submit"
                        disabled={loading || !username}
                        onClick={handleGenerate}
                        className="bg-accent text-on-accent px-4 py-2 rounded font-bold disabled:opacity-50"
                    >
                        Generate
                    </button>
                </div>
            </div>

            {revealed && (
                <div
                    className="bg-secondary rounded-lg p-6 mb-6 border border-accent space-y-3"
                    data-testid="token-reveal-modal"
                >
                    <h2 className="font-bold text-lg">Copy this token now</h2>
                    <p className="text-sm opacity-70">It will not be shown again.</p>
                    <code
                        data-testid="token-reveal-value"
                        className="block p-3 bg-bg rounded break-all text-sm select-all"
                    >
                        {revealed}
                    </code>
                    <pre className="p-3 bg-bg rounded text-xs overflow-x-auto opacity-80 whitespace-pre-wrap">
                        {mcpSnippet(revealed)}
                    </pre>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            data-testid="token-reveal-copy"
                            className="flex items-center gap-2 bg-accent text-on-accent px-4 py-2 rounded font-bold"
                            onClick={() => {
                                void navigator.clipboard?.writeText(revealed);
                                showAlert('Token copied', 'Success');
                            }}
                        >
                            <Copy size={16} /> Copy token
                        </button>
                        <button
                            type="button"
                            data-testid="token-reveal-dismiss"
                            className="px-4 py-2 rounded border border-accent"
                            onClick={() => setRevealed(null)}
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-secondary rounded-lg p-6 overflow-x-auto">
                <table className="w-full" data-testid="tokens-table">
                    <thead>
                        <tr className="text-left border-b border-accent">
                            <th className="pb-3">Prefix</th>
                            <th className="pb-3">Label</th>
                            <th className="pb-3">User</th>
                            <th className="pb-3">Scope</th>
                            <th className="pb-3">Created</th>
                            <th className="pb-3">Last used</th>
                            <th className="pb-3">Status</th>
                            <th className="pb-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tokens.map((t) => (
                            <tr key={t.id} className="border-b border-accent border-opacity-20">
                                <td className="py-3 font-mono text-sm">mdw_{t.prefix}…</td>
                                <td className="py-3">{t.label || '—'}</td>
                                <td className="py-3">{t.username}</td>
                                <td className="py-3 text-sm">{t.scope || 'write'}</td>
                                <td className="py-3 text-sm opacity-70">
                                    {new Date(t.createdAt).toLocaleString()}
                                </td>
                                <td className="py-3 text-sm opacity-70">
                                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}
                                </td>
                                <td className="py-3 text-sm">{t.revokedAt ? 'Revoked' : 'Active'}</td>
                                <td className="py-3">
                                    {!t.revokedAt && (
                                        <button
                                            type="button"
                                            data-testid={`token-revoke-${t.id}`}
                                            onClick={() => handleRevoke(t.id)}
                                            className="text-red-500 hover:underline flex items-center gap-1"
                                        >
                                            <Trash2 size={14} /> Revoke
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {tokens.length === 0 && (
                            <tr>
                                <td colSpan={8} className="py-6 opacity-50 text-center">
                                    No tokens yet
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

/** Slim panel for contributors (own tokens only). */
export const MyTokensPanel = ({
    showAlert,
    showConfirm
}: {
    showAlert: (msg: string, title?: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, title?: string) => void;
}) => {
    const [tokens, setTokens] = useState<TokenPublic[]>([]);
    const [label, setLabel] = useState('');
    const [scope, setScope] = useState<'read' | 'write'>('read');
    const [revealed, setRevealed] = useState<string | null>(null);

    const refresh = useCallback(() => {
        api
            .get('/tokens')
            .then((res) => setTokens(Array.isArray(res.data?.tokens) ? res.data.tokens : []))
            .catch(() => setTokens([]));
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return (
        <div className="mt-8 bg-secondary rounded-lg p-6 space-y-4" data-testid="my-tokens-panel">
            <h2 className="font-bold flex items-center gap-2">
                <KeyRound size={18} /> My API tokens
            </h2>
            <p className="text-sm opacity-60">
                Use a token with MCP at <code className="opacity-80">/mcp</code> (Bearer). Shown once
                when created.
            </p>
            <div className="flex flex-wrap gap-2">
                <input
                    data-testid="my-token-label"
                    type="text"
                    placeholder="Label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="p-2 bg-bg border border-accent rounded text-text flex-1 min-w-[12rem]"
                />
                <select
                    data-testid="my-token-scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value === 'write' ? 'write' : 'read')}
                    className="p-2 bg-bg border border-accent rounded text-text"
                >
                    <option value="read">read</option>
                    <option value="write">write</option>
                </select>
                <button
                    type="button"
                    data-testid="my-token-mint"
                    className="bg-accent text-on-accent px-4 py-2 rounded font-bold"
                    onClick={() => {
                        api
                            .post('/tokens', { label, scope })
                            .then((res) => {
                                setRevealed(res.data?.token);
                                setLabel('');
                                refresh();
                            })
                            .catch((err: unknown) =>
                                showAlert(axiosErrorMessage(err, 'Failed to mint'), 'Error')
                            );
                    }}
                >
                    Generate
                </button>
            </div>
            {revealed && (
                <div data-testid="my-token-reveal" className="space-y-2">
                    <code className="block p-2 bg-bg rounded break-all text-sm">{revealed}</code>
                    <button
                        type="button"
                        className="text-sm underline"
                        onClick={() => {
                            void navigator.clipboard?.writeText(revealed);
                            setRevealed(null);
                        }}
                    >
                        Copy and dismiss
                    </button>
                </div>
            )}
            <ul className="text-sm space-y-1">
                {tokens
                    .filter((t) => !t.revokedAt)
                    .map((t) => (
                        <li key={t.id} className="flex justify-between gap-2">
                            <span>
                                mdw_{t.prefix}… {t.label && `(${t.label})`}
                            </span>
                            <button
                                type="button"
                                className="text-red-500"
                                onClick={() =>
                                    showConfirm('Revoke this token?', () => {
                                        revokeToken(t.id).then(refresh);
                                    })
                                }
                            >
                                Revoke
                            </button>
                        </li>
                    ))}
            </ul>
        </div>
    );
};
