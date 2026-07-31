import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_ADMIN_PASSWORD_HASH
} from './default-credentials.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = 'mdweb';
const THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const getBaseConfigDir = () => {
    if (process.env.CONFIG_DIR) return process.env.CONFIG_DIR;

    const platforms = [
        { name: 'freebsd', path: `/usr/local/etc/${APP_NAME}` },
        { name: 'linux', path: `/etc/${APP_NAME}` },
        { name: 'fallback', path: path.join(os.homedir(), '.local', 'etc', APP_NAME) }
    ];

    let orderedPlatforms = [];
    /* v8 ignore start */
    if (process.platform === 'freebsd') {
        orderedPlatforms = [platforms[0], platforms[1], platforms[2]];
    } else if (process.platform === 'linux') {
        orderedPlatforms = [platforms[1], platforms[0], platforms[2]];
    } else {
        orderedPlatforms = [platforms[2], platforms[0], platforms[1]];
    }

    for (const p of orderedPlatforms) {
        try {
            if (fs.existsSync(p.path)) {
                fs.accessSync(p.path, fs.constants.W_OK);
                return p.path;
            } else {
                const parent = path.dirname(p.path);
                if (fs.existsSync(parent)) {
                    fs.accessSync(parent, fs.constants.W_OK);
                    return p.path;
                }
            }
        } catch {
            continue;
        }
    }

    return path.join(__dirname, '..', 'config');
    /* v8 ignore stop */
};

const baseConfigDir = getBaseConfigDir();

export const configPath = () => process.env.CONFIG_PATH || path.join(baseConfigDir, 'config.json');
export const usersPath = () => process.env.USERS_PATH || path.join(baseConfigDir, 'users.json');

export interface User {
    username: string;
    passwordHash: string;
    role: string;
    /** @deprecated Site theme is config.currentTheme only; ignored if present in old users.json */
    theme?: string;
}

export interface UsersConfig {
    admin: User;
    users: User[];
}

export interface ServiceConfig {
    port?: number;
}

/** Site-wide appearance prefs (theme pack is currentTheme; mode is light/dark of that pack). */
export interface AppearanceConfig {
    themeMode?: 'light' | 'dark';
    crtEffects?: boolean;
    textGlow?: boolean;
}

/** Public footer / copyright branding (editable in Site settings). */
export interface FooterConfig {
    /** false hides the entire footer */
    show?: boolean;
    /**
     * Main line. Placeholders: {year} {siteName}.
     * Empty string = no copyright line.
     */
    copyrightText?: string;
    /** Optional second line (e.g. custom credit). Empty = omit. */
    creditText?: string;
}

export const DEFAULT_FOOTER_COPYRIGHT = '© {year} {siteName}. All rights reserved.';

export interface Config {
    postsDir: string;
    themeDir: string;
    currentTheme: string;
    siteName?: string;
    siteLogo?: string;
    pagination?: number;
    sortBy?: 'date' | 'title' | 'author';
    sortOrder?: 'asc' | 'desc';
    searchPlacement?: 'top' | 'bottom' | 'left' | 'right' | 'none';
    appearance?: AppearanceConfig;
    footer?: FooterConfig;
    aiConfig?: AIConfig;
    service?: ServiceConfig;
    jwtSecret?: string;
    security?: SecurityConfig;
    /** Forward-compatible bag; sanitize keeps unknown top-level keys here if needed */
    [key: string]: unknown;
}

/** Expand footer placeholders for display. */
export function formatFooterText(template: string, siteName: string, year = new Date().getFullYear()): string {
    return template
        .replace(/\{year\}/g, String(year))
        .replace(/\{siteName\}/g, siteName || 'MDWeb');
}

export type AuthMode = 'jwt' | 'session';

