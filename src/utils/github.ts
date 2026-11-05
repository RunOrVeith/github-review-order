export interface PullRef {
  owner: string;
  repo: string;
  number: number;
  isChangesTab: boolean;
}

import { sha256Hex } from './hash';

/** A description, comment or review summary on the conversation page. */
export interface PostRef {
  kind: 'description' | 'comment' | 'review';
  /** Who wrote it, if the page says. */
  author: string | null;
  /** Its anchor on the conversation page, like issuecomment-123; null for the description. */
  anchor: string | null;
}

export interface PullPost extends PostRef {
  /** The rendered markdown. */
  body: Element;
}

export interface PullPage {
  /** The description, then the comments that may set a newer review order, oldest first. */
  posts: PullPost[];
  headSha: string | null;
}

// Everything that depends on GitHub's markup lives here
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/;
const CHANGES_TAB = /^\/(files|changes)(\/|$)/;
const COMMENT_BODY_SELECTOR = '.comment-body.markdown-body';
const DESCRIPTION_SELECTOR = `[id^="pullrequest-"] ${COMMENT_BODY_SELECTOR}`;
// A body belongs to the nearest element with an id. Inline review comments (discussion_r123) are about a
// line of code and don't count.
const TIMELINE_COMMENT_ID = /^(issuecomment|pullrequestreview)-\d+$/;
const MINIMIZED_SELECTOR = '.minimized-comment';
// GitHub labels commenters by their role in the repo; these can usually edit the description anyway
const TRUSTED_ROLE = /^(owner|member|collaborator|author)$/i;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const REFRESH_LABEL = /^(refresh|reload)\b/i;
// Each rendered file has a "Viewed" / "Not Viewed" toggle; aria-pressed is its state
const VIEW_TOGGLE_SELECTOR = 'button[aria-pressed]';
const VIEW_TOGGLE_LABEL = /^(not )?viewed$/i;
// GitHub's React pages embed their data, e.g. every file's viewed state on large PRs that only render some
export const EMBEDDED_DATA_SELECTOR = 'script[data-target="react-app.embeddedData"]';
const FILE_ANCHOR = /^diff-[0-9a-f]{64}$/;
// Without a commit range after it, the changes tab shows the whole PR, like its .diff
const WHOLE_PULL_TAB = /^\/(files|changes)\/?$/;
// Each file's diff is a table; every line's number and code cells say which side and line they're for
const DIFF_TABLE_ATTRIBUTE = 'data-diff-anchor';
const DIFF_LINE_CELL_SELECTOR = 'td[data-diff-side][data-line-number]';
// Only code cells have it
const LINE_ANCHOR_ATTRIBUTE = 'data-line-anchor';

interface DiffSummary {
  path?: unknown;
  pathDigest?: unknown;
  markedAsViewed?: unknown;
}

/** The parts of the embedded data this reads; anything in it may be missing or shaped differently. */
interface EmbeddedPayload {
  pullRequestsChangesRoute?: { diffSummaries?: unknown };
  pullRequestsLayoutRoute?: { pullRequest?: { headSha?: unknown; author?: { login?: unknown } } };
}

/** A request to GitHub that got an error response. */
export class RequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GitHub responded with ${status}`);
    this.status = status;
  }
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

/** Whether the URL is the changes tab showing all of the PR's commits rather than some of them. */
export function viewsWholePull(url: string): boolean {
  const match = PULL_PATH.exec(new URL(url).pathname);
  return match !== null && WHOLE_PULL_TAB.test(match[4] ?? '');
}

/**
 * The PR's whole diff in git's format. It redirects to another host, so this
 * only works from the extension's background, not from github.com's pages.
 */
export async function fetchPullDiff(pr: Pick<PullRef, 'owner' | 'repo' | 'number'>): Promise<string> {
  const path = [pr.owner, pr.repo, 'pull', `${pr.number}.diff`].map(encodeURIComponent).join('/');
  const response = await fetch(`https://github.com/${path}`, { cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new RequestError(response.status);
  return response.text();
}

