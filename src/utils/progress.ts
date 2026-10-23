import type { PostRef, PullRef } from './github';
import type { ReviewItem } from './review-order';

export interface CachedReview {
  fingerprint: string;
  items: ReviewItem[];
  /** The post the order is from. */
  source: PostRef;
}

/** Everything kept for a PR: its review order as last read, and how far the user got through it. */
interface SavedReview extends CachedReview {
  index: number;
  /** When the PR's review was last opened, so the ones nobody comes back to can be dropped. */
  savedAt: number;
}

/** Whether Next and Previous skip files ticked as viewed; shared by all PRs. */
export const skipViewed = storage.defineItem<boolean>('local:skipViewed', { fallback: true });

/** Whether ticking the current file as viewed moves on to the next one; shared by all PRs. */
export const autoAdvance = storage.defineItem<boolean>('local:autoAdvance', { fallback: true });

/** Reviews that weren't opened for this long are dropped. */
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const PREFIX = 'review:';
// Earlier versions kept the step and the order under separate keys and never dropped either
const LEGACY_PREFIXES = ['reviewOrder:', 'reviewOrderCache:'];

// storage.session isn't readable from content scripts by default, so reviews live in local storage
const storageKey = (pr: PullRef) => `local:${PREFIX}${pr.owner}/${pr.repo}#${pr.number}` as const;

// Each write reads the saved review first, so writes must not interleave
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

/** Returns the saved step, or 0 when the PR's commits or review order changed since. */
export async function loadProgress(pr: PullRef, fingerprint: string): Promise<number> {
  const saved = await read(pr);
  return saved?.fingerprint === fingerprint ? saved.index : 0;
}

export function saveProgress(pr: PullRef, fingerprint: string, index: number): Promise<void> {
  return serialized(async () => {
    const saved = await read(pr);
    // The order is saved as soon as it's read, so a step for any other order is outdated
    if (saved?.fingerprint !== fingerprint) return;
    await write(pr, { ...saved, index, savedAt: Date.now() });
  });
}

/** The review order last read from the PR, shown while the current one is being fetched. */
export async function loadCachedReview(pr: PullRef): Promise<CachedReview | null> {
  const saved = await read(pr);
  return saved && { fingerprint: saved.fingerprint, items: saved.items, source: saved.source };
}

/** Remembers the PR's review order, keeping its step if the order is unchanged, and drops expired reviews. */
export function saveCachedReview(pr: PullRef, review: CachedReview): Promise<void> {
  return serialized(async () => {
    await dropExpired();
    const saved = await read(pr);
    const index = saved?.fingerprint === review.fingerprint ? saved.index : 0;
    await write(pr, { ...review, index, savedAt: Date.now() });
  });
}

/** Forgets the PR, e.g. when its description no longer has a review order. */
export function forgetReview(pr: PullRef): Promise<void> {
  return serialized(() => storage.removeItem(storageKey(pr)));
}

async function read(pr: PullRef): Promise<SavedReview | null> {
  const saved = await storage.getItem<unknown>(storageKey(pr));
  return isSavedReview(saved) && !isExpired(saved, Date.now()) ? saved : null;
}

/** Saves the review, making room by dropping the least recently opened other reviews while storage is full. */
async function write(pr: PullRef, review: SavedReview): Promise<void> {
  const key = storageKey(pr);
  for (;;) {
    try {
      return await storage.setItem(key, review);
    } catch (error) {
      if (!isQuotaError(error) || !(await dropOldest(key))) throw error;
    }
  }
}

/** Drops reviews that expired or can't be read, and the ones earlier versions saved. */
async function dropExpired(): Promise<void> {
  const now = Date.now();
  const stale = Object.entries(await storage.snapshot('local'))
    .filter(
      ([key, value]) =>
        LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
        (key.startsWith(PREFIX) && (!isSavedReview(value) || isExpired(value, now))),
    )
    .map(([key]) => `local:${key}` as const);
  if (stale.length > 0) await storage.removeItems(stale);
}

/** Drops the least recently opened review other than the one given; false if there's none. */
async function dropOldest(except: string): Promise<boolean> {
  let oldest: { key: `local:${string}`; savedAt: number } | null = null;
  for (const [key, value] of Object.entries(await storage.snapshot('local'))) {
    if (!key.startsWith(PREFIX) || `local:${key}` === except) continue;
    // Unreadable ones go first
    const savedAt = isSavedReview(value) ? value.savedAt : -Infinity;
    if (!oldest || savedAt < oldest.savedAt) oldest = { key: `local:${key}`, savedAt };
  }
  if (!oldest) return false;

  await storage.removeItem(oldest.key);
  return true;
}

function isQuotaError(error: unknown): boolean {
  // Chrome rejects with "QUOTA_BYTES quota exceeded", Firefox with a QuotaExceededError
  return /quota/i.test(String(error));
}

function isExpired(review: SavedReview, now: number): boolean {
  return now - review.savedAt > MAX_AGE;
}

function isSavedReview(value: unknown): value is SavedReview {
  if (typeof value !== 'object' || value === null) return false;
  const { fingerprint, items, source, index, savedAt } = value as Record<string, unknown>;
  return (
    typeof fingerprint === 'string' &&
    isPostRef(source) &&
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(isReviewItem) &&
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < items.length &&
    typeof savedAt === 'number'
  );
}

function isPostRef(value: unknown): value is PostRef {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, author, anchor } = value as Record<string, unknown>;
  return (
    (kind === 'description' || kind === 'comment' || kind === 'review') &&
    (author === null || typeof author === 'string') &&
    (anchor === null || typeof anchor === 'string')
  );
}

function isReviewItem(value: unknown): value is ReviewItem {
  if (typeof value !== 'object' || value === null) return false;
  const { path, description } = value as Record<string, unknown>;
  return typeof path === 'string' && typeof description === 'string';
}
