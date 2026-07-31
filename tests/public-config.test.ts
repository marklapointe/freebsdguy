import { describe, it, expect } from 'vitest';
import { PublicConfigBuilder, projectAIConfig } from '../server/lib/public-config.ts';
import type { Config } from '../server/lib/config.ts';

const baseConfig = (): Config => ({
    postsDir: './posts',
    themeDir: './themes',
    currentTheme: 'dark',
    siteName: 'Test Site',
    siteLogo: 'logo.webp',
    jwtSecret: 'super-secret-should-never-leak-0123456789',
    aiConfig: {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-live-VERY-SECRET',
        modelId: 'gpt-4o'
    },
    security: {
        disableAI: false,
        disablePublicSearch: false
    },
    service: { port: 5173 }
});

describe('PublicConfigBuilder (INV-SEC-1)', () => {
    it('never includes apiKey or jwtSecret fields', () => {
        const pub = PublicConfigBuilder.from(baseConfig()).build();
        expect(pub).not.toHaveProperty('jwtSecret');
        expect(JSON.stringify(pub)).not.toMatch(/"apiKey"\s*:/);
        expect(JSON.stringify(pub)).not.toContain('sk-live');
        expect(JSON.stringify(pub)).not.toContain('super-secret-should-never-leak');
    });

    it('exposes apiKeySet instead of the raw key', () => {
        const pub = PublicConfigBuilder.from(baseConfig()).build();
        expect(pub.aiConfig?.apiKeySet).toBe(true);
        expect(pub.aiConfig?.provider).toBe('openai');
        expect(pub.aiConfig?.modelId).toBe('gpt-4o');
    });

    it('projectAIConfig marks empty key as not set', () => {
        const projected = projectAIConfig({
            enabled: false,
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            apiKey: '',
            modelId: 'llama3'
        });
        expect(projected?.apiKeySet).toBe(false);
    });

    it('includes branding and pagination defaults', () => {
        const pub = PublicConfigBuilder.from({
            postsDir: './p',
            themeDir: './t',
            currentTheme: 'light'
        }).build();
        expect(pub.siteName).toBe('Generic Blog');
        expect(pub.pagination).toBe(10);
        expect(pub.currentTheme).toBe('light');
    });

    it('projects appearance defaults (dark mode, CRT/glow on)', () => {
        const pub = PublicConfigBuilder.from(baseConfig()).build();
        expect(pub.appearance).toEqual({
            themeMode: 'dark',
            crtEffects: true,
            textGlow: true
        });
    });

    it('projects appearance overrides', () => {
        const cfg = baseConfig();
        cfg.appearance = { themeMode: 'light', crtEffects: false, textGlow: false };
        const pub = PublicConfigBuilder.from(cfg).build();
        expect(pub.appearance.themeMode).toBe('light');
        expect(pub.appearance.crtEffects).toBe(false);
        expect(pub.appearance.textGlow).toBe(false);
    });
});