export interface SecurityConfig {
    /**
     * jwt (default): Bearer tokens. session: classical HttpOnly cookie sessions
     * when JWT is awkward (stripped Authorization, clock skew, etc.).
     */
    authMode?: AuthMode;
    /** Session cookie lifetime (seconds). Default 86400. */
    sessionTtlSeconds?: number;
    /** Session cookie name. Default mdweb.sid */
    sessionCookieName?: string;
    /** @deprecated Not enforced — rate limiting belongs at the reverse proxy / edge */
    apiRateLimitWindow?: number;
    /** @deprecated Not enforced — rate limiting belongs at the reverse proxy / edge */
    apiRateLimitMax?: number;
    /** @deprecated Not enforced — rate limiting belongs at the reverse proxy / edge */
    loginRateLimitWindow?: number;
    /** @deprecated Not enforced — rate limiting belongs at the reverse proxy / edge */
    loginRateLimitMax?: number;
    disableAI?: boolean;
    disableImages?: boolean;
    disablePublicSearch?: boolean;
}

/** Resolve auth mode: env MDWEB_AUTH_MODE wins, then config, default jwt. */
export function resolveAuthMode(config?: Pick<Config, 'security'> | null): AuthMode {
    const env = (process.env.MDWEB_AUTH_MODE || '').trim().toLowerCase();
    if (env === 'session' || env === 'jwt') return env;
    const m = config?.security?.authMode;
    return m === 'session' ? 'session' : 'jwt';
}

export interface AIConfig {
    enabled: boolean;
    provider: 'ollama' | 'openai';
    baseUrl: string;
    apiKey: string;
    modelId: string;
}

export interface ConfigLoadStatus {
    warnings: string[];
    quarantinedPath?: string;
    usedDefaults: boolean;
    path: string;
}

let lastConfigStatus: ConfigLoadStatus = {
    warnings: [],
    usedDefaults: false,
    path: ''
};

export function getConfigLoadStatus(): ConfigLoadStatus {
    return { ...lastConfigStatus, warnings: [...lastConfigStatus.warnings] };
}

/** True when CONFIG_DIR looks like a system install (FreeBSD/Linux package layout). */
export function isSystemConfigDir(dir?: string): boolean {
    const d = dir || process.env.CONFIG_DIR || baseConfigDir;
    return (
        d === `/usr/local/etc/${APP_NAME}` ||
        d === `/etc/${APP_NAME}` ||
        d.endsWith(`/etc/${APP_NAME}`) ||
        d.endsWith(`\\etc\\${APP_NAME}`)
    );
}

/**
 * Platform-aware defaults. System installs always point at durable /var/db paths
 * so a corrupt config cannot send posts/themes into /usr/local/etc/mdweb/.
 */
export function defaultConfig(): Config {
    if (isSystemConfigDir()) {
        return {
            postsDir: '/var/db/mdweb/posts',
            themeDir: '/var/db/mdweb/themes',
            currentTheme: 'dark',
            siteName: 'MDWeb',
            siteLogo: 'logo.webp',
            pagination: 10,
            sortBy: 'date',
            sortOrder: 'desc',
            searchPlacement: 'top',
            appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
            footer: {
                show: true,
                copyrightText: DEFAULT_FOOTER_COPYRIGHT,
                creditText: ''
            },
            service: { port: 5173 },
            aiConfig: {
                enabled: false,
                provider: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                apiKey: '',
                modelId: 'llama3'
            },
            security: {
                authMode: 'jwt',
                sessionTtlSeconds: 86400,
                sessionCookieName: 'mdweb.sid',
                disableAI: false,
                disableImages: false,
                disablePublicSearch: false
            }
        };
    }
    return {
        postsDir: './posts',
        themeDir: './themes',
        currentTheme: 'dark',
        siteName: 'MDWeb',
        pagination: 10,
        sortBy: 'date',
        sortOrder: 'desc',
        searchPlacement: 'top',
        appearance: { themeMode: 'dark', crtEffects: true, textGlow: true },
        footer: {
            show: true,
            copyrightText: DEFAULT_FOOTER_COPYRIGHT,
            creditText: ''
        },
        service: { port: 5173 },
        security: {
            authMode: 'jwt',
            sessionTtlSeconds: 86400,
            sessionCookieName: 'mdweb.sid',
            disableAI: false,
            disableImages: false,
            disablePublicSearch: false
        }
    };
}

export function defaultUsers(): UsersConfig {
    return {
        admin: {
            username: DEFAULT_ADMIN_USERNAME,
            passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
            role: 'admin'
        },
        users: []
    };
}

const ensureDirectoryExists = (filePath: string) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

/**
 * Move unreadable config/users aside so the next load does not thrash.
 * Never throws — quarantine failure is logged only.
 */
