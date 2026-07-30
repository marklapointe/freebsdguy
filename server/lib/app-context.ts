/**
 * Shared runtime context for route factories (stepwise refinement of the god-file).
 * Mutable activeConfig is the single source for rate-limit/feature toggles after admin saves.
 */
import type { Config } from './config.ts';
import type { RequestHandler } from 'express';
import type multer from 'multer';

export interface AppContext {
    secret: string;
    getActiveConfig: () => Config;
    setActiveConfig: (c: Config) => void;
    authenticate: RequestHandler;
    requireAdmin: RequestHandler;
    requireWriter: RequestHandler;
    upload: multer.Multer;
    loginLimiter: RequestHandler;
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
