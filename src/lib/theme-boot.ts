/**
 * First-paint theme boot (Track #1682, Mark 2026-11-05).
 * Critical CSS + a tiny blocking script keep the page from flashing the
 * unstyled browser default (or the wrong light/dark) before the theme pack
 * arrives. Transitions stay off while html.mdweb-booting.
 *
 * The boot script only sets data-theme-mode + mdweb-booting. Background and
 * text colors come from #mdweb-critical (attribute selectors and optional
 * server-injected pack vars) — not from inline styles that would override them.
 */

/** Defaults match server/themes/dark.json and light.json editorial packs. */
export const CRITICAL_CSS = `html{color-scheme:dark;background:#0e1116;color:#e6e8eb;--bg:#0e1116;--text:#e6e8eb;--primary:#f2f4f7;--accent:#a5b4fc}
html[data-theme-mode="light"]{color-scheme:light;background:#fbfaf7;color:#1f2328;--bg:#fbfaf7;--text:#1f2328;--primary:#111418;--accent:#4338ca}
html.mdweb-booting,html.mdweb-booting *{transition:none!important;animation:none!important}
body{background:var(--bg,#0e1116);color:var(--text,#e6e8eb);margin:0}`;

/** Inline <script> body (no module): runs before first paint when in <head>. */
export function bootThemeSnippet(): string {
    return `(function(){try{var m=localStorage.getItem('themeMode');if(m!=='light'&&m!=='dark')m='dark';var el=document.documentElement;el.setAttribute('data-theme-mode',m);el.classList.add('mdweb-booting')}catch(e){}})();`;
}

/** HTML fragment for <head> — keep index.html identical to this. */
export function headBootHtml(): string {
    return `<style id="mdweb-critical">${CRITICAL_CSS}</style>\n  <script>${bootThemeSnippet()}</script>`;
}

/** Drop the booting class after the real theme pack has painted (next frames). */
export function clearBootingClass(): void {
    const el = document.documentElement;
    const go = () => el.classList.remove('mdweb-booting');
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(go));
    } else {
        go();
    }
    // Hidden tabs may not run rAF; clear anyway after a short timeout.
    if (typeof setTimeout === 'function') setTimeout(go, 2000);
}
