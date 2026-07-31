/**
 * Seed showcase Markdown posts into postsDir (missing files only).
 * Never overwrites user-edited posts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Shipped demo posts live next to server code: server/posts/*.md */
export function shippedPostsDir(): string {
    const candidates = [
        path.resolve(__dirname, '..', 'posts'),
        path.resolve(process.cwd(), 'server/posts')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return candidates[0];
}

const DEMO_SLUGS = [
    'welcome.md',
    'crt-dreams-and-amber-glow.md',
    'kitchen-sink-markdown.md',
    'code-from-the-terminal.md',
    'math-for-the-rest-of-us.md',
    'diagrams-over-coffee.md'
];

export function ensureDemoPosts(postsDir: string): { copied: string[]; total: number } {
    const srcDir = shippedPostsDir();
    const copied: string[] = [];
    if (!fs.existsSync(srcDir)) {
        return { copied, total: 0 };
    }
    if (!fs.existsSync(postsDir)) {
        fs.mkdirSync(postsDir, { recursive: true });
    }
    for (const name of DEMO_SLUGS) {
        const src = path.join(srcDir, name);
        const dest = path.join(postsDir, name);
        if (!fs.existsSync(src)) continue;
        if (fs.existsSync(dest)) continue;
        try {
            fs.copyFileSync(src, dest);
            copied.push(name.replace(/\.md$/, ''));
        } catch {
            /* non-fatal */
        }
    }
    const total = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).length;
    return { copied, total };
}
