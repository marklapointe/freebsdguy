/** The version in the package.json shipped beside server/ (not npm_package_version, which rc.d never sets). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
let cached: string | undefined;

export function packageVersion(): string {
    if (cached) return cached;
    for (const p of [path.resolve(here, '..', '..', 'package.json'), path.resolve(process.cwd(), 'package.json')]) {
        try {
            const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
            if (typeof v === 'string' && v) return (cached = v);
        /* v8 ignore start */
        } catch {
            /* try next */
        }
        /* v8 ignore stop */
    }
    /* v8 ignore next */
    return process.env.npm_package_version || 'unknown';
}