/**
 * The changes tab doesn't contain the description, so it's read from the conversation page.
 * Rejects when the page can't be loaded, which says nothing about whether it has a review order.
 */
export async function fetchPullPage(pr: PullRef): Promise<PullPage> {
  const url = new URL(`/${pr.owner}/${pr.repo}/pull/${pr.number}`, location.origin);
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new RequestError(response.status);

  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const pull = embeddedPayload(doc)?.pullRequestsLayoutRoute?.pullRequest;
  const sha = pull?.headSha;
  const author = pull?.author?.login;
  return {
    posts: reviewOrderPosts(doc, typeof author === 'string' ? author : null),
    headSha: typeof sha === 'string' && COMMIT_SHA.test(sha) ? sha : null,
  };
}

/**
 * The description, then the comments and review summaries by the PR's author
 * or its collaborators. Anyone can comment, but only they may change the order.
 */
function reviewOrderPosts(doc: Document, author: string | null): PullPost[] {
  const bodies = Array.from(doc.querySelectorAll(COMMENT_BODY_SELECTOR));
  // The description has always been the first body, so that stays if its container changes
  const description = doc.querySelector(DESCRIPTION_SELECTOR) ?? bodies[0];
  if (!description) return [];

  const posts: PullPost[] = [{ kind: 'description', author, anchor: null, body: description }];
  for (const body of bodies) {
    if (body === description || body.closest(MINIMIZED_SELECTOR)) continue;
    const comment = body.parentElement?.closest('[id]');
    if (!comment || !TIMELINE_COMMENT_ID.test(comment.id)) continue;

    const login = comment.querySelector('a.author')?.textContent?.trim() || null;
    if (!isTrustedCommenter(comment, login, author)) continue;
    const kind = comment.id.startsWith('pullrequestreview-') ? 'review' : 'comment';
    posts.push({ kind, author: login, anchor: comment.id, body });
  }
  return posts;
}

function isTrustedCommenter(comment: Element, login: string | null, author: string | null): boolean {
  if (author && login === author) return true;

  // Markdown can't set classes, so labels are GitHub's, but those inside the body are skipped anyway
  return Array.from(comment.querySelectorAll('.Label')).some(
    (label) => !label.closest(COMMENT_BODY_SELECTOR) && TRUSTED_ROLE.test(label.textContent?.trim() ?? ''),
  );
}

function embeddedPayload(root: ParentNode): EmbeddedPayload | null {
  return parseEmbeddedPayload(root.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent ?? '');
}

function parseEmbeddedPayload(json: string): EmbeddedPayload | null {
  try {
    return JSON.parse(json)?.payload ?? null;
  } catch {
    return null;
  }
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
  return button.matches(VIEW_TOGGLE_SELECTOR) && VIEW_TOGGLE_LABEL.test(button.getAttribute('aria-label')?.trim() ?? '');
}

/**
 * Whether DOM changes can have changed what's known about viewed states: a
 * toggle flipped, or toggles or embedded data got rendered. Toggles going away
 * don't matter, their last state is remembered.
 */
export function changesViewedStates(records: MutationRecord[]): boolean {
  const watched = `${VIEW_TOGGLE_SELECTOR}, ${EMBEDDED_DATA_SELECTOR}`;
  return records.some((record) =>
    record.type === 'attributes'
      ? record.target instanceof Element && isViewToggle(record.target)
      : Array.from(record.addedNodes).some(
          (node) => node instanceof Element && (node.matches(watched) || node.querySelector(watched) !== null),
        ),
  );
}

function isPressed(toggle: Element): boolean {
  return toggle.getAttribute('aria-pressed') === 'true';
}

/** The anchor of the file container an element is in, skipping wrappers like diff-comparison-viewer-container. */
function fileAnchorOf(element: Element): string | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (isFileAnchor(node.id)) return node.id;
  }
  return null;
}

