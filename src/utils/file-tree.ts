// Everything that depends on GitHub's file tree markup lives here
const TREE_ENTRY_SELECTOR = '[role="tree"] [role="treeitem"]';
const TREE_ITEM_SELECTOR = '[role="treeitem"]';
const DIFF_LINK_SELECTOR = 'a[href*="#diff-"]';
const ANCHOR = /diff-[0-9a-f]{64}/;

const STEP = 'data-review-order-step';
const UNLISTED = 'data-review-order-unlisted';
const CURRENT = 'data-review-order-current';
// Marks titles this extension set, so only those are removed again
const OWN_TITLE = 'data-review-order-title';
const UNLISTED_TITLE = 'Not in the review order';

type Rect = Pick<DOMRect, 'top' | 'bottom' | 'height'>;

/** Maps each file's anchor (`diff-<sha256 of its path>`) to its entry in GitHub's file tree. */
export function findTreeEntries(root: ParentNode): Map<string, HTMLElement> {
  const entries = new Map<string, HTMLElement>();
  for (const entry of root.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR)) {
    const anchor = anchorOf(entry);
    if (anchor && !entries.has(anchor)) entries.set(anchor, entry);
  }
  return entries;
}

function anchorOf(entry: HTMLElement): string | null {
  const own = ANCHOR.exec(entry.id)?.[0];
  if (own) return own;

  // Folders contain their files' links too, so only links that belong to this entry count
  const link = Array.from(entry.querySelectorAll(DIFF_LINK_SELECTOR)).find(
    (a) => a.closest(TREE_ITEM_SELECTOR) === entry,
  );
  return ANCHOR.exec(link?.getAttribute('href') ?? '')?.[0] ?? null;
}

/**
 * Marks each file with its step in the review order, or as missing from it, and
 * highlights the current one. Only writes attributes that changed.
 */
export function markTreeEntries(
  entries: Map<string, HTMLElement>,
  order: string[],
  currentId: string | null,
): void {
  const steps = new Map<string, number>();
  order.forEach((id, index) => {
    if (!steps.has(id)) steps.set(id, index + 1);
  });

  for (const [id, entry] of entries) {
    const step = steps.get(id);
    setAttribute(entry, STEP, step === undefined ? null : String(step));
    setAttribute(entry, UNLISTED, step === undefined ? '' : null);
    setAttribute(entry, CURRENT, id === currentId ? '' : null);
    setUnlistedTitle(entry, step === undefined);
  }
}

export function clearTreeMarks(root: ParentNode): void {
  for (const entry of root.querySelectorAll(`[${STEP}], [${UNLISTED}], [${CURRENT}], [${OWN_TITLE}]`)) {
    entry.removeAttribute(STEP);
    entry.removeAttribute(UNLISTED);
    entry.removeAttribute(CURRENT);
    setUnlistedTitle(entry, false);
  }
}

function setAttribute(element: Element, name: string, value: string | null) {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function setUnlistedTitle(entry: Element, unlisted: boolean) {
  const ours = entry.hasAttribute(OWN_TITLE);
  if (unlisted && !ours && !entry.hasAttribute('title')) {
    entry.setAttribute('title', UNLISTED_TITLE);
    entry.setAttribute(OWN_TITLE, '');
  } else if (!unlisted && ours) {
    entry.removeAttribute('title');
    entry.removeAttribute(OWN_TITLE);
  }
}

/** The scrollTop that centres the item in its container, or null if it's already fully visible. */
export function scrollTopToReveal(container: Rect, item: Rect, scrollTop: number): number | null {
  if (item.top >= container.top && item.bottom <= container.bottom) return null;

  const offset = item.top - container.top + item.height / 2 - container.height / 2;
  return Math.max(0, Math.round(scrollTop + offset));
}

/** Scrolls only the tree's own scroll container, never the page, so the diff stays where it is. */
export function scrollTreeTo(entry: HTMLElement): void {
  // Files inside a collapsed folder aren't laid out
  if (entry.getClientRects().length === 0) return;

  const container = scrollContainerOf(entry);
  if (!container) return;

  const target = scrollTopToReveal(
    container.getBoundingClientRect(),
    entry.getBoundingClientRect(),
    container.scrollTop,
  );
  if (target !== null) container.scrollTop = target;
}

function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}
