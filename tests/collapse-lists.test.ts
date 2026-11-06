/**
 * Track #1682 (Mark, 2026-11-03 11:16 CT): long "Updates" lists on live posts
 * show the latest 3 entries, fade out below, and a real "Show more" button
 * expands the whole list ("Show less" collapses it). Generic: any list right
 * after a heading or bold paragraph that starts with "Updates", or any list
 * after an element carrying data-mdweb-collapse. Without JS nothing is hidden.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { enhanceCollapsibleLists } from '../src/lib/collapse-lists';

const items = (n: number) => Array.from({ length: n }, (_, i) => `<li>entry ${i + 1}</li>`).join('');
let root: HTMLElement;
beforeEach(() => { root = document.createElement('div'); document.body.innerHTML = ''; document.body.appendChild(root); });
const btn = () => root.querySelector('button.mdweb-collapse-toggle') as HTMLButtonElement | null;

describe('enhanceCollapsibleLists', () => {
    it('collapses the list after a bold "Updates" paragraph to 3 items with a Show more button', () => {
        root.innerHTML = `<p><strong>Updates (newest first)</strong></p><ul>${items(8)}</ul>`;
        enhanceCollapsibleLists(root);
        const ul = root.querySelector('ul')!;
        expect(ul.classList.contains('mdweb-collapsible')).toBe(true);
        expect(ul.classList.contains('is-collapsed')).toBe(true);
        expect([...ul.children].filter((li) => (li as HTMLElement).classList.contains('mdweb-collapse-hidden')).length).toBe(5);
        const b = btn()!;
        expect(b.type).toBe('button');
        expect(b.getAttribute('aria-expanded')).toBe('false');
        expect(b.getAttribute('aria-controls')).toBe(ul.id);
        expect(b.textContent).toBe('Show 5 more');
    });
    it('also works after an "Updates" heading', () => {
        root.innerHTML = `<h2>Updates</h2><ol>${items(5)}</ol>`;
        enhanceCollapsibleLists(root);
        expect(btn()).not.toBeNull();
    });
    it('toggles to Show less and back (keyboard: a native button fires click on Enter/Space)', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(6)}</ul>`;
        enhanceCollapsibleLists(root);
        const ul = root.querySelector('ul')!;
        btn()!.click();
        expect(btn()!.getAttribute('aria-expanded')).toBe('true');
        expect(btn()!.textContent).toBe('Show less');
        expect([...ul.children].some((li) => (li as HTMLElement).classList.contains('mdweb-collapse-hidden'))).toBe(false);
        expect(ul.classList.contains('is-collapsed')).toBe(false);
        btn()!.click();
        expect(btn()!.getAttribute('aria-expanded')).toBe('false');
        expect(ul.classList.contains('is-collapsed')).toBe(true);
    });
    it('leaves short lists and unrelated lists alone', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(3)}</ul><h2>Parts</h2><ul>${items(9)}</ul>`;
        enhanceCollapsibleLists(root);
        expect(btn()).toBeNull();
        expect(root.querySelectorAll('.mdweb-collapse-hidden').length).toBe(0);
    });
    it('honours a data-mdweb-collapse marker with a custom count', () => {
        root.innerHTML = `<p data-mdweb-collapse="2">Changelog</p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        expect(root.querySelectorAll('li.mdweb-collapse-hidden').length).toBe(3);
    });
    it('ignores plain prose that merely starts with "Updates"', () => {
        root.innerHTML = `<p>Updates to the cabling are below.</p><ul>${items(6)}</ul>`;
        enhanceCollapsibleLists(root);
        expect(btn()).toBeNull();
    });
    it('malformed marker falls back to 3', () => {
        root.innerHTML = `<p data-mdweb-collapse="2oops">x</p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        expect(root.querySelectorAll('li.mdweb-collapse-hidden').length).toBe(2);
    });
    it('never reuses an id already on the page', () => {
        root.innerHTML = `<div id="mdweb-collapse-1"></div><p><strong>Updates</strong></p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        expect(root.querySelector('ul')!.id).not.toBe('mdweb-collapse-1');
    });
    it('recreates a missing toggle and removes an orphan one', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        btn()!.remove();
        enhanceCollapsibleLists(root);
        expect(btn()).not.toBeNull();
        root.querySelector('ul')!.remove();
        enhanceCollapsibleLists(root);
        expect(btn()).toBeNull();
    });
    it('reconciles count changes, added items and lost eligibility', () => {
        root.innerHTML = `<p data-mdweb-collapse="2">x</p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        const p = root.querySelector('p')!; const ul = root.querySelector('ul')!;
        p.setAttribute('data-mdweb-collapse', '4');
        enhanceCollapsibleLists(root);
        expect(btn()!.textContent).toBe('Show 1 more');
        ul.insertAdjacentHTML('beforeend', '<li>new</li>');
        enhanceCollapsibleLists(root);
        expect(btn()!.textContent).toBe('Show 2 more');
        expect((ul.lastElementChild as HTMLElement).classList.contains('mdweb-collapse-hidden')).toBe(true);
        p.removeAttribute('data-mdweb-collapse');
        enhanceCollapsibleLists(root);
        expect(btn()).toBeNull();
        expect(ul.querySelectorAll('.mdweb-collapse-hidden').length).toBe(0);
    });
    it('keeps author hidden attributes and the expanded state across re-runs', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul><li>a</li><li hidden>b</li>${items(4)}</ul>`;
        enhanceCollapsibleLists(root);
        btn()!.click();
        expect((root.querySelectorAll('li')[1] as HTMLElement).hidden).toBe(true);
        enhanceCollapsibleLists(root);
        expect(btn()!.getAttribute('aria-expanded')).toBe('true');
        expect(btn()!.getAttribute('aria-label')).toMatch(/^Show less/);
    });
    it('counts only entries it can reveal, and skips lists with nothing to reveal', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(3)}<li hidden>x</li><li>y</li></ul>`;
        enhanceCollapsibleLists(root);
        expect(btn()!.textContent).toBe('Show 1 more');
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(3)}<li hidden>x</li></ul>`;
        enhanceCollapsibleLists(root);
        expect(btn()).toBeNull();
    });
    it('restores a list that lost both its toggle and its marker', () => {
        root.innerHTML = `<p data-mdweb-collapse="2">x</p><ul>${items(5)}</ul>`;
        enhanceCollapsibleLists(root);
        btn()!.click(); btn()!.remove();
        root.querySelector('p')!.removeAttribute('data-mdweb-collapse');
        enhanceCollapsibleLists(root);
        const ul = root.querySelector('ul')!;
        expect(ul.querySelectorAll('.mdweb-collapse-hidden').length).toBe(0);
        expect(ul.dataset.mdwebExpanded).toBeUndefined();
    });
    it('is idempotent (re-render does not add a second button)', () => {
        root.innerHTML = `<p><strong>Updates</strong></p><ul>${items(6)}</ul>`;
        enhanceCollapsibleLists(root);
        enhanceCollapsibleLists(root);
        expect(root.querySelectorAll('button.mdweb-collapse-toggle').length).toBe(1);
    });
});

describe('collapse fade CSS', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    it('fades the last visible entries into the page background in both modes', () => {
        expect(css).toMatch(/\.mdweb-collapsible\.is-collapsed::after\s*\{[^}]*linear-gradient\([^)]*var\(--mdweb-fade-bg\)/);
        expect(css).toMatch(/--mdweb-fade-bg:\s*var\(--bg\)/);
        expect(css).toMatch(/\.mdweb-collapsible > li\.mdweb-collapse-hidden\s*\{\s*display:\s*none\s*!important/);
    });
    it('without JS nothing is hidden by CSS alone (hiding only under .is-collapsed set by script)', () => {
        expect(css).not.toMatch(/\.md-editor-preview\s+ul\s+li:nth-child\([^)]*\)\s*\{[^}]*display:\s*none/);
    });
});