export function quarantineBadFile(targetPath: string): string | undefined {
    try {
        if (!fs.existsSync(targetPath)) return undefined;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = `${targetPath}.bad-${stamp}`;
        fs.renameSync(targetPath, dest);
        return dest;
    } catch (e) {
        console.error(`[ERROR] Failed to quarantine ${targetPath}:`, e);
        return undefined;
    }
}

const migrateIfNeeded = (targetPath: string, fileName: string) => {
    if (!fs.existsSync(targetPath)) {
        const bundledPath = path.join(__dirname, '..', 'config', fileName);
        if (fs.existsSync(bundledPath)) {
            try {
                ensureDirectoryExists(targetPath);
                fs.copyFileSync(bundledPath, targetPath);
            /* istanbul ignore next */
            } catch (e) {
                console.warn(`[WARN] Could not seed ${fileName} from bundle:`, e);
            }
        }
    }
};

function asNonEmptyString(v: unknown): string | undefined {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
    if (typeof v === 'boolean') return v;
    return fallback;
}

function asPort(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 65535) return undefined;
    return Math.floor(n);
}

function asPagination(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(100, Math.floor(n)));
}

/**
 * Coerce arbitrary JSON into a full Config. Never throws.
 * Keeps unknown top-level keys for forward compatibility.
 */
