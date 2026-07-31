import { describe, it, expect, vi } from 'vitest';

vi.mock('md-editor-rt', () => ({
    config: vi.fn()
}));
vi.mock('highlight.js', () => ({ default: { highlight: vi.fn() } }));
vi.mock('katex', () => ({ default: {} }));
vi.mock('mermaid', () => ({
    default: { initialize: vi.fn() }
}));
vi.mock('echarts', () => ({ default: {} }));
vi.mock('highlight.js/styles/github-dark.min.css', () => ({}));
vi.mock('highlight.js/styles/github.min.css', () => ({}));
vi.mock('katex/dist/katex.min.css', () => ({}));

describe('md-editor-setup', () => {
    it('initializes mermaid and config', async () => {
        const mermaid = await import('mermaid');
        const { config } = await import('md-editor-rt');
        await import('../src/lib/md-editor-setup');
        expect(mermaid.default.initialize).toHaveBeenCalled();
        expect(config).toHaveBeenCalled();
    });
});
