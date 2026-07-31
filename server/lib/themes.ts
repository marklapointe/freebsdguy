/**
 * Theme catalog helpers — list JSON themes from themeDir, path-safe names.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const __themesModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function isValidThemeId(id: string): boolean {
    return THEME_NAME_RE.test(id);
}

export function themeFilePath(themeDir: string, id: string): string | null {
    if (!isValidThemeId(id)) return null;
    const filePath = path.join(themeDir, `${id}.json`);
    if (!isSafePath(themeDir, filePath)) return null;
    return filePath;
}

/** Package/repo layout: server/themes next to server/lib, or cwd/server/themes. */
export function shippedThemesDir(): string {
    const candidates = [
        path.resolve(__themesModuleDir, '..', 'themes'), // server/lib → server/themes
        path.resolve(process.cwd(), 'server/themes'),
        path.resolve(process.cwd(), 'themes')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return candidates[0];
}

/** Configured theme dir first, then shipped catalog (repo / package tree). */
export function themeSearchDirs(configuredDir: string): string[] {
    const dirs: string[] = [];
    if (configuredDir) dirs.push(path.resolve(configuredDir));
    const shipped = shippedThemesDir();
    if (!dirs.some((d) => path.resolve(d) === path.resolve(shipped))) dirs.push(shipped);
    return dirs.filter((d) => d && fs.existsSync(d));
}

/**
 * Ensure every complete shipped theme JSON exists under the runtime themeDir
 * (e.g. /var/db/mdweb/themes). Missing files are copied; existing files are left alone
 * so admin color overrides are preserved.
 */
export function ensureRuntimeThemeCatalog(configuredDir: string): { copied: string[]; total: number } {
    const dest = resolveThemeDir(configuredDir);
    const shipped = shippedThemesDir();
    const copied: string[] = [];
    if (!fs.existsSync(shipped)) {
        return { copied, total: listThemeIds(dest).length };
    }
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    for (const f of fs.readdirSync(shipped)) {
        if (!f.endsWith('.json')) continue;
        const id = f.replace(/\.json$/, '');
        if (!isValidThemeId(id)) continue;
        const src = path.join(shipped, f);
        if (!readThemeFile(src)) continue;
        const target = path.join(dest, f);
        if (!fs.existsSync(target)) {
            try {
                fs.copyFileSync(src, target);
                copied.push(id);
            } catch {
                /* non-fatal */
            }
        }
    }
    return { copied, total: listThemeIds(dest).length };
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

export type ThemeMode = 'light' | 'dark';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
    const h = hex.replace('#', '').trim();
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16)
        };
    }
    if (h.length !== 6 || Number.isNaN(parseInt(h, 16))) return null;
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

function toHex(r: number, g: number, b: number): string {
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB relative luminance 0..1 (WCAG). */
export function relativeLuminance(hex: string): number {
    const p = parseHex(hex);
    if (!p) return 0;
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b);
}

