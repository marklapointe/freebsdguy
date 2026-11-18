/**
 * Argument parser for the token minting CLI. Scope is an explicit option.
 */
import { parseTokenScope, type TokenScope } from './token-scope.ts';
import { parseTtlDays } from './api-tokens.ts';

export interface MintTokenCliArgs {
    username: string;
    label: string;
    scope: TokenScope;
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
                'Usage: mint-token --username USER --scope read|write [--label TEXT] [--ttl-days N]'
            );
        }
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
        positionals.push(a);
    }
    if (positionals.length) {
        throw new Error('Refusing unexpected command line arguments');
    }
    if (!username) throw new Error('username is required (--username)');
    if (scopeRaw === undefined) throw new Error('Token scope is required (--scope read|write)');
    const scope = parseTokenScope(scopeRaw);
    const ttlDays = parseTtlDays(ttlRaw);
    return { username, label, scope, ttlDays };
}