export function sanitizeConfig(raw: unknown): { config: Config; warnings: string[] } {
    const warnings: string[] = [];
    const base = defaultConfig();

    if (raw === null || raw === undefined) {
        warnings.push('config root was null/undefined');
        return { config: base, warnings };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push(`config root was ${Array.isArray(raw) ? 'array' : typeof raw}, expected object`);
        return { config: base, warnings };
    }

    const o = raw as Record<string, unknown>;
    const config: Config = { ...base };

    const postsDir = asNonEmptyString(o.postsDir);
    if (postsDir) config.postsDir = postsDir;
    else if (o.postsDir !== undefined) warnings.push('postsDir invalid; using default');

    const themeDir = asNonEmptyString(o.themeDir);
    if (themeDir) config.themeDir = themeDir;
    else if (o.themeDir !== undefined) warnings.push('themeDir invalid; using default');

    const theme = asNonEmptyString(o.currentTheme);
    if (theme && THEME_ID_RE.test(theme)) config.currentTheme = theme;
    else if (o.currentTheme !== undefined) {
        warnings.push('currentTheme invalid; using dark');
        config.currentTheme = 'dark';
    }

    const siteName = asNonEmptyString(o.siteName);
    if (siteName) config.siteName = siteName;
    else if (o.siteName !== undefined) warnings.push('siteName invalid; using default');

    if (typeof o.siteLogo === 'string') config.siteLogo = o.siteLogo;

    if (o.pagination !== undefined) {
        config.pagination = asPagination(o.pagination, base.pagination || 10);
        if (typeof o.pagination !== 'number' && typeof o.pagination !== 'string') {
            warnings.push('pagination invalid type; coerced/clamped');
        }
    }

    const sortBy = asNonEmptyString(o.sortBy);
    if (sortBy === 'date' || sortBy === 'title' || sortBy === 'author') config.sortBy = sortBy;
    else if (o.sortBy !== undefined) warnings.push('sortBy invalid; using date');

    const sortOrder = asNonEmptyString(o.sortOrder);
    if (sortOrder === 'asc' || sortOrder === 'desc') config.sortOrder = sortOrder;
    else if (o.sortOrder !== undefined) warnings.push('sortOrder invalid; using desc');

    const searchPlacement = asNonEmptyString(o.searchPlacement);
    if (
        searchPlacement === 'top' ||
        searchPlacement === 'bottom' ||
        searchPlacement === 'left' ||
        searchPlacement === 'right' ||
        searchPlacement === 'none'
    ) {
        config.searchPlacement = searchPlacement;
    } else if (o.searchPlacement !== undefined) {
        warnings.push('searchPlacement invalid; using top');
    }

    if (o.appearance !== undefined) {
        if (o.appearance && typeof o.appearance === 'object' && !Array.isArray(o.appearance)) {
            const a = o.appearance as Record<string, unknown>;
            const prev = base.appearance || {};
            config.appearance = {
                themeMode: a.themeMode === 'light' ? 'light' : a.themeMode === 'dark' ? 'dark' : prev.themeMode || 'dark',
                crtEffects: asBool(a.crtEffects, prev.crtEffects !== false),
                textGlow: asBool(a.textGlow, prev.textGlow !== false)
            };
            if (a.themeMode !== undefined && a.themeMode !== 'light' && a.themeMode !== 'dark') {
                warnings.push('appearance.themeMode invalid; using dark');
            }
        } else {
            warnings.push('appearance invalid; using defaults');
            config.appearance = base.appearance;
        }
    }

    if (o.footer !== undefined) {
        if (o.footer && typeof o.footer === 'object' && !Array.isArray(o.footer)) {
            const f = o.footer as Record<string, unknown>;
            const clip = (s: string) => s.slice(0, 200);
            config.footer = {
                show: asBool(f.show, true),
                copyrightText:
                    typeof f.copyrightText === 'string'
                        ? clip(f.copyrightText)
                        : DEFAULT_FOOTER_COPYRIGHT,
                creditText: typeof f.creditText === 'string' ? clip(f.creditText) : ''
            };
        } else {
            warnings.push('footer invalid; using defaults');
            config.footer = base.footer;
        }
    }

    if (o.aiConfig !== undefined) {
        if (o.aiConfig && typeof o.aiConfig === 'object' && !Array.isArray(o.aiConfig)) {
            const ai = o.aiConfig as Record<string, unknown>;
            config.aiConfig = {
                enabled: asBool(ai.enabled, false),
                provider: ai.provider === 'openai' ? 'openai' : 'ollama',
                baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : '',
                apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
                modelId: typeof ai.modelId === 'string' ? ai.modelId : 'llama3'
            };
        } else {
            warnings.push('aiConfig invalid; omitting');
            delete config.aiConfig;
        }
    }

    if (o.service !== undefined) {
        if (o.service && typeof o.service === 'object' && !Array.isArray(o.service)) {
            const s = o.service as Record<string, unknown>;
            const port = asPort(s.port);
            config.service = port !== undefined ? { port } : { ...base.service };
            if (s.port !== undefined && port === undefined) warnings.push('service.port invalid; using default');
        } else {
            warnings.push('service invalid; using default');
            config.service = base.service;
        }
    }

    if (o.security !== undefined) {
        if (o.security && typeof o.security === 'object' && !Array.isArray(o.security)) {
            const sec = o.security as Record<string, unknown>;
            let authMode: AuthMode = 'jwt';
            if (sec.authMode === 'session' || sec.authMode === 'jwt') authMode = sec.authMode;
            else if (sec.authMode !== undefined) warnings.push('security.authMode invalid; using jwt');

            let sessionTtlSeconds = 86400;
            if (sec.sessionTtlSeconds !== undefined) {
                const n =
                    typeof sec.sessionTtlSeconds === 'number'
                        ? sec.sessionTtlSeconds
                        : typeof sec.sessionTtlSeconds === 'string'
                          ? parseInt(sec.sessionTtlSeconds, 10)
                          : NaN;
                if (Number.isFinite(n)) sessionTtlSeconds = Math.max(300, Math.min(604800, Math.floor(n)));
                else warnings.push('security.sessionTtlSeconds invalid; using 86400');
            }

            let sessionCookieName = 'mdweb.sid';
            if (typeof sec.sessionCookieName === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(sec.sessionCookieName)) {
                sessionCookieName = sec.sessionCookieName;
            } else if (sec.sessionCookieName !== undefined) {
                warnings.push('security.sessionCookieName invalid; using mdweb.sid');
            }

            config.security = {
                authMode,
                sessionTtlSeconds,
                sessionCookieName,
                disableAI: asBool(sec.disableAI, false),
                disableImages: asBool(sec.disableImages, false),
                disablePublicSearch: asBool(sec.disablePublicSearch, false)
            };
            if (typeof sec.apiRateLimitWindow === 'number') config.security.apiRateLimitWindow = sec.apiRateLimitWindow;
            if (typeof sec.apiRateLimitMax === 'number') config.security.apiRateLimitMax = sec.apiRateLimitMax;
            if (typeof sec.loginRateLimitWindow === 'number') {
                config.security.loginRateLimitWindow = sec.loginRateLimitWindow;
            }
            if (typeof sec.loginRateLimitMax === 'number') config.security.loginRateLimitMax = sec.loginRateLimitMax;
        } else {
            warnings.push('security invalid; using defaults');
        }
    }

    if (typeof o.jwtSecret === 'string' && o.jwtSecret.length > 0) {
        config.jwtSecret = o.jwtSecret;
    }

    // Forward-compatible: keep unknown top-level keys (strings/numbers/bools/objects only)
    const known = new Set([
        'postsDir',
        'themeDir',
        'currentTheme',
        'siteName',
        'siteLogo',
        'pagination',
        'sortBy',
        'sortOrder',
        'searchPlacement',
        'appearance',
        'footer',
        'aiConfig',
        'service',
        'jwtSecret',
        'security'
    ]);
    for (const [k, v] of Object.entries(o)) {
        if (known.has(k)) continue;
        if (v === undefined) continue;
        config[k] = v;
    }

    return { config, warnings };
}

