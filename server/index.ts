import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { loadConfig } from './lib/config.ts';
import { runPreflight } from './lib/preflight.ts';
import { JwtSecretFactory, JwtSecretError, INSECURE_DEFAULT_JWT_SECRET } from './lib/jwt-secret.ts';
import { createDefaultImageUpload } from './lib/upload-options.ts';
import { RoleGuardFactory } from './middleware/auth.ts';
import { createActiveConfigHolder } from './lib/app-context.ts';
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

// Defaults sized for a personal site + automated e2e; still overridable via config.security
const apiLimiter = rateLimit({
    windowMs: configHolder.get().security?.apiRateLimitWindow || 15 * 60 * 1000,
    limit: () => configHolder.get().security?.apiRateLimitMax || 5000,
    message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { ip: false },
    skip: (req) => {
        // originalUrl is always full path (/api/...); req.path can vary by mount
        const p = (req.originalUrl || req.url || req.path || '').split('?')[0];
        // Login has its own limiter — do not double-count against the general bucket
        if (p === '/api/login') return true;
        // High-churn public GETs (every page load)
        if (req.method === 'GET') {
            if (
                p === '/api/health' ||
                p === '/api/config' ||
                p === '/api/theme' ||
                p.startsWith('/api/theme?') ||
                p.startsWith('/api/getimage') ||
                p.startsWith('/api/images/')
            ) {
                return true;
            }
        }
        return false;
    },
});

const loginLimiter = rateLimit({
    windowMs: configHolder.get().security?.loginRateLimitWindow || 15 * 60 * 1000,
    limit: () => configHolder.get().security?.loginRateLimitMax || 50,
    message: { message: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { ip: false },
});

app.use(cors());
app.use(express.json());
// Mount under /api so skip sees paths without /api prefix when using app.use('/api/', ...)
app.use('/api/', apiLimiter);

registerRoutes(app, {
    secret: SECRET,
    getActiveConfig: configHolder.get,
    setActiveConfig: configHolder.set,
    authenticate,
    requireAdmin,
    requireWriter,
    upload,
    loginLimiter,
});

if (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