/**
 * Every file's viewed state from the changes page's embedded data, keyed by
 * its anchor. Null when the data has no per-file summaries, as on small PRs.
 */
export function parseViewedSnapshot(json: string): Map<string, boolean> | null {
  const summaries = parseEmbeddedPayload(json)?.pullRequestsChangesRoute?.diffSummaries;
  if (!Array.isArray(summaries)) return null;

  const snapshot = new Map<string, boolean>();
  for (const summary of summaries as DiffSummary[]) {
    if (typeof summary?.pathDigest === 'string' && typeof summary.markedAsViewed === 'boolean') {
      snapshot.set(`diff-${summary.pathDigest}`, summary.markedAsViewed);
    }
  }
  return snapshot.size > 0 ? snapshot : null;
}

/** The paths of the PR's files from the changes page's embedded data; empty without it, as on the classic files tab. */
export function readChangedPaths(root: ParentNode = document): string[] {
  const summaries = embeddedPayload(root)?.pullRequestsChangesRoute?.diffSummaries;
  if (!Array.isArray(summaries)) return [];
  return (summaries as DiffSummary[]).flatMap((summary) => (typeof summary?.path === 'string' ? [summary.path] : []));
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

/** Names the post and links to it on the conversation page, e.g. "File order from @carol's comment". */
export function describePost(pr: PullRef, post: PostRef): { text: string; href: string } {
  const path = `/${pr.owner}/${pr.repo}/pull/${pr.number}`;
  const href = new URL(post.anchor ? `${path}#${post.anchor}` : path, location.origin).href;
  if (post.kind === 'description') return { text: 'File order from the PR description', href };
  return { text: `File order from ${post.author ? `@${post.author}'s` : 'a'} ${post.kind}`, href };
}

/** Whether a click landed on a button or link like GitHub's "Refresh" for newly pushed changes. */
export function isRefreshControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const control = target.closest('button, a, [role="button"]');
  const label = control?.getAttribute('aria-label') || control?.textContent || '';
  return REFRESH_LABEL.test(label.trim());
}

/** Whether the id is a file's anchor on the changes tab rather than, say, its path. */
export function isFileAnchor(id: string): boolean {
  return FILE_ANCHOR.test(id);
}

/** A line in the old (left) or new (right) version of a file. */
export type DiffSide = 'left' | 'right';

export interface DiffLine {
  fileAnchor: string;
  side: DiffSide;
  line: number;
}

/** Selects a line's code cell in its file's diff, in split and unified view. */
export function diffCodeSelector({ fileAnchor, side, line }: DiffLine): string {
  return `table[${DIFF_TABLE_ATTRIBUTE}="${fileAnchor}"] td[data-diff-side="${side}"][data-line-number="${line}"][${LINE_ANCHOR_ATTRIBUTE}]`;
}

/** The diff line a cell, or something inside it, belongs to. */
export function diffLineAt(target: Element): (DiffLine & { cell: Element }) | null {
  const cell = target.closest(DIFF_LINE_CELL_SELECTOR);
  const fileAnchor = cell?.closest(`table[${DIFF_TABLE_ATTRIBUTE}]`)?.getAttribute(DIFF_TABLE_ATTRIBUTE);
  const side = cell?.getAttribute('data-diff-side');
  const line = Number(cell?.getAttribute('data-line-number'));
  if (!cell || !fileAnchor || (side !== 'left' && side !== 'right') || !Number.isInteger(line)) return null;
  return { fileAnchor, side, line, cell };
}

/** The changes tab scrolls to a line at `#<file anchor>L<old line>` or `R<new line>`. */
export function diffLineAnchor({ fileAnchor, side, line }: DiffLine): string {
  return `${fileAnchor}${side === 'left' ? 'L' : 'R'}${line}`;
}

/** GitHub anchors each file on the changes tab at `#diff-<sha256 of its path>`. */
export async function diffAnchorId(path: string): Promise<string> {
  return `diff-${await sha256Hex(path)}`;
}
