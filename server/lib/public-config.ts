/**
 * PublicConfigBuilder — projects internal Config to a client-safe DTO.
 *
 * TAOCP-style invariant (INV-SEC-1):
 *   No public projection may contain apiKey or jwtSecret material.
 *
 * Builder pattern: accumulate optional inclusions, validate at build().
 */

import type {
    AIConfig,
    AppearanceConfig,
    AuthMode,
    Config,
    FooterConfig,
    ServiceConfig
} from './config.ts';
import { DEFAULT_FOOTER_COPYRIGHT, resolveAuthMode } from './config.ts';

/** Public AI surface: capability flags only; never the raw secret. */
export interface PublicAIConfig {
    enabled: boolean;
    provider: 'ollama' | 'openai';
    baseUrl: string;
    modelId: string;
    /** True when a non-empty key is configured server-side. */
    apiKeySet: boolean;
}

export interface PublicAppearance {
    themeMode: 'light' | 'dark';
    crtEffects: boolean;
    textGlow: boolean;
}

/** Public security surface — never secrets. */
export interface PublicSecurity {
    authMode: AuthMode;
    /** True when JWT_SECRET / SESSION_SECRET / config.jwtSecret looks set (not the value). */
    authSecretSet: boolean;
    sessionTtlSeconds: number;
    disableAI: boolean;
    disableImages: boolean;
    disablePublicSearch: boolean;
}

export interface PublicFooter {
    show: boolean;
    copyrightText: string;
    creditText: string;
}

export interface PublicConfig {
    siteName: string;
    siteLogo: string;
    currentTheme: string;
    appearance: PublicAppearance;
    footer: PublicFooter;
    pagination: number;
    sortBy: string;
    sortOrder: string;
    searchPlacement: string;
    /** Absolute or configured posts path (for advanced Site UI display). */
    postsDir?: string;
    themeDir?: string;
    aiConfig?: PublicAIConfig;
    service: ServiceConfig;
    security?: PublicSecurity;
}

export function projectFooter(f?: FooterConfig | null): PublicFooter {
    return {
        show: f?.show !== false,
        copyrightText:
            typeof f?.copyrightText === 'string' ? f.copyrightText : DEFAULT_FOOTER_COPYRIGHT,
        creditText: typeof f?.creditText === 'string' ? f.creditText : ''
    };
}

const DEFAULT_INSECURE_JWT = 'freebsd_guy_secret_key';

export function projectSecurity(config: Config): PublicSecurity {
    const s = config.security || {};
    const secret =
        (process.env.SESSION_SECRET || process.env.JWT_SECRET || config.jwtSecret || '').trim();
    return {
        authMode: resolveAuthMode(config),
        authSecretSet: secret.length >= 16 && secret !== DEFAULT_INSECURE_JWT,
        sessionTtlSeconds:
            typeof s.sessionTtlSeconds === 'number' && s.sessionTtlSeconds > 0
                ? s.sessionTtlSeconds
                : 86400,
        disableAI: !!s.disableAI,
        disableImages: !!s.disableImages,
        disablePublicSearch: !!s.disablePublicSearch
    };
}

export function projectAppearance(a?: AppearanceConfig | null): PublicAppearance {
    return {
        themeMode: a?.themeMode === 'light' ? 'light' : 'dark',
        // Default ON so retro themes keep CRT look until admin turns them off
        crtEffects: a?.crtEffects !== false,
        textGlow: a?.textGlow !== false
    };
}

/**
 * Pure projection of AI config.
 * Precondition: none (null-safe).
 * Postcondition: result has no property named apiKey.
 */
export function projectAIConfig(ai: AIConfig | null | undefined): PublicAIConfig | undefined {
    if (!ai) return undefined;
    return {
        enabled: !!ai.enabled,
        provider: ai.provider === 'openai' ? 'openai' : 'ollama',
        baseUrl: ai.baseUrl || '',
        modelId: ai.modelId || '',
        apiKeySet: !!(ai.apiKey && ai.apiKey.length > 0)
    };
}

export class PublicConfigBuilder {
    private source: Config;
    private includeAI = true;
    private includeSecurity = true;
    private includeService = true;

    private constructor(source: Config) {
        this.source = source;
    }

    static from(config: Config): PublicConfigBuilder {
        return new PublicConfigBuilder(config);
    }

    withoutAI(): this {
        this.includeAI = false;
        return this;
    }

    withoutSecurity(): this {
        this.includeSecurity = false;
        return this;
    }

    withoutService(): this {
        this.includeService = false;
        return this;
    }

    /**
     * Build public DTO and assert INV-SEC-1 by construction (no secret fields).
     */
    build(): PublicConfig {
        const out: PublicConfig = {
            siteName: this.source.siteName || 'Generic Blog',
            siteLogo: this.source.siteLogo || 'logo.webp',
            currentTheme: this.source.currentTheme || 'dark',
            appearance: projectAppearance(this.source.appearance),
            footer: projectFooter(this.source.footer),
            pagination: this.source.pagination || 10,
            sortBy: this.source.sortBy || 'date',
            sortOrder: this.source.sortOrder || 'desc',
            searchPlacement: this.source.searchPlacement || 'top',
            postsDir: this.source.postsDir,
            themeDir: this.source.themeDir,
            service: this.includeService
                ? (this.source.service || { port: 3001 })
                : { port: 3001 }
        };

        if (this.includeAI) {
            out.aiConfig = projectAIConfig(this.source.aiConfig);
        }
        if (this.includeSecurity) {
            out.security = projectSecurity(this.source);
        }

        // Defensive check: reject accidental secret leakage if schema drifts
        // Match JSON keys only (not substrings like apiKeySet)
        const json = JSON.stringify(out);
        /* v8 ignore start */
        if (/"apiKey"\s*:/.test(json) || /"jwtSecret"\s*:/.test(json)) {
            throw new Error('INV-SEC-1 violated: public config contains secret field names');
        }
        if (this.source.jwtSecret && json.includes(this.source.jwtSecret)) {
            throw new Error('INV-SEC-1 violated: public config embeds jwtSecret value');
        }
        if (json.includes(DEFAULT_INSECURE_JWT)) {
            throw new Error('INV-SEC-1 violated: public config embeds default JWT material');
        }
        /* v8 ignore stop */

        return out;
    }
}

/** Admin-facing AI view: still never returns raw key, only presence. */
export function projectAdminAIConfig(ai: AIConfig | null | undefined): PublicAIConfig | null {
    return projectAIConfig(ai) ?? null;
}
