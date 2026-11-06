/**
 * Collapsible long lists in posts (Track #1682). Progressive enhancement: the
 * markdown renders the full list; this script hides entries past the first
 * `count` and adds a native <button> (aria-expanded, aria-controls) to toggle.
 *
 * A list is collapsible when the element right before it is
 *  - a heading whose text starts with "Updates", or a paragraph that is only a
 *    bold label starting with "Updates" (count 3), or
 *  - any element with data-mdweb-collapse="N" (N a positive integer, else 3).
 * The first entries stay visible, so write such lists newest first.
 */
const DEFAULT_COUNT = 3;
const TOGGLE = 'mdweb-collapse-toggle';

function collapseCount(prev: Element | null): number | null {
    if (!prev) return null;
    const marker = prev.getAttribute('data-mdweb-collapse');
    if (marker !== null) {
        const n = Number(marker.trim());
        return Number.isInteger(n) && n > 0 ? n : DEFAULT_COUNT;
    }
    const text = (prev.textContent || '').trim();
    if (!/^updates\b/i.test(text)) return null;
    if (/^H[1-6]$/.test(prev.tagName)) return DEFAULT_COUNT;
    const only = prev.children.length === 1 ? prev.children[0] : null;
    if (prev.tagName === 'P' && only && /^(STRONG|B)$/.test(only.tagName) && (only.textContent || '').trim() === text) return DEFAULT_COUNT;
    return null;
}

function uniqueId(doc: Document): string {
    let id: string;
    let i = 0;
    do { id = `mdweb-collapse-${++i}`; } while (doc.getElementById(id));
    return id;
}

const HIDDEN = 'mdweb-collapse-hidden';

function apply(list: HTMLElement, button: HTMLButtonElement, count: number): void {
    const expanded = list.dataset.mdwebExpanded === 'true';
    const items = [...list.children] as HTMLElement[];
    // Our own class, so author `hidden` attributes are never touched.
    items.forEach((li, i) => li.classList.toggle(HIDDEN, !expanded && i >= count));
    const more = items.slice(count).filter((li) => !li.hidden).length;
    list.classList.toggle('is-collapsed', !expanded);
    list.dataset.mdwebCount = String(count);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show less' : `Show ${more} more`;
    button.setAttribute('aria-label', expanded ? `Show less: hide ${more} entries` : `Show ${more} more entries`);
}

function restore(list: HTMLElement): void {
    [...list.children].forEach((li) => li.classList.remove(HIDDEN));
    list.classList.remove('mdweb-collapsible', 'is-collapsed');
    delete list.dataset.mdwebCount;
    delete list.dataset.mdwebExpanded;
}

export function enhanceCollapsibleLists(root: ParentNode): void {
    const doc = (root as Node).ownerDocument ?? document;
    // Drop toggles whose list is gone or no longer right before them.
    root.querySelectorAll<HTMLButtonElement>(`button.${TOGGLE}`).forEach((b) => {
        const list = doc.getElementById(b.getAttribute('aria-controls') || '');
        if (!list || list.nextElementSibling !== b) {
            if (list) restore(list);
            b.remove();
        }
    });
    root.querySelectorAll<HTMLElement>('ul, ol').forEach((list) => {
        const next = list.nextElementSibling;
        const existing = next && next.classList.contains(TOGGLE) ? (next as HTMLButtonElement) : null;
        const count = collapseCount(list.previousElementSibling);
        const revealable = count === null ? 0 : ([...list.children] as HTMLElement[]).slice(count).filter((li) => !li.hidden).length;
        if (count === null || revealable === 0) {
            // Not (or no longer) eligible: show everything and drop the control.
            existing?.remove();
            if (list.classList.contains('mdweb-collapsible')) restore(list);
            return;
        }
        if (existing) { apply(list, existing, count); return; } // reconcile count and items
        if (!list.id) list.id = uniqueId(doc);
        list.classList.add('mdweb-collapsible');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = TOGGLE;
        button.setAttribute('aria-controls', list.id);
        button.addEventListener('click', () => {
            list.dataset.mdwebExpanded = String(list.dataset.mdwebExpanded !== 'true');
            apply(list, button, Number(list.dataset.mdwebCount) || count);
        });
        list.insertAdjacentElement('afterend', button);
        apply(list, button, count);
    });
}
