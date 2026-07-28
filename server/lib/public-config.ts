/**
 * PublicConfigBuilder — projects internal Config to a client-safe DTO.
 *
 * TAOCP-style invariant (INV-SEC-1):
 *   No public projection may contain apiKey or jwtSecret material.
 *
 * Builder pattern: accumulate optional inclusions, validate at build().
 */

import type { AIConfig, Config, SecurityConfig, ServiceConfig } from './config.ts';

/** Public AI surface: capability flags only; never the raw secret. */
export interface PublicAIConfig {
    enabled: boolean;
    provider: 'ollama' | 'openai';
    baseUrl: string;
    modelId: string;
    /** True when a non-empty key is configured server-side. */
    apiKeySet: boolean;
}

export interface PublicConfig {
    siteName: string;
    siteLogo: string;
    currentTheme: string;
    pagination: number;
    sortBy: string;
    sortOrder: string;
    searchPlacement: string;
    aiConfig?: PublicAIConfig;
    service: ServiceConfig;
    security?: SecurityConfig;
}

const DEFAULT_INSECURE_JWT = 'freebsd_guy_secret_key';

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
            pagination: this.source.pagination || 10,
            sortBy: this.source.sortBy || 'date',
            sortOrder: this.source.sortOrder || 'desc',
            searchPlacement: this.source.searchPlacement || 'top',
            service: this.includeService
                ? (this.source.service || { port: 3001 })
                : { port: 3001 }
        };

        if (this.includeAI) {
            out.aiConfig = projectAIConfig(this.source.aiConfig);
        }
        if (this.includeSecurity && this.source.security) {
            out.security = { ...this.source.security };
        }

        // Defensive check: reject accidental secret leakage if schema drifts
        // Match JSON keys only (not substrings like apiKeySet)
        const json = JSON.stringify(out);
        if (/"apiKey"\s*:/.test(json) || /"jwtSecret"\s*:/.test(json)) {
            throw new Error('INV-SEC-1 violated: public config contains secret field names');
        }
        // Also reject embedding of known default secret string
        if (this.source.jwtSecret && json.includes(this.source.jwtSecret)) {
            throw new Error('INV-SEC-1 violated: public config embeds jwtSecret value');
        }
        if (json.includes(DEFAULT_INSECURE_JWT)) {
            throw new Error('INV-SEC-1 violated: public config embeds default JWT material');
        }

        return out;
    }
}

/** Admin-facing AI view: still never returns raw key, only presence. */
export function projectAdminAIConfig(ai: AIConfig | null | undefined): PublicAIConfig | null {
    return projectAIConfig(ai) ?? null;
}