/**
 * Load and sanitize site config. Never throws.
 * Hard parse failures quarantine the file and return platform defaults.
 */
export const loadConfig = (customPath?: string): Config => {
    const targetPath = customPath || configPath();
    lastConfigStatus = { warnings: [], usedDefaults: false, path: targetPath };

    try {
        if (!customPath) {
            migrateIfNeeded(targetPath, 'config.json');
        }
    /* istanbul ignore next */
    } catch (e) {
        lastConfigStatus.warnings.push(`migrate seed failed: ${String(e)}`);
    }

    if (!fs.existsSync(targetPath)) {
        lastConfigStatus.usedDefaults = true;
        lastConfigStatus.warnings.push('config file missing; using defaults');
        return defaultConfig();
    }

    let text: string;
    try {
        text = fs.readFileSync(targetPath, 'utf8');
    } catch (e) {
        lastConfigStatus.usedDefaults = true;
        lastConfigStatus.warnings.push(`config unreadable: ${String(e)}`);
        console.error(`[ERROR] Cannot read config at ${targetPath}:`, e);
        return defaultConfig();
    }

    if (!text.trim()) {
        const q = quarantineBadFile(targetPath);
        lastConfigStatus.usedDefaults = true;
        lastConfigStatus.quarantinedPath = q;
        lastConfigStatus.warnings.push('config file empty; quarantined');
        console.error(`[ERROR] Empty config at ${targetPath}; moved to ${q || '(quarantine failed)'}`);
        return defaultConfig();
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        const q = quarantineBadFile(targetPath);
        lastConfigStatus.usedDefaults = true;
        lastConfigStatus.quarantinedPath = q;
        lastConfigStatus.warnings.push(`config JSON parse failed: ${String(e)}`);
        console.error(
            `[ERROR] Invalid JSON in ${targetPath}; using defaults. Original moved to ${q || '(quarantine failed)'}`
        );
        return defaultConfig();
    }

    const { config, warnings } = sanitizeConfig(parsed);
    lastConfigStatus.warnings.push(...warnings);
    if (warnings.length && !process.env.VITEST) {
        console.warn(`[WARN] Config sanitized (${warnings.length} issue(s)) at ${targetPath}:`, warnings.join('; '));
    }
    return config;
};

export const loadAIConfig = (customPath?: string): AIConfig | null => {
    const config = loadConfig(customPath);
    return config.aiConfig || null;
};

export const saveConfig = (config: Config, customPath?: string) => {
    const targetPath = customPath || configPath();
    ensureDirectoryExists(targetPath);
    // Always persist a sanitized document so disk never holds half-broken shapes we wrote
    const { config: clean } = sanitizeConfig(config);
    try {
        fs.writeFileSync(targetPath, JSON.stringify(clean, null, 2));
    } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err?.code === 'EACCES' || err?.code === 'EPERM') {
            throw new Error(
                `Cannot write config at ${targetPath} (permission denied). ` +
                    `chown the file to the service user (e.g. www) and ensure it is writable.`
            );
        }
        throw e;
    }
};

