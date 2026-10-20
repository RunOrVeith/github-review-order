export interface PullRef {
  owner: string;
  repo: string;
  number: number;
  isChangesTab: boolean;
}

export interface PullPage {
  description: Element | null;
  headSha: string | null;
}

// Everything that depends on GitHub's markup lives here
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/;
const CHANGES_TAB = /^\/(files|changes)(\/|$)/;
const DESCRIPTION_SELECTOR = '.comment-body.markdown-body';
const HEAD_SHA = /"headSha":"([0-9a-f]{40})"/;
const REFRESH_LABEL = /^(refresh|reload)\b/i;
// Each rendered file has a "Viewed" / "Not Viewed" toggle; aria-pressed is its state
const VIEW_TOGGLE_SELECTOR = 'button[aria-pressed]';
const VIEW_TOGGLE_LABEL = /^(not )?viewed$/i;
// Large PRs only render the files near the screen, but embed every file's viewed state
export const EMBEDDED_DATA_SELECTOR = 'script[data-target="react-app.embeddedData"]';
const FILE_ANCHOR = /^diff-[0-9a-f]{64}$/;

interface DiffSummary {
  pathDigest?: unknown;
  markedAsViewed?: unknown;
}

export function parsePullUrl(url: string): PullRef | null {
  const match = PULL_PATH.exec(new URL(url).pathname);
  if (!match) return null;

  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
    isChangesTab: CHANGES_TAB.test(match[4] ?? ''),
  };
}

/** The changes tab doesn't contain the description, so it's read from the conversation page. */
export async function fetchPullPage(pr: PullRef): Promise<PullPage> {
  const url = new URL(`/${pr.owner}/${pr.repo}/pull/${pr.number}`, location.origin);
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return { description: null, headSha: null };

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    description: doc.querySelector(DESCRIPTION_SELECTOR),
    headSha: HEAD_SHA.exec(html)?.[1] ?? null,
  };
}

/** The file's "Viewed" toggle state, or null when GitHub hasn't rendered the file. */
export function readViewToggle(anchor: string, root: Document = document): boolean | null {
  const container = root.getElementById(anchor);
  const toggle = container && Array.from(container.querySelectorAll(VIEW_TOGGLE_SELECTOR)).find(isViewToggle);
  return toggle ? isPressed(toggle) : null;
}

/** Every rendered file's "Viewed" toggle state, keyed by the file's anchor. */
export function readRenderedViewToggles(root: ParentNode = document): Map<string, boolean> {
  const states = new Map<string, boolean>();
  for (const toggle of Array.from(root.querySelectorAll(VIEW_TOGGLE_SELECTOR)).filter(isViewToggle)) {
    const anchor = fileAnchorOf(toggle);
    if (anchor && !states.has(anchor)) states.set(anchor, isPressed(toggle));
  }
  return states;
}

function isViewToggle(button: Element): boolean {
  return VIEW_TOGGLE_LABEL.test(button.getAttribute('aria-label')?.trim() ?? '');
}

function isPressed(toggle: Element): boolean {
  return toggle.getAttribute('aria-pressed') === 'true';
}

/** The anchor of the file container an element is in, skipping wrappers like diff-comparison-viewer-container. */
function fileAnchorOf(element: Element): string | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (FILE_ANCHOR.test(node.id)) return node.id;
  }
  return null;
}

/**
 * Every file's viewed state from the changes page's embedded data, keyed by
 * its anchor. Null when the data has no per-file summaries, as on small PRs.
 */
export function parseViewedSnapshot(json: string): Map<string, boolean> | null {
  let summaries: unknown;
  try {
    summaries = JSON.parse(json)?.payload?.pullRequestsChangesRoute?.diffSummaries;
  } catch {
    return null;
  }
  if (!Array.isArray(summaries)) return null;

  const snapshot = new Map<string, boolean>();
  for (const summary of summaries as DiffSummary[]) {
    if (typeof summary?.pathDigest === 'string' && typeof summary.markedAsViewed === 'boolean') {
      snapshot.set(`diff-${summary.pathDigest}`, summary.markedAsViewed);
    }
  }
  return snapshot.size > 0 ? snapshot : null;
}

/** The current viewed states, from a fresh copy of the changes page. */
export async function fetchViewedSnapshot(pr: PullRef): Promise<Map<string, boolean> | null> {
  const url = new URL(`/${pr.owner}/${pr.repo}/pull/${pr.number}/changes`, location.origin);
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return null;

  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const data = doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent;
  return data ? parseViewedSnapshot(data) : null;
}

/** Whether a click landed on a button or link like GitHub's "Refresh" for newly pushed changes. */
export function isRefreshControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const control = target.closest('button, a, [role="button"]');
  const label = control?.getAttribute('aria-label') || control?.textContent || '';
  return REFRESH_LABEL.test(label.trim());
}

/** GitHub anchors each file on the changes tab at `#diff-<sha256 of its path>`. */
export async function diffAnchorId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `diff-${hex}`;
}
