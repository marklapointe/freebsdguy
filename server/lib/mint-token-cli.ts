/**
 * Argument parser for the token minting CLI. Scope is an explicit option.
 */
import { ALLOWED_SCOPE_NAMES, parseTokenScopes, type TokenScopes } from './token-scope.ts';
import { parseTtlDays } from './api-tokens.ts';

/**
 * The scope names the parser accepts, in the order the refusal message lists
 * them. The usage line and the "scope is required" refusal are both built from
 * this list, so a user who reads either of them learns that "write" (the legacy
 * name for every scope) is accepted.
 */
function acceptedScopeNames(): string[] {
    return ALLOWED_SCOPE_NAMES.split(',').map((name) => name.trim()).filter(Boolean);
}

/** The accepted scope names, joined for a message. */
function scopeList(separator = '|'): string {
    return acceptedScopeNames().join(separator);
}

export interface MintTokenCliArgs {
    username: string;
    label: string;
    /** The scopes the token holds. */
    scope: TokenScopes;
    /** Lifetime in days. Undefined = the token never expires. */
    ttlDays?: number;
}

export function parseMintTokenArgs(argv: string[]): MintTokenCliArgs {
    const args = argv.slice(2);
    let username = '';
    let label = '';
    let scopeRaw: string | undefined;
    let ttlRaw: string | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--username') {
            username = args[++i] || '';
            continue;
        }
        if (a.startsWith('--username=')) {
            username = a.slice('--username='.length);
            continue;
        }
        if (a === '--label') {
            label = args[++i] || '';
            continue;
        }
        if (a.startsWith('--label=')) {
            label = a.slice('--label='.length);
            continue;
        }
        if (a === '--scope') {
            scopeRaw = args[++i];
            continue;
        }
        if (a.startsWith('--scope=')) {
            scopeRaw = a.slice('--scope='.length);
            continue;
        }
        if (a === '--ttl-days') {
            const value = args[++i];
            if (value === undefined) throw new Error('ttl-days is required (--ttl-days N)');
            ttlRaw = value;
            continue;
        }
        if (a.startsWith('--ttl-days=')) {
            ttlRaw = a.slice('--ttl-days='.length);
            continue;
        }
        if (a === '--help' || a === '-h') {
            throw new Error(
                `Usage: mint-token --username USER --scope ${scopeList()} [--label TEXT] [--ttl-days N]`
            );
        }
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
        positionals.push(a);
    }
    if (positionals.length) {
        throw new Error('Refusing unexpected command line arguments');
    }
    if (!username) throw new Error('username is required (--username)');
    if (scopeRaw === undefined) {
        throw new Error(`Token scope is required (--scope ${scopeList()})`);
    }
    const scope = parseTokenScopes(scopeRaw);
    const ttlDays = parseTtlDays(ttlRaw);
    return { username, label, scope, ttlDays };
}
