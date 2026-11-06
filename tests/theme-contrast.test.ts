/**
 * Track #1682 slice 1 — WCAG AA contrast across every shipped theme.
 *
 * Pairs checked:
 *   1. link/title colour (`--link`, falling back to `--accent`) vs --bg
 *   2. body text (--text) vs --bg
 *   3. header/nav text (--text, the nav's default) vs --secondary
 *
 * dark.json and light.json are asserted >= 4.5; every other theme is reported.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { contrastRatio, type ThemeColors } from '../server/lib/themes';

const themesDir = path.resolve(process.cwd(), 'server/themes');

/** Resolve the colour used for post titles / links in a theme. */
function linkColour(theme: ThemeColors): string | undefined {
    return theme['--link'] || theme['--accent'];
}

type Check = { label: string; fg: string; bg: string; ratio: number };

function check(label: string, fg: string, bg: string): Check {
    return { label, fg, bg, ratio: fg && bg ? contrastRatio(fg, bg) : 0 };
}

describe('Theme contrast (WCAG AA 4.5:1)', () => {
    it('dark.json and light.json meet 4.5:1 for all three pairs', () => {
        for (const file of ['dark.json', 'light.json']) {
            const theme = JSON.parse(
                fs.readFileSync(path.join(themesDir, file), 'utf8')
            ) as ThemeColors;
            const label = (n: string) => `${file} ${n}`;
            const checks: Check[] = [
                check(label(`link/title vs --bg`), linkColour(theme), theme['--bg']),
                check(label(`--text vs --bg`), theme['--text'], theme['--bg']),
                check(label(`header(text) vs --secondary`), theme['--text'], theme['--secondary']),
                // the site title is drawn in --site-name-color on the nav (--secondary)
                check(label(`site title vs --secondary`), theme['--site-name-color'] || theme['--accent'], theme['--secondary'])
            ];
            for (const c of checks) {
                expect(c.ratio, c.label).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('every theme ships required surface/foreground tokens', () => {
        for (const f of fs.readdirSync(themesDir)) {
            if (!f.endsWith('.json')) continue;
            const theme = JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8')) as ThemeColors;
            for (const key of ['--bg', '--text', '--secondary', '--accent', '--site-name-color'] as const) {
                expect(theme[key], `${f} missing ${key}`).toBeTruthy();
            }
        }
    });

    it('reports the contrast ratio for every theme (regression aid)', () => {
        const report: Record<string, number[]> = {};
        for (const f of fs.readdirSync(themesDir)) {
            if (!f.endsWith('.json')) continue;
            const theme = JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8')) as ThemeColors;
            const link = linkColour(theme);
            report[f] = [
                link && theme['--bg'] ? contrastRatio(link, theme['--bg']) : 0,
                theme['--text'] && theme['--bg'] ? contrastRatio(theme['--text'], theme['--bg']) : 0,
                theme['--text'] && theme['--secondary']
                    ? contrastRatio(theme['--text'], theme['--secondary'])
                    : 0
            ];
        }
        // dark & light must pass both checks we assert on.
        expect(report['dark.json'][0]).toBeGreaterThanOrEqual(4.5);
        expect(report['light.json'][0]).toBeGreaterThanOrEqual(4.5);
    });
});