/**
 * Passwordless MCP-only agent accounts, and the CLI that creates one.
 *
 * An agent account (Track #2119 U7) exists for one personal access token: it
 * has no password, it can never log in on the web, and the token is the only
 * way in. The rules that make that safe:
 *   - there is no --password option, so no secret can ever reach argv;
 *   - the token is printed on stdout and nothing else, so it can be piped
 *     straight into a secret store;
 *   - stdout must not be a terminal, because a token in the scrollback is a
 *     token in the shell history;
 *   - admin and moderate are refused: an agent may write content, never
 *     administer the site;
 *   - the account is written before the token is minted and taken away again
 *     when the minting fails, so nothing half-made is left behind;
 *   - the users file is read, never created and never quarantined: a missing
 *     or broken users.json is a refusal, not a seeded default admin.
 */
import fs from 'fs';
import { sanitizeUsers, saveUsers, usersPath, type UsersConfig } from './config.ts';
import { mintToken, parseTtlDays } from './api-tokens.ts';
import { parseTokenScopes, type TokenScopes } from './token-scope.ts';

/** The scopes an agent account may hold. */
export const AGENT_SCOPE_NAMES = 'read, content:write, publish';

/** The scopes an agent account may never hold. */
export const FORBIDDEN_AGENT_SCOPES: readonly string[] = ['admin', 'moderate'];

/** The name an agent account may have. */
export const AGENT_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export interface AgentUserCliArgs {
    username: string;
    label: string;
    /** The scopes the token holds. */
    scope: TokenScopes;
    /** Lifetime in days. Undefined = the token never expires. */
    ttlDays?: number;
}

/**
 * Parse the command line of create-agent-user.
 *
 * `argv` holds the arguments after the script name (process.argv.slice(2)).
 * The parser is pure: it reads nothing and writes nothing, so the refusals can
 * be tested without a process and without a file.
 */
export function parseAgentUserArgs(argv: string[]): AgentUserCliArgs {
    const args = Array.isArray(argv) ? argv.slice() : [];
    let username = '';
    let label = '';
    let scopeRaw: string | undefined;
    let ttlRaw: string | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        // There is no password for an agent account, so the option does not exist.
        if (a === '--password' || a.startsWith('--password=')) {
            throw new Error('Refusing --password: an agent account has no password');
        }
        if (a === '--username') {
            username = args[++i] || '';
            continue;
        }
        if (a.startsWith('--username=')) {
            username = a.slice('--username='.length);
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
        if (a === '--label') {
            label = args[++i] || '';
            continue;
        }
        if (a.startsWith('--label=')) {
            label = a.slice('--label='.length);
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
                `Usage: create-agent-user --username NAME --scope ${AGENT_SCOPE_NAMES} [--label TEXT] [--ttl-days N]`
            );
        }
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
        positionals.push(a);
    }
    if (positionals.length) {
        throw new Error('Refusing unexpected command line arguments');
    }
    if (!username) throw new Error('username is required (--username)');
    if (!AGENT_USERNAME_RE.test(username)) {
        throw new Error(
            `Invalid username ${JSON.stringify(username)}; use ${AGENT_USERNAME_RE.source}`
        );
    }
    if (scopeRaw === undefined) {
        throw new Error(`Token scope is required (--scope ${AGENT_SCOPE_NAMES})`);
    }
    const scope = parseTokenScopes(scopeRaw);
    // The legacy "write" expands to every scope, admin included, so it is caught here.
    const forbidden = scope.filter((s) => FORBIDDEN_AGENT_SCOPES.includes(s));
    if (forbidden.length) {
        throw new Error(
            `Refusing scope ${forbidden.join(',')}: an agent account must not hold admin or moderate`
        );
    }
    const ttlDays = parseTtlDays(ttlRaw);
    return { username, label, scope, ttlDays };
}

/** The token minting the CLI needs; the tests inject a failing one. */
export type AgentTokenMinter = (
    username: string,
    label?: string,
    scope?: unknown,
    opts?: { ttlDays?: number }
) => { plaintext: string; record: { id: string; prefix: string; scope: string; scopes?: readonly string[] } };

