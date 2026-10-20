// Everything that depends on GitHub's file tree markup lives here
const TREE_SELECTOR = '[role="tree"]';
const TREE_ITEM_SELECTOR = '[role="treeitem"]';
const ENTRY_SELECTOR = '[role="tree"] [role="treeitem"][id]';
const DIFF_LINK_SELECTOR = '[role="tree"] a[href*="#diff-"]';
const ANCHOR = /diff-[0-9a-f]{64}/;
// React's useId values, which the /changes tree uses for other elements' ids
const GENERATED_ID = /^(_r_|_R_|:r)/;

export interface ReviewFile {
  path: string;
  anchor: string;
}

const STEP = 'data-review-order-step';
const UNLISTED = 'data-review-order-unlisted';
const CURRENT = 'data-review-order-current';
const MARKER = 'data-review-order-marker';
// Marks titles this extension set, so only those are removed again
const OWN_TITLE = 'data-review-order-title';
const UNLISTED_TITLE = 'Not in the review order';

type Rect = Pick<DOMRect, 'top' | 'bottom' | 'height'>;

/** The file tree on a PR's changes page, if it has one. */
export function findTree(root: ParentNode): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>(TREE_SELECTOR)).find((tree) => findTreeEntries(tree).size > 0) ??
    null
  );
}

/**
 * Maps each file to its entry in GitHub's file tree. Classic trees identify
 * files by their anchor (`diff-<sha256 of the path>`), the /changes tree by
 * their path, so entries are keyed by whichever the markup has.
 */
export function findTreeEntries(root: ParentNode): Map<string, HTMLElement> {
  const keys = new Map<HTMLElement, string>();

  for (const entry of root.querySelectorAll<HTMLElement>(ENTRY_SELECTOR)) {
    if (isFolder(entry)) continue;
    const anchor = ANCHOR.exec(entry.id)?.[0];
    if (anchor) keys.set(entry, anchor);
    else if (!GENERATED_ID.test(entry.id)) keys.set(entry, entry.id);
  }
  // Each link belongs to its closest entry, so a folder never gets its files' links
  for (const link of root.querySelectorAll(DIFF_LINK_SELECTOR)) {
    const entry = link.closest<HTMLElement>(TREE_ITEM_SELECTOR);
    const anchor = ANCHOR.exec(link.getAttribute('href') ?? '')?.[0];
    if (entry && anchor && !keys.has(entry) && !isFolder(entry)) keys.set(entry, anchor);
  }

  const entries = new Map<string, HTMLElement>();
  for (const [entry, key] of keys) {
    if (!entries.has(key)) entries.set(key, entry);
  }
  return entries;
}

function isFolder(entry: HTMLElement): boolean {
  return entry.hasAttribute('aria-expanded') || entry.dataset.treeEntryType === 'directory';
}

/**
 * Each file's step in the review order, counting from 1, under both its path
 * and its anchor. A file listed twice keeps its first step.
 */
export function reviewSteps(files: ReviewFile[]): Map<string, number> {
  const steps = new Map<string, number>();
  files.forEach(({ path, anchor }, index) => {
    for (const key of [path, anchor]) {
      if (!steps.has(key)) steps.set(key, index + 1);
    }
  });
  return steps;
}

/**
 * Gives each file a badge with its step in the review order, or a warning if
 * it's missing from it, and highlights the current one. Only writes what changed.
 */
export function markTreeEntries(
  entries: Map<string, HTMLElement>,
  steps: Map<string, number>,
  current: ReviewFile | null,
): void {
  for (const [key, entry] of entries) {
    const step = steps.get(key);
    const isCurrent = key === current?.path || key === current?.anchor;
    setAttribute(entry, STEP, step === undefined ? null : String(step));
    setAttribute(entry, UNLISTED, step === undefined ? '' : null);
    setAttribute(entry, CURRENT, isCurrent ? '' : null);
    setMarker(entry, step === undefined ? '!' : String(step));
    setUnlistedTitle(entry, step === undefined);
  }
}

/** A file's tree entry, whichever way the tree identifies it. */
export function treeEntryFor(entries: Map<string, HTMLElement>, file: ReviewFile): HTMLElement | undefined {
  return entries.get(file.path) ?? entries.get(file.anchor);
}

export function clearTreeMarks(root: ParentNode): void {
  for (const marker of root.querySelectorAll(`[${MARKER}]`)) marker.remove();
  for (const entry of root.querySelectorAll(`[${STEP}], [${UNLISTED}], [${CURRENT}], [${OWN_TITLE}]`)) {
    entry.removeAttribute(STEP);
    entry.removeAttribute(UNLISTED);
    entry.removeAttribute(CURRENT);
    if (entry.hasAttribute(OWN_TITLE)) removeOwnTitle(entry);
  }
}

function setAttribute(element: Element, name: string, value: string | null) {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/**
 * The badge is an element of its own rather than the entry's ::before/::after,
 * which GitHub uses for its active-file indicator.
 */
function setMarker(entry: Element, text: string) {
  let marker = entry.querySelector(`:scope > [${MARKER}]`);
  if (!marker) {
    marker = entry.ownerDocument.createElement('span');
    marker.setAttribute(MARKER, '');
    marker.setAttribute('aria-hidden', 'true');
    entry.append(marker);
  }
  if (marker.textContent !== text) marker.textContent = text;
}

function setUnlistedTitle(entry: Element, unlisted: boolean) {
  const ours = entry.hasAttribute(OWN_TITLE);
  if (unlisted && !ours && !entry.hasAttribute('title')) {
    entry.setAttribute('title', UNLISTED_TITLE);
    entry.setAttribute(OWN_TITLE, '');
  } else if (!unlisted && ours) {
    removeOwnTitle(entry);
  }
}

function removeOwnTitle(entry: Element) {
  // GitHub may have replaced the title since; that one stays
  if (entry.getAttribute('title') === UNLISTED_TITLE) entry.removeAttribute('title');
  entry.removeAttribute(OWN_TITLE);
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
