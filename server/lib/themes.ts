/**
 * Theme catalog helpers — list JSON themes from themeDir, path-safe names.
 */
import fs from 'fs';
import path from 'path';
import { isSafePath } from './safe-path.ts';

export interface ThemeColors {
    [key: string]: string;
}

export interface ThemeMeta {
    id: string;
    label: string;
    /** md-editor-rt only supports light|dark */
    mdEditorTheme: 'light' | 'dark';
    description?: string;
}

const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidThemeId(id: string): boolean {
    return THEME_NAME_RE.test(id);
}

export function themeFilePath(themeDir: string, id: string): string | null {
    if (!isValidThemeId(id)) return null;
    const filePath = path.join(themeDir, `${id}.json`);
    if (!isSafePath(themeDir, filePath)) return null;
    return filePath;
}

export function shippedThemesDir(): string {
    return path.resolve(process.cwd(), 'server/themes');
}

/** Configured theme dir first, then shipped catalog (repo / package tree). */
export function themeSearchDirs(configuredDir: string): string[] {
    const dirs: string[] = [];
    if (configuredDir) dirs.push(configuredDir);
    const shipped = shippedThemesDir();
    if (!dirs.includes(shipped)) dirs.push(shipped);
    return dirs.filter((d) => d && fs.existsSync(d));
}

/** Prefer configured dir for writes; fall back to shipped for reads via search. */
export function resolveThemeDir(configuredDir: string): string {
    if (configuredDir && fs.existsSync(configuredDir)) return configuredDir;
    const shipped = shippedThemesDir();
    if (fs.existsSync(shipped)) return shipped;
    return configuredDir || shipped;
}

function readThemeFile(filePath: string): ThemeColors | null {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const colors: ThemeColors = {};
        for (const [k, v] of Object.entries(raw)) {
            if (k.startsWith('--') && typeof v === 'string') {
                colors[k] = v;
            }
        }
        if (raw.mdEditorTheme === 'light' || raw.mdEditorTheme === 'dark') {
            colors.mdEditorTheme = raw.mdEditorTheme;
        }
        // Incomplete stubs (e.g. test fixtures) are ignored so shipped catalog wins
        const required = ['--bg', '--text', '--primary', '--secondary', '--accent'];
        if (!required.every((k) => colors[k])) return null;
        return colors;
    } catch {
        return null;
    }
}

export function listThemeIds(themeDir: string): string[] {
    const ids = new Set<string>();
    for (const dir of themeSearchDirs(themeDir)) {
        try {
            for (const f of fs.readdirSync(dir)) {
                if (!f.endsWith('.json')) continue;
                const id = f.replace(/\.json$/, '');
                if (!isValidThemeId(id)) continue;
                // Only count complete themes
                if (readThemeFile(path.join(dir, f))) ids.add(id);
            }
        } catch {
            /* skip unreadable dirs */
        }
    }
    if (ids.size === 0) return ['dark', 'light'];
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

export function loadThemeColors(themeDir: string, id: string): ThemeColors | null {
    if (!isValidThemeId(id)) return null;
    // Configured dir overrides shipped when complete
    for (const dir of themeSearchDirs(themeDir)) {
        const filePath = themeFilePath(dir, id);
        if (!filePath || !fs.existsSync(filePath)) continue;
        const colors = readThemeFile(filePath);
        if (colors) return colors;
    }
    return null;
}

const THEME_LABELS: Record<string, string> = {
    dark: 'Dark',
    light: 'Light',
    'miami-vice': 'Miami Vice',
    'miami-cyberpunk': 'Miami Cyberpunk',
    'retro-crt': 'Retro CRT',
    win95: 'Windows 95',
    sunos: 'SunOS',
    cde: 'CDE / Motif',
    'modern-glass': 'Modern Glass',
    'c64-green': 'Commodore 64',
    'zx-spectrum': 'ZX Spectrum',
    'dos-prompt': 'DOS Prompt',
    gameboy: 'Game Boy',
    'nes-classic': 'NES Classic',
    'snes-pastel': 'SNES Pastel',
    doom: 'Doom',
    matrix: 'Matrix',
    vaporwave: 'Vaporwave',
    'arcade-neon': 'Arcade Neon',
    'star-wars': 'Star Wars',
    portal: 'Portal / Aperture',
    'zelda-green': 'Zelda Green',
    'sonic-blue': 'Sonic Blue',
    pokemon: 'Pokémon',
    minecraft: 'Minecraft',
    amiga: 'Amiga Workbench',
    'apple-green': 'Apple II Green',
    c64: 'Commodore 64 Blue',
    'crt-amber': 'CRT Amber',
    'crt-blue': 'CRT Blue',
    'crt-emerald': 'CRT Emerald',
    'crt-green': 'CRT Green',
    'crt-plasma': 'CRT Plasma',
    'crt-softamber': 'CRT Soft Amber',
    'dos-norton': 'DOS Norton',
    'ibm-3270': 'IBM 3270',
    'ibm-cga': 'IBM CGA',
    'pet-green': 'Commodore PET',
    vic20: 'VIC-20',
    'vt220-white': 'VT220 White',
};

export function themeMetaFromId(id: string, colors?: ThemeColors | null): ThemeMeta {
    const label =
        THEME_LABELS[id] ||
        id
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    const mdEditorTheme =
        colors?.mdEditorTheme === 'light' || colors?.mdEditorTheme === 'dark'
            ? colors.mdEditorTheme
            : guessEditorTheme(colors);
    return { id, label, mdEditorTheme };
}

function guessEditorTheme(colors?: ThemeColors | null): 'light' | 'dark' {
    if (!colors?.['--bg']) return 'dark';
    const bg = colors['--bg'].replace('#', '');
    if (bg.length < 6) return 'dark';
    const r = parseInt(bg.slice(0, 2), 16);
    const g = parseInt(bg.slice(2, 4), 16);
    const b = parseInt(bg.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? 'light' : 'dark';
}

export function listThemeCatalog(themeDir: string): ThemeMeta[] {
    const dir = resolveThemeDir(themeDir);
    return listThemeIds(dir).map((id) => themeMetaFromId(id, loadThemeColors(dir, id)));
}

/** CSS variable keys required by the MDWeb UI */
export const REQUIRED_THEME_KEYS = [
    '--primary',
    '--secondary',
    '--accent',
    '--text',
    '--bg',
    '--border',
    '--hover',
    '--site-name-color'
] as const;
