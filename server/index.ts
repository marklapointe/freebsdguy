import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig, configPath, resolveAuthMode } from './lib/config.ts';
import { runPreflight } from './lib/preflight.ts';
import { JwtSecretFactory, JwtSecretError, INSECURE_DEFAULT_JWT_SECRET } from './lib/jwt-secret.ts';
import { createDefaultImageUpload } from './lib/upload-options.ts';
import { RoleGuardFactory } from './middleware/auth.ts';
import { createActiveConfigHolder } from './lib/app-context.ts';
import { ensureRuntimeThemeCatalog } from './lib/themes.ts';
import { ensureDemoPosts } from './lib/demo-posts.ts';
import { FileSessionStore, defaultSessionDir } from './lib/session-store.ts';
import { registerRoutes } from './register-routes.ts';

const app = express();
app.set('trust proxy', 1);
export { app };

/** Parse CLI --port / -p from an argv-like array (testable). */
export function parseCliPort(argv: string[] = process.argv): number | null {
    const portArgIndex = argv.indexOf('--port') !== -1 ? argv.indexOf('--port') : argv.indexOf('-p');
    if (portArgIndex !== -1 && argv.length > portArgIndex + 1) {
        const p = parseInt(argv[portArgIndex + 1], 10);
        if (!isNaN(p)) return p;
    }
    return null;
}

/** Whether the process should open an HTTP listen socket (not under unit tests). */
export function shouldStartHttpListener(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV === 'production' || !env.NODE_ENV;
}

// Parse CLI --port / -p
let cliPort: number | null = parseCliPort();
/* istanbul ignore next */
if (cliPort !== null) {
    console.log(`[INFO] Port specified via CLI: ${cliPort}`);
}

const preflightIssues = await runPreflight(process.stdout.isTTY);
/* istanbul ignore next */
if (preflightIssues.some(i => i.critical && !i.fixed) && !process.env.VITEST) {
    console.error('[FATAL] Pre-flight check failed with critical issues. Application cannot start.');
    process.exit(1);
}

const configHolder = createActiveConfigHolder(loadConfig());
const PORT = cliPort || configHolder.get().service?.port || process.env.PORT || 5173;

// Populate runtime themeDir + demo posts (missing files only)
try {
    const cfg = configHolder.get();
    const rawThemeDir = cfg.themeDir || './themes';
    const themeDir = path.isAbsolute(rawThemeDir)
        ? rawThemeDir
        : path.resolve(path.dirname(configPath()), rawThemeDir);
    const seed = ensureRuntimeThemeCatalog(themeDir);
    /* istanbul ignore next */
    if (seed.copied.length) {
        console.log(`[INFO] Seeded ${seed.copied.length} theme(s) into ${themeDir}: ${seed.copied.join(', ')}`);
    }
    console.log(`[INFO] Theme catalog ready: ${seed.total} preset(s)`);

    const rawPosts = cfg.postsDir || './posts';
    const postsDir = path.isAbsolute(rawPosts)
        ? rawPosts
        : path.resolve(path.dirname(configPath()), rawPosts);
    const demo = ensureDemoPosts(postsDir);
    /* istanbul ignore next */
    if (demo.copied.length) {
        console.log(`[INFO] Seeded demo post(s): ${demo.copied.join(', ')}`);
    }
/* istanbul ignore next */
} catch (e) {
    console.warn('[WARN] Theme/demo seed failed:', e);
}

const authModeAtBoot = resolveAuthMode(configHolder.get());
console.log(`[INFO] Auth mode: ${authModeAtBoot}`);

let SECRET: string;
try {
    // Session mode may use SESSION_SECRET; JWT factory still accepts JWT_SECRET / config
    const envSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
    const jwtResult = JwtSecretFactory.forMode()
        .fromEnv(envSecret)
        .fromConfig(configHolder.get())
        .create();
    SECRET = jwtResult.secret;
    /* istanbul ignore next */
    if (!jwtResult.secure && !process.env.VITEST) {
        console.warn(`[WARN] Auth secret is insecure (source=${jwtResult.source}). Set JWT_SECRET or SESSION_SECRET for production.`);
    }
/* istanbul ignore next */
} catch (e) {
    if (e instanceof JwtSecretError) {
        console.error(`[FATAL] ${e.message}`);
        if (!process.env.VITEST) process.exit(1);
        SECRET = INSECURE_DEFAULT_JWT_SECRET;
    } else {
        throw e;
    }
}

const sessionStore = new FileSessionStore(defaultSessionDir());
try {
    sessionStore.ensureDir();
/* istanbul ignore next */
} catch (e) {
    console.warn('[WARN] Session store dir not ready:', e);
}

const upload = createDefaultImageUpload();
const guards = new RoleGuardFactory(SECRET, {
    getMode: () => resolveAuthMode(configHolder.get()),
    getSessionStore: () => sessionStore,
    getSessionCookieName: () =>
        configHolder.get().security?.sessionCookieName || 'mdweb.sid'
});
const authenticate = guards.authenticate();
const requireAdmin = guards.requireAdmin();
const requireWriter = guards.requireContributorOrAdmin();

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "img-src": ["'self'", "data:", "https:"],
            "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            "connect-src": ["'self'", "https://api.openai.com", "http://localhost:*", "http://127.0.0.1:*"],
            "upgrade-insecure-requests": null,
        },
    },
    hsts: process.env.MDWEB_TLS === '1' ? undefined : false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Rate limiting is intentionally not applied here — handle at the reverse proxy / edge.
// credentials: true so session cookies work when authMode=session
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

registerRoutes(app, {
    secret: SECRET,
    getActiveConfig: configHolder.get,
    setActiveConfig: configHolder.set,
    authenticate,
    requireAdmin,
    requireWriter,
    upload,
    sessionStore,
});

if (shouldStartHttpListener()) {
    /* istanbul ignore next */
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
