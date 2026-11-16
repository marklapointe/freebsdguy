/**
 * Track #2063 — split the front-end JS so public pages do not pay for
 * md-editor-rt + mermaid/katex/hljs/echarts on first paint.
 *
 * The default stylesheet stays the full base (no rules dropped from
 * src/index.css). Theme CSS is a later layer; order is covered by
 * tests/theme-css-first-paint.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd());

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Static import / re-export specifiers in a TS/TSX source file. */
function staticSpecifiers(src: string): string[] {
    const out: string[] = [];
    const re =
        /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[^'"\n]+from\s+)?|export\s+(?:type\s+)?\*(?:\s+as\s+\w+)?\s+from\s+|export\s+(?:type\s+)?\{[^}]*\}\s+from\s+)['"]([^'"]+)['"]/g;
    const side = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(m[1]);
    while ((m = side.exec(src))) out.push(m[1]);
    return out;
}

function walkStatic(entryRel: string, stopAt: (spec: string, file: string) => boolean | void): string[] {
    const seen = new Set<string>();
    const hits: string[] = [];
    const queue = [path.join(root, entryRel)];
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
        const src = fs.readFileSync(file, 'utf8');
        for (const spec of staticSpecifiers(src)) {
            if (stopAt(spec, file)) {
                hits.push(`${path.relative(root, file)} -> ${spec}`);
                continue;
            }
            if (spec.startsWith('.') || spec.startsWith('/')) {
                const base = path.resolve(path.dirname(file), spec);
                const candidates = [
                    base,
                    base + '.ts',
                    base + '.tsx',
                    base + '.js',
                    base + '.jsx',
                    base + '.css',
                    path.join(base, 'index.ts'),
                    path.join(base, 'index.tsx'),
                ];
                const next = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
                if (next) queue.push(next);
            }
        }
    }
    return hits;
}

describe('Track #2063 JS split (source)', () => {
    it('main.tsx does not statically import the markdown editor or its setup', () => {
        const src = read('src/main.tsx');
        expect(src).not.toMatch(/md-editor-setup/);
        expect(src).not.toMatch(/md-editor-rt/);
    });

    it('App.tsx lazy-loads route pages so the editor stays out of the entry', () => {
        const src = read('src/App.tsx');
        expect(src).toMatch(/\blazy\s*\(/);
        expect(src).toMatch(/import\(\s*['"]\.\/lib\/md-home['"]\s*\)/);
        expect(src).toMatch(/import\(\s*['"]\.\/lib\/md-post-detail['"]\s*\)/);
        expect(src).toMatch(/import\(\s*['"]\.\/lib\/md-admin['"]\s*\)/);
        expect(src).toMatch(/<Suspense[\s>]/);
    });

    it('the static import graph from main.tsx never reaches md-editor-rt or md-editor-setup', () => {
        const hits = walkStatic('src/main.tsx', (spec) => {
            if (spec === 'md-editor-rt' || spec.startsWith('md-editor-rt/')) return true;
            if (spec.includes('md-editor-setup')) return true;
            return false;
        });
        expect(hits).toEqual([]);
    });

    it('md-editor-setup stays a sibling of MdPreview (imported from the route wrappers, not main)', () => {
        for (const rel of ['src/lib/md-home.ts', 'src/lib/md-post-detail.ts', 'src/lib/md-admin.ts']) {
            const src = read(rel);
            expect(src, rel).toMatch(/md-editor-setup/);
            expect(src, rel).toMatch(/md-editor-rt\/lib\/style\.css/);
        }
        expect(read('src/lib/md-home.ts')).toMatch(/\bHome\b/);
        expect(read('src/lib/md-post-detail.ts')).toMatch(/\bPostDetail\b/);
        expect(read('src/lib/md-admin.ts')).toMatch(/\bAdmin\b/);
    });

    it('does not drop rules from the default stylesheet (split is JS-only)', () => {
        // Guard: this change must not touch src/index.css.
        // The file is large; just assert it still exists and still has the
        // preview/base selectors the CSS-order work depends on.
        const css = read('src/index.css');
        expect(css.length).toBeGreaterThan(10_000);
        expect(css).toMatch(/\.md-editor-preview/);
        expect(css).toMatch(/:root/);
    });
});

describe('Track #2063 JS split (production dist, if built)', () => {
    const htmlPath = path.join(root, 'dist/index.html');
    const hasDist = fs.existsSync(htmlPath);

    it('the entry module is much smaller than the pre-split 4.29 MB bundle and does not contain mermaid', function () {
        if (!hasDist) {
            // Source tests above still run; build check is asserted after `npm run build`.
            return;
        }
        const html = fs.readFileSync(htmlPath, 'utf8');
        const m = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/);
        expect(m, 'dist/index.html should reference /assets/index-*.js').toBeTruthy();
        const entry = path.join(root, 'dist', m![1]);
        expect(fs.existsSync(entry)).toBe(true);
        const stat = fs.statSync(entry);
        // Pre-split entry was 4,291,722 bytes. A successful split leaves the
        // entry under 800 KiB (react + app chrome); editor/mermaid are async.
        expect(stat.size).toBeLessThan(800 * 1024);
        const src = fs.readFileSync(entry, 'utf8');
        expect(src).not.toMatch(/mermaid\.initialize/);
        expect(src).not.toMatch(/Failed to load mermaid module/);
        // React must not be pulled from the md-editor chunk (that would
        // modulepreload ~1 MB of editor on every page).
        expect(src).not.toMatch(/from["']\.\/md-editor-/);
        expect(src).not.toMatch(/from["']\.\/mermaid-/);
        expect(src).not.toMatch(/from["']\.\/style-/);
        expect(html).not.toMatch(/rel="modulepreload"[^>]+md-editor-/);
        expect(html).not.toMatch(/rel="modulepreload"[^>]+mermaid-/);
        expect(html).not.toMatch(/rel="modulepreload"[^>]+style-/);
        // Default stylesheet first among stylesheets; editor CSS may follow.
        const cssLinks = [...html.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((x) => x[0]);
        expect(cssLinks[0]).toMatch(/\/assets\/index-[^"]+\.css/);
        expect(cssLinks.some((l) => /md-editor-/.test(l))).toBe(false);
    });
});
