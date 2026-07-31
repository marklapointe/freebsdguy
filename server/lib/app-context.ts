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
    requireAdmin: RequestHandler;
    requireWriter: RequestHandler;
    upload: multer.Multer;
    sessionStore?: FileSessionStore;
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