export interface CreateAgentUserOptions {
    /** The arguments after the script name. */
    argv: string[];
    /** Where the token goes: exactly one line, nothing else. */
    stdout: (chunk: string) => void;
    /** Where everything else goes. */
    stderr: (chunk: string) => void;
    /** True when stdout is a terminal: the token is then never printed. */
    isTTY: boolean;
    /** The minting call (defaults to the real one). */
    mint?: AgentTokenMinter;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Why the users file cannot be used. Nothing is written when this happens. */
export class UsersFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsersFileError';
    }
}

/**
 * Read the users file without touching it.
 *
 * loadUsers() would create a default admin on disk when the file is missing and
 * quarantine it when it is corrupt. A CLI that only adds one account must do
 * neither: it would seed an admin nobody asked for, or replace a real users
 * file with a locked one. So the file is read, parsed and sanitized here, and
 * anything that is not a usable users file is a refusal.
 */
function readUsersFile(file: string): UsersConfig {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        throw new UsersFileError(
            `Refusing: cannot read ${file} (${messageOf(err)}). The file is never created for you.`
        );
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new UsersFileError(
            `Refusing: ${file} is not valid JSON (${messageOf(err)}). Repair it before adding an account.`
        );
    }
    const { users, warnings } = sanitizeUsers(parsed);
    if (warnings.some((w) => /root invalid/i.test(w))) {
        throw new UsersFileError(
            `Refusing: ${file} has no usable root. Repair it before adding an account.`
        );
    }
    if (warnings.some((w) => /admin block missing/i.test(w))) {
        throw new UsersFileError(
            `Refusing: ${file} has no admin block. Repair it before adding an account.`
        );
    }
    return users;
}

/** Whether the name is already taken by any account, the admin one included. */
function accountExists(users: UsersConfig, username: string): boolean {
    if (users.admin?.username === username) return true;
    return users.users.some((u) => u.username === username);
}

/**
 * Create the agent account, mint its token and print the token.
 * Returns the exit code: 0 when the token was printed, 1 on every refusal.
 */
export function runCreateAgentUser(opts: CreateAgentUserOptions): number {
    const { stdout, stderr, isTTY } = opts;

    let args: AgentUserCliArgs;
    try {
        args = parseAgentUserArgs(opts.argv);
    } catch (err) {
        stderr(`${messageOf(err)}\n`);
        return 1;
    }

    // A token on a terminal ends up in the scrollback and in the shell history.
    // Nothing is written at all when stdout is a terminal.
    if (isTTY) {
        stderr(
            'Refusing to print the token to a terminal. Pipe stdout into a secret store.\n'
        );
        return 1;
    }

    const file = usersPath();
    let users: UsersConfig;
    try {
        users = readUsersFile(file);
    } catch (err) {
        stderr(`${messageOf(err)}\n`);
        stderr('Nothing was written.\n');
        return 1;
    }
    if (accountExists(users, args.username)) {
        stderr(`Refusing: the account ${args.username} already exists.\n`);
        return 1;
    }

    // The account is written first (atomic), so the minting can find it.
    const withAgent: UsersConfig = {
        admin: users.admin,
        users: [
            ...users.users,
            { username: args.username, passwordHash: '', role: 'contributor', mcpOnly: true }
        ]
    };
    saveUsers(withAgent, file);

    let minted: ReturnType<AgentTokenMinter>;
    try {
        minted = (opts.mint || mintToken)(args.username, args.label, args.scope, {
            ttlDays: args.ttlDays
        });
    } catch (err) {
        // Nothing half-made is left behind: the account goes away with the token.
        try {
            saveUsers({ admin: users.admin, users: users.users }, file);
        } catch {
            stderr('[WARN] The account could not be removed again; check users.json.\n');
        }
        stderr(`Failed to mint the token: ${messageOf(err)}\n`);
        stderr('No account was left behind.\n');
        return 1;
    }

    // stdout carries the token and nothing else.
    stdout(`${minted.plaintext}\n`);
    stderr(
        `id=${minted.record.id} prefix=${minted.record.prefix} scope=${minted.record.scope} ` +
            `scopes=${[...(minted.record.scopes || [])].join(',')} user=${args.username}\n`
    );
    return 0;
}