export const isConfigWritable = (customPath?: string): boolean => {
    const targetPath = customPath || configPath();
    try {
        if (fs.existsSync(targetPath)) {
            fs.accessSync(targetPath, fs.constants.W_OK);
            return true;
        } else {
            const dir = path.dirname(targetPath);
            if (fs.existsSync(dir)) {
                fs.accessSync(dir, fs.constants.W_OK);
                return true;
            }
        }
    } catch {
        return false;
    }
    return false;
};

/**
 * Coerce users.json into UsersConfig. Never throws.
 */
export function sanitizeUsers(raw: unknown): { users: UsersConfig; warnings: string[] } {
    const warnings: string[] = [];
    const base = defaultUsers();

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push('users root invalid; using default admin');
        return { users: base, warnings };
    }

    const o = raw as Record<string, unknown>;
    let admin = base.admin;

    if (o.admin && typeof o.admin === 'object' && !Array.isArray(o.admin)) {
        const a = o.admin as Record<string, unknown>;
        admin = {
            username: asNonEmptyString(a.username) || DEFAULT_ADMIN_USERNAME,
            passwordHash: typeof a.passwordHash === 'string' ? a.passwordHash : DEFAULT_ADMIN_PASSWORD_HASH,
            role: asNonEmptyString(a.role) || 'admin'
        };
        if (!asNonEmptyString(a.username)) warnings.push('admin.username missing; using default');
        if (typeof a.passwordHash !== 'string' || !a.passwordHash) {
            warnings.push('admin.passwordHash missing; using default hash');
        }
    } else {
        warnings.push('admin block missing; using default admin');
    }

    const users: User[] = [];
    if (Array.isArray(o.users)) {
        for (const item of o.users) {
            if (!item || typeof item !== 'object') continue;
            const u = item as Record<string, unknown>;
            const username = asNonEmptyString(u.username);
            if (!username) continue;
            users.push({
                username,
                passwordHash: typeof u.passwordHash === 'string' ? u.passwordHash : '',
                role: asNonEmptyString(u.role) || 'contributor'
            });
        }
    } else if (o.users !== undefined) {
        warnings.push('users array invalid; ignored');
    }

    return { users: { admin, users }, warnings };
}

/**
 * Load users. Never throws.
 * Missing file: create default admin on disk.
 * Corrupt file: quarantine + in-memory default admin (do not overwrite with write unless missing).
 */
export const loadUsers = (customPath?: string): UsersConfig => {
    const targetPath = customPath || usersPath();

    try {
        if (!customPath) {
            migrateIfNeeded(targetPath, 'users.json');
        }
    } catch {
        /* non-fatal */
    }

    if (!fs.existsSync(targetPath)) {
        const defaultConfig = defaultUsers();
        try {
            ensureDirectoryExists(targetPath);
            fs.writeFileSync(targetPath, JSON.stringify(defaultConfig, null, 2));
        } catch (e) {
            console.error(`[ERROR] Could not write default users to ${targetPath}:`, e);
        }
        return defaultConfig;
    }

    let text: string;
    try {
        text = fs.readFileSync(targetPath, 'utf8');
    } catch (e) {
        console.error(`[ERROR] Cannot read users at ${targetPath}:`, e);
        return defaultUsers();
    }

    if (!text.trim()) {
        const q = quarantineBadFile(targetPath);
        console.error(`[ERROR] Empty users file; quarantined to ${q || '(failed)'}`);
        return defaultUsers();
    }

    try {
        const parsed = JSON.parse(text);
        const { users, warnings } = sanitizeUsers(parsed);
        if (warnings.length && !process.env.VITEST) {
            console.warn(`[WARN] users.json sanitized:`, warnings.join('; '));
        }
        return users;
    } catch (e) {
        const q = quarantineBadFile(targetPath);
        console.error(
            `[ERROR] Invalid users JSON at ${targetPath}; using default admin. Moved to ${q || '(quarantine failed)'}`
        );
        return defaultUsers();
    }
};

export const saveUsers = (users: UsersConfig, customPath?: string) => {
    const targetPath = customPath || usersPath();
    ensureDirectoryExists(targetPath);
    const { users: clean } = sanitizeUsers(users);
    fs.writeFileSync(targetPath, JSON.stringify(clean, null, 2));
};
