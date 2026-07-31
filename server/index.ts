import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig, configPath } from './lib/config.ts';
import { runPreflight } from './lib/preflight.ts';
import { JwtSecretFactory, JwtSecretError, INSECURE_DEFAULT_JWT_SECRET } from './lib/jwt-secret.ts';
import { createDefaultImageUpload } from './lib/upload-options.ts';
import { RoleGuardFactory } from './middleware/auth.ts';
import { createActiveConfigHolder } from './lib/app-context.ts';
import { ensureRuntimeThemeCatalog } from './lib/themes.ts';
import { registerRoutes } from './register-routes.ts';

const app = express();
app.set('trust proxy', 1);
export { app };

// Parse CLI --port / -p
let cliPort: number | null = null;
const portArgIndex = process.argv.indexOf('--port') !== -1 ? process.argv.indexOf('--port') : process.argv.indexOf('-p');
if (portArgIndex !== -1 && process.argv.length > portArgIndex + 1) {
    const p = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(p)) {
        cliPort = p;
        console.log(`[INFO] Port specified via CLI: ${cliPort}`);
    }
}

const preflightIssues = await runPreflight(process.stdout.isTTY);
if (preflightIssues.some(i => i.critical && !i.fixed) && !process.env.VITEST) {
    console.error('[FATAL] Pre-flight check failed with critical issues. Application cannot start.');
    process.exit(1);
}

const configHolder = createActiveConfigHolder(loadConfig());
const PORT = cliPort || configHolder.get().service?.port || process.env.PORT || 5173;

// Populate runtime themeDir from the shipped catalog (missing files only)
try {
    const cfg = configHolder.get();
    const rawThemeDir = cfg.themeDir || './themes';
    const themeDir = path.isAbsolute(rawThemeDir)
        ? rawThemeDir
        : path.resolve(path.dirname(configPath()), rawThemeDir);
    const seed = ensureRuntimeThemeCatalog(themeDir);
    if (seed.copied.length) {
        console.log(`[INFO] Seeded ${seed.copied.length} theme(s) into ${themeDir}: ${seed.copied.join(', ')}`);
    }
    console.log(`[INFO] Theme catalog ready: ${seed.total} preset(s)`);
} catch (e) {
    console.warn('[WARN] Theme catalog seed failed:', e);
}

let SECRET: string;
try {
    const jwtResult = JwtSecretFactory.forMode()
        .fromEnv(process.env.JWT_SECRET)
        .fromConfig(configHolder.get())
        .create();
    SECRET = jwtResult.secret;
    if (!jwtResult.secure && !process.env.VITEST) {
        console.warn(`[WARN] JWT secret is insecure (source=${jwtResult.source}). Set JWT_SECRET for production.`);
    }
} catch (e) {
    if (e instanceof JwtSecretError) {
        console.error(`[FATAL] ${e.message}`);
        if (!process.env.VITEST) process.exit(1);
        SECRET = INSECURE_DEFAULT_JWT_SECRET;
    } else {
        throw e;
    }
}

const upload = createDefaultImageUpload();
const guards = new RoleGuardFactory(SECRET);
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
app.use(cors());
app.use(express.json());

registerRoutes(app, {
    secret: SECRET,
    getActiveConfig: configHolder.get,
    setActiveConfig: configHolder.set,
    authenticate,
    requireAdmin,
    requireWriter,
    upload,
});

if (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
