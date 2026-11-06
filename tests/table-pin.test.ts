/**
 * Optional pin columns (Track #1682, Mark 2026-11-05):
 * data-mdweb-pin="Model,Engine,Setup" before a table marks those header cells
 * (and matching body cells). A "Pin columns" toggle (off by default, remembered
 * in localStorage) makes them position:sticky while scrolling sideways.
 * Works in the page, on mobile widths, and in the Expand popup. No per-table
 * special-casing: any table with the marker gets the same treatment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    parsePinSpec,
    decoratePinColumns,
    applyPinColumns,
    addPinToggles,
    pinStorageKey,
    setPinEnabled,
    isPinEnabled,
    syncPinLeftOffsets,
} from '../src/lib/table-tools';

const wide = (pinMarker = true) =>
    `${pinMarker ? '<p data-mdweb-pin="Model,Engine,Setup" hidden></p>' : ''}
     <div class="mdweb-table-wrap"><table>
       <thead><tr><th>Model</th><th>Engine</th><th>Setup</th><th>Speed</th><th>Math</th><th>Coding</th><th>Science</th><th>Status</th></tr></thead>
       <tbody>
         <tr><td>Flint</td><td>vLLM</td><td>Single Node</td><td>36</td><td>92</td><td>10</td><td>19</td><td>Running</td></tr>
         <tr><td>Ornith</td><td>TensorFold</td><td>Single Node</td><td>74</td><td>90</td><td>8</td><td>151</td><td>Done</td></tr>
       </tbody>
     </table></div>`;

describe('parsePinSpec', () => {
    it('splits comma names and drops empties', () => {
        expect(parsePinSpec('Model, Engine, Setup')).toEqual(['Model', 'Engine', 'Setup']);
        expect(parsePinSpec('')).toEqual([]);
        expect(parsePinSpec(null)).toEqual([]);
    });
});

describe('decoratePinColumns / applyPinColumns', () => {
    let root: HTMLDivElement;
    beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
    afterEach(() => { root.remove(); localStorage.clear(); });

    it('marks matching th/td with data-mdweb-pin from a preceding marker', () => {
        root.innerHTML = wide(true);
        expect(applyPinColumns(root)).toBe(1);
        const t = root.querySelector('table')!;
        const ths = [...t.tHead!.rows[0].cells];
        expect(ths[0].hasAttribute('data-mdweb-pin')).toBe(true);
        expect(ths[1].hasAttribute('data-mdweb-pin')).toBe(true);
        expect(ths[2].hasAttribute('data-mdweb-pin')).toBe(true);
        expect(ths[3].hasAttribute('data-mdweb-pin')).toBe(false);
        const td0 = t.tBodies[0].rows[0].cells[0];
        expect(td0.hasAttribute('data-mdweb-pin')).toBe(true);
        expect(t.dataset.mdwebPinReady).toBe('1');
    });

    it('is a no-op without a marker', () => {
        root.innerHTML = wide(false);
        expect(applyPinColumns(root)).toBe(0);
        expect(root.querySelectorAll('[data-mdweb-pin]').length).toBe(0);
    });

    it('decoratePinColumns is idempotent', () => {
        root.innerHTML = wide(true);
        const t = root.querySelector('table')!;
        expect(decoratePinColumns(t, ['Model', 'Engine'])).toBeGreaterThan(0);
        const n = root.querySelectorAll('[data-mdweb-pin]').length;
        expect(decoratePinColumns(t, ['Model', 'Engine'])).toBe(0);
        expect(root.querySelectorAll('[data-mdweb-pin]').length).toBe(n);
    });
});

describe('Pin columns toggle', () => {
    let root: HTMLDivElement;
    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        localStorage.clear();
    });
    afterEach(() => {
        root.remove();
        localStorage.clear();
        document.querySelectorAll('.mdweb-table-popup').forEach((el) => el.remove());
    });

    it('adds a Pin columns button off by default, remembers choice, toggles mdweb-pins-on', () => {
        root.innerHTML = wide(true);
        applyPinColumns(root);
        addPinToggles(root);
        const btn = root.querySelector('button.mdweb-table-pin') as HTMLButtonElement;
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(btn.textContent).toMatch(/^(Pin|Unpin) columns$/);
        const wrap = root.querySelector('.mdweb-table-wrap')!;
        expect(wrap.classList.contains('mdweb-pins-on')).toBe(false);

        btn.click();
        expect(btn.getAttribute('aria-pressed')).toBe('true');
                expect(wrap.classList.contains('mdweb-pins-on')).toBe(true);
        expect(isPinEnabled(pinStorageKey(root.querySelector('table')!))).toBe(true);

        // Remount: remembered on
        root.innerHTML = wide(true);
        applyPinColumns(root);
        addPinToggles(root);
        const btn2 = root.querySelector('button.mdweb-table-pin') as HTMLButtonElement;
        expect(btn2.getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('.mdweb-table-wrap')!.classList.contains('mdweb-pins-on')).toBe(true);

        btn2.click();
        expect(btn2.getAttribute('aria-pressed')).toBe('false');
        expect(isPinEnabled(pinStorageKey(root.querySelector('table')!))).toBe(false);
    });

    it('sets cumulative --mdweb-pin-left on pinned cells when on', () => {
        root.innerHTML = wide(true);
        applyPinColumns(root);
        const t = root.querySelector('table')!;
        // Fake widths so offsets are deterministic without layout (jsdom).
        for (const tr of t.rows) {
            [...tr.cells].forEach((c, i) => {
                const w = 40 + i * 10;
                Object.defineProperty(c, 'offsetWidth', { configurable: true, get: () => w });
                c.getBoundingClientRect = () => ({ width: w, height: 20, top: 0, left: 0, bottom: 20, right: w, x: 0, y: 0, toJSON() { return {}; } });
            });
        }
        const cells = [...t.tHead!.rows[0].cells];
        setPinEnabled(pinStorageKey(t), true);
        syncPinLeftOffsets(t);
        // left = sum of ALL preceding column widths (0, 40, 40+50)
        expect(cells[0].style.getPropertyValue('--mdweb-pin-left')).toBe('0px');
        expect(cells[1].style.getPropertyValue('--mdweb-pin-left')).toBe('40px');
        expect(cells[2].style.getPropertyValue('--mdweb-pin-left')).toBe('90px');
    });

    it('does not add a pin toggle when the table has no pin columns', () => {
        root.innerHTML = wide(false);
        applyPinColumns(root);
        addPinToggles(root);
        expect(root.querySelector('button.mdweb-table-pin')).toBeNull();
    });
});
