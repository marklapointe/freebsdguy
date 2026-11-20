/**
 * P0 D1: every Markdown render surface passes the sanitizer, and the shared
 * markdown-it setup turns raw HTML off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const seen: { name: string; sanitize?: (h: string) => string }[] = [];
const configSpy = vi.fn();

vi.mock('md-editor-rt', () => ({
    config: (...a: unknown[]) => configSpy(...a),
    MdPreview: (p: { sanitize?: (h: string) => string }) => {
        seen.push({ name: 'MdPreview', sanitize: p.sanitize });
        return <div data-testid="preview" />;
    },
    MdEditor: (p: { sanitize?: (h: string) => string }) => {
        seen.push({ name: 'MdEditor', sanitize: p.sanitize });
        return <div data-testid="editor" />;
    },
    MdCatalog: () => <div />
}));
vi.mock('highlight.js', () => ({ default: {} }));
vi.mock('katex', () => ({ default: {} }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn() } }));
vi.mock('echarts', () => ({ default: {} }));
vi.mock('highlight.js/styles/github-dark.min.css', () => ({}));
vi.mock('highlight.js/styles/github.min.css', () => ({}));
vi.mock('katex/dist/katex.min.css', () => ({}));

const get = vi.fn();
vi.mock('../src/lib/api', () => ({
    api: { get: (...a: unknown[]) => get(...a) },
    getMdEditorTheme: () => 'dark',
    siteConfig: { load: vi.fn().mockResolvedValue({ siteName: 'T' }) }
}));

import { PostDetail } from '../src/components/PostDetail';
import { sanitizeMarkdownHtml } from '../src/lib/sanitize-md';

beforeEach(() => {
    seen.length = 0;
    get.mockReset();
});

describe('render wiring', () => {
    it('PostDetail passes the sanitizer to MdPreview', async () => {
        get.mockResolvedValue({
            data: { title: 'Hello', content: '# Body', date: '2026-01-01', author: 'a', summary: 's' }
        });
        render(
            <MemoryRouter initialEntries={['/post/hello']}>
                <Routes>
                    <Route path="/post/:slug" element={<PostDetail />} />
                </Routes>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
        const preview = seen.find((s) => s.name === 'MdPreview');
        expect(preview?.sanitize).toBe(sanitizeMarkdownHtml);
        expect(preview!.sanitize!('<img src=x onerror=alert(1)>')).not.toMatch(/onerror/);
    });

    it('the shared markdown-it config turns raw HTML off', async () => {
        await import('../src/lib/md-editor-setup');
        const arg = configSpy.mock.calls.at(-1)?.[0] as { markdownItConfig?: (md: { set: (o: object) => void }) => void };
        expect(typeof arg.markdownItConfig).toBe('function');
        const set = vi.fn();
        arg.markdownItConfig!({ set });
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ html: false }));
    });

    it('every <MdPreview and <MdEditor in src/components passes sanitize=', () => {
        const dir = path.resolve(process.cwd(), 'src/components');
        const files: string[] = [];
        const walk = (d: string) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const f = path.join(d, e.name);
                if (e.isDirectory()) walk(f);
                else if (f.endsWith('.tsx')) files.push(f);
            }
        };
        walk(dir);
        let tags = 0;
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            for (const m of src.matchAll(/<(MdPreview|MdEditor)\b([\s\S]*?)\/>/g)) {
                tags++;
                expect(m[2], `${path.basename(f)} <${m[1]}`).toMatch(/\bsanitize=/);
            }
        }
        expect(tags).toBeGreaterThan(0);
    });
});
