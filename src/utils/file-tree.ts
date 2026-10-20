// Everything that depends on GitHub's file tree markup lives here
const TREE_SELECTOR = '[role="tree"]';
const TREE_ITEM_SELECTOR = '[role="treeitem"]';
const ENTRY_SELECTOR = '[role="tree"] [role="treeitem"][id]';
const DIFF_LINK_SELECTOR = '[role="tree"] a[href*="#diff-"]';
const ANCHOR = /diff-[0-9a-f]{64}/;
const FILE_ANCHOR = /^diff-[0-9a-f]{64}$/;
// React's useId values, which the /changes tree uses for other elements' ids
const GENERATED_ID = /^(_r_|_R_|:r)/;

export interface ReviewFile {
  path: string;
  anchor: string;
}

const STEP = 'data-review-order-step';
const UNLISTED = 'data-review-order-unlisted';
const CURRENT = 'data-review-order-current';
const VIEWED = 'data-review-order-viewed';
// Holds the eye of viewed files, then the step or warning
const BADGES = 'data-review-order-badges';
const MARKER = 'data-review-order-marker';
const EYE = 'data-review-order-eye';
const SVG_NS = 'http://www.w3.org/2000/svg';
// GitHub's "eye" Octicon (MIT licensed), as on its Watch button
const EYE_PATH =
  'M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z';
// Marks titles this extension set, so only those are removed again
const OWN_TITLE = 'data-review-order-title';
const UNLISTED_TITLE = 'Not in the review order';

type Rect = Pick<DOMRect, 'top' | 'bottom' | 'height'>;

/** Whether a tree entry's key is a file's anchor rather than its path. */
export function isFileAnchor(key: string): boolean {
  return FILE_ANCHOR.test(key);
}

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

/** Whether the page has a file tree whose files can't be identified, as when GitHub changed its markup. */
export function hasUnreadableTree(root: ParentNode): boolean {
  const files = Array.from(root.querySelectorAll<HTMLElement>(`${TREE_SELECTOR} ${TREE_ITEM_SELECTOR}`));
  return files.some((item) => !isFolder(item)) && findTree(root) === null;
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
 * it's missing from it, plus an eye once it's viewed, and highlights the
 * current one. Only writes what changed.
 */
export function markTreeEntries(
  entries: Map<string, HTMLElement>,
  steps: Map<string, number>,
  current: ReviewFile | null,
  isViewed: (key: string) => boolean = () => false,
): void {
  for (const [key, entry] of entries) {
    const step = steps.get(key);
    const isCurrent = key === current?.path || key === current?.anchor;
    const viewed = isViewed(key);
    setAttribute(entry, STEP, step === undefined ? null : String(step));
    setAttribute(entry, UNLISTED, step === undefined ? '' : null);
    setAttribute(entry, CURRENT, isCurrent ? '' : null);
    setAttribute(entry, VIEWED, viewed ? '' : null);
    setBadges(entry, step === undefined ? '!' : String(step), viewed);
    setUnlistedTitle(entry, step === undefined);
  }
}

/** A file's tree entry, whichever way the tree identifies it. */
export function treeEntryFor(entries: Map<string, HTMLElement>, file: ReviewFile): HTMLElement | undefined {
  return entries.get(file.path) ?? entries.get(file.anchor);
}

export function clearTreeMarks(root: ParentNode): void {
  for (const badges of root.querySelectorAll(`[${BADGES}]`)) badges.remove();
  for (const entry of root.querySelectorAll(`[${STEP}], [${UNLISTED}], [${CURRENT}], [${VIEWED}], [${OWN_TITLE}]`)) {
    entry.removeAttribute(STEP);
    entry.removeAttribute(UNLISTED);
    entry.removeAttribute(CURRENT);
    entry.removeAttribute(VIEWED);
    if (entry.hasAttribute(OWN_TITLE)) removeOwnTitle(entry);
  }
}

function setAttribute(element: Element, name: string, value: string | null) {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/**
 * The badges are elements of their own rather than the entry's ::before/::after,
 * which GitHub uses for its active-file indicator.
 */
function setBadges(entry: Element, text: string, viewed: boolean) {
  const doc = entry.ownerDocument;
  let badges = entry.querySelector(`:scope > [${BADGES}]`);
  if (!badges) {
    badges = doc.createElement('span');
    badges.setAttribute(BADGES, '');
    // GitHub's own toggles and tree already tell assistive tech about each file
    badges.setAttribute('aria-hidden', 'true');
    entry.append(badges);
  }

  let marker = badges.querySelector(`:scope > [${MARKER}]`);
  if (!marker) {
    marker = doc.createElement('span');
    marker.setAttribute(MARKER, '');
    badges.append(marker);
  }
  if (marker.textContent !== text) marker.textContent = text;

  const eye = badges.querySelector(`:scope > [${EYE}]`);
  if (viewed && !eye) badges.prepend(createEye(doc));
  else if (!viewed && eye) eye.remove();
}

function createEye(doc: Document): Element {
  const eye = doc.createElementNS(SVG_NS, 'svg');
  eye.setAttribute(EYE, '');
  eye.setAttribute('viewBox', '0 0 16 16');
  // Sized here too, so it stays small if the stylesheet is missing
  eye.setAttribute('width', '14');
  eye.setAttribute('height', '14');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', EYE_PATH);
  eye.append(path);
  return eye;
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