export function contrastRatio(a: string, b: string): number {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
    const p = parseHex(hex);
    if (!p) return null;
    const r = p.r / 255;
    const g = p.g / 255;
    const b = p.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    switch (max) {
        case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
        case g:
            h = ((b - r) / d + 2) / 6;
            break;
        default:
            h = ((r - g) / d + 4) / 6;
            break;
    }
    return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    const hh = ((h % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(1, s));
    const ll = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;
    let rp = 0,
        gp = 0,
        bp = 0;
    if (hh < 60) {
        rp = c;
        gp = x;
    } else if (hh < 120) {
        rp = x;
        gp = c;
    } else if (hh < 180) {
        gp = c;
        bp = x;
    } else if (hh < 240) {
        gp = x;
        bp = c;
    } else if (hh < 300) {
        rp = x;
        bp = c;
    } else {
        rp = c;
        bp = x;
    }
    return toHex((rp + m) * 255, (gp + m) * 255, (bp + m) * 255);
}

/** Preserve hue/sat of DNA color; pin lightness for mode-coherent families. */
function withLightness(hex: string, l: number, satScale = 1): string {
    const hsl = hexToHsl(hex);
    if (!hsl) return hex;
    return hslToHex(hsl.h, Math.min(1, hsl.s * satScale), l);
}

/** Nudge foreground lightness until contrast vs bg is acceptable. */
function ensureContrast(fg: string, bg: string, minRatio = 3.5): string {
    if (contrastRatio(fg, bg) >= minRatio) return fg;
    const bgL = relativeLuminance(bg);
    const wantLight = bgL < 0.45;
    let out = fg;
    for (let i = 0; i < 24; i++) {
        if (contrastRatio(out, bg) >= minRatio) return out;
        const hsl = hexToHsl(out);
        if (!hsl) return out;
        const step = wantLight ? 0.04 : -0.04;
        out = hslToHex(hsl.h, hsl.s, Math.max(0.04, Math.min(0.96, hsl.l + step)));
    }
    return out;
}

/**
 * Surface tokens must all live in the same light or dark family so panels,
 * borders, and page bg never fight each other when the user toggles mode.
 * Hue is taken from the pack's secondary/bg DNA so the theme still feels like itself.
 */
function surfaceFamily(
    dna: string,
    mode: ThemeMode
): Pick<ThemeColors, '--bg' | '--secondary' | '--hover' | '--border'> {
    const hsl = hexToHsl(dna) || { h: 220, s: 0.12, l: 0.5 };
    // Large surfaces: keep a hint of hue, never neon wash
    const s = Math.min(hsl.s, mode === 'light' ? 0.22 : 0.4);
    if (mode === 'light') {
        return {
            '--bg': hslToHex(hsl.h, s * 0.35, 0.97),
            '--secondary': hslToHex(hsl.h, s * 0.45, 0.93),
            '--hover': hslToHex(hsl.h, s * 0.5, 0.89),
            '--border': hslToHex(hsl.h, s * 0.35, 0.8)
        };
    }
    return {
        '--bg': hslToHex(hsl.h, s * 0.55, 0.07),
        '--secondary': hslToHex(hsl.h, s * 0.65, 0.12),
        '--hover': hslToHex(hsl.h, s * 0.65, 0.16),
        '--border': hslToHex(hsl.h, s * 0.45, 0.28)
    };
}

/**
 * True when all surface tokens share the mode family and body text contrasts
 * against the page background. Used by tests + as a derivation invariant.
 */
export function isThemeModeCoherent(colors: ThemeColors, mode: ThemeMode): boolean {
    const bg = colors['--bg'];
    const text = colors['--text'];
    const secondary = colors['--secondary'];
    const hover = colors['--hover'];
    const border = colors['--border'];
    if (!bg || !text || !secondary || !hover || !border) return false;
    const bgL = relativeLuminance(bg);
    const secL = relativeLuminance(secondary);
    const hoverL = relativeLuminance(hover);
    const borderL = relativeLuminance(border);
    const textL = relativeLuminance(text);
    if (mode === 'light') {
        // All surfaces light; text dark; panels not darker than "mid"
        if (bgL < 0.72 || secL < 0.55 || hoverL < 0.5 || borderL < 0.4) return false;
        if (textL > 0.45) return false;
        if (contrastRatio(text, bg) < 3) return false;
        return true;
    }
    // dark: all surfaces dark; text light
    if (bgL > 0.28 || secL > 0.4 || hoverL > 0.45 || borderL > 0.55) return false;
    if (textL < 0.5) return false;
    if (contrastRatio(text, bg) < 3) return false;
    return true;
}

/**
 * Foreground for text/icons sitting on a solid color chip (buttons, badges).
 * Picks black or white — whichever contrasts better. Never white-on-white.
 */
export function onColorFor(bgHex: string): string {
    const white = contrastRatio('#ffffff', bgHex);
    const black = contrastRatio('#0a0a0a', bgHex);
    return white >= black ? '#ffffff' : '#0a0a0a';
}

/**
 * Nudge mid-tone fills until black or white text reaches min contrast.
 * Prevents unreadable chips (pale cyan + white, muddy gray + either).
 */
export function ensureChipFill(hex: string, minRatio = 3.5): string {
    let f = hex;
    for (let i = 0; i < 28; i++) {
        const on = onColorFor(f);
        if (contrastRatio(on, f) >= minRatio) return f;
        const hsl = hexToHsl(f);
        if (!hsl) return f;
        // If white text is the winner, fill is still too light → darken.
        // If black text wins, fill is still too dark/muddy → lighten.
        if (on === '#ffffff') {
            f = hslToHex(hsl.h, Math.min(1, hsl.s * 1.02), Math.max(0.04, hsl.l - 0.035));
        } else {
            f = hslToHex(hsl.h, Math.min(1, hsl.s * 1.02), Math.min(0.96, hsl.l + 0.035));
        }
    }
    return f;
}

/**
 * Attach --on-accent / --on-primary for buttons that paint on those fills.
 * May slightly adjust accent/primary when mid-tones would fail chip contrast.
 */
export function withOnColors(colors: ThemeColors): ThemeColors {
    const accent = ensureChipFill(colors['--accent'] || '#ef4444');
    const primary = ensureChipFill(colors['--primary'] || '#3b82f6');
    return {
        ...colors,
        '--accent': accent,
        '--primary': primary,
        '--on-accent': onColorFor(accent),
        '--on-primary': onColorFor(primary)
    };
}

/**
 * Derive a light or dark palette from a theme's canonical colors.
 * Each theme pack keeps one JSON file; the opposite mode is synthesized so every
 * theme supports light + dark switching without doubling files on disk.
 *
 * Surfaces always form one coherent family (never mixed light panels on dark page).
 * Accent/primary keep the pack's hue DNA and are contrast-corrected against --bg.
 */
export function deriveThemeMode(colors: ThemeColors, mode: ThemeMode): ThemeColors {
    const baseMode =
        colors.mdEditorTheme === 'light' || colors.mdEditorTheme === 'dark'
            ? colors.mdEditorTheme
            : guessEditorTheme(colors);

    const primary = colors['--primary'] || '#3b82f6';
    const accent = colors['--accent'] || '#ef4444';
    const site = colors['--site-name-color'] || accent;
    const surfaceDna = colors['--secondary'] || colors['--bg'] || primary;

    // Canonical mode: still normalize surfaces into a coherent family so even
    // hand-authored packs stay consistent when the user picks that mode.
    // Keep accent DNA from the file; only re-pin surface/text families when needed.
    if (baseMode === mode && isThemeModeCoherent(colors, mode)) {
        return withOnColors({ ...colors, mdEditorTheme: mode });
    }

    const surfaces = surfaceFamily(surfaceDna, mode);
    const bg = surfaces['--bg'];

    if (mode === 'light') {
        const text = ensureContrast(withLightness(primary, 0.16, 0.9), bg, 4);
        // Keep accent/primary saturated enough for chips, but readable on page bg
        const primaryOut = ensureContrast(withLightness(primary, 0.34, 1), bg, 3);
        const accentOut = ensureContrast(withLightness(accent, 0.4, 1), bg, 3);
        const siteOut = ensureContrast(withLightness(site, 0.36, 1), bg, 3);
        return withOnColors({
            mdEditorTheme: 'light',
            ...surfaces,
            '--text': text,
            '--primary': primaryOut,
            '--accent': accentOut,
            '--site-name-color': siteOut
        });
    }

    const text = ensureContrast(withLightness(primary, 0.9, 0.85), bg, 4);
    const primaryOut = ensureContrast(withLightness(primary, 0.72, 1), bg, 3);
    const accentOut = ensureContrast(withLightness(accent, 0.62, 1), bg, 3);
    const siteOut = ensureContrast(withLightness(site, 0.68, 1), bg, 3);
    return withOnColors({
        mdEditorTheme: 'dark',
        ...surfaces,
        '--text': text,
        '--primary': primaryOut,
        '--accent': accentOut,
        '--site-name-color': siteOut
    });
}

/** Load theme and optionally force light/dark variant. Always includes on-* chip colors. */
export function loadThemeColorsForMode(
    themeDir: string,
    id: string,
    mode?: ThemeMode | string | null
): ThemeColors | null {
    const base = loadThemeColors(themeDir, id);
    if (!base) return null;
    if (mode !== 'light' && mode !== 'dark') return withOnColors(base);
    return deriveThemeMode(base, mode);
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
    'amiga': 'Amiga Workbench',
    'apple-green': 'Apple II Green',
    'c64': 'Commodore 64 Blue',
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
    'vic20': 'VIC-20',
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
    // Base packs only — light/dark is a mode, not a separate catalog id
    return listThemeIds(dir)
        .filter((id) => !id.endsWith('-light') && !id.endsWith('-dark'))
        .map((id) => themeMetaFromId(id, loadThemeColors(dir, id)));
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
