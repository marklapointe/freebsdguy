/**
 * Shared runtime context for route factories (stepwise refinement of the god-file).
 * Mutable activeConfig is the single source for feature toggles after admin saves.
 */
import type { Config } from './config.ts';
import type { RequestHandler } from 'express';
import type multer from 'multer';
import type { FileSessionStore } from './session-store.ts';

export interface AppContext {
    secret: string;
    getActiveConfig: () => Config;
    setActiveConfig: (c: Config) => void;
    authenticate: RequestHandler;
    /** Same as authenticate, but answers 401 and writes an audit row for every failed auth (the /mcp route). */
    authenticateMcp: RequestHandler;
    requireAdmin: RequestHandler;
    requireWriter: RequestHandler;
    upload: multer.Multer;
    sessionStore?: FileSessionStore;
    /**
     * Password comparison. Injectable so a test can watch the work the login
     * does; the default is the real bcrypt compare.
     */
    passwordMatches?: (plain: unknown, hash: string | undefined) => Promise<boolean>;
}

export function createActiveConfigHolder(initial: Config) {
    let active = initial;
    return {
        get: () => active,
        set: (c: Config) => {
            active = c;
        }
    };
}
