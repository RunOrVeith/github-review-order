import type { PullRef } from './github';
import type { ReviewItem } from './review-order';

interface Progress {
  fingerprint: string;
  index: number;
}

export interface CachedReview {
  fingerprint: string;
  items: ReviewItem[];
}

const pullKey = (pr: PullRef) => `${pr.owner}/${pr.repo}#${pr.number}`;

// storage.session isn't readable from content scripts by default, so progress lives in local storage
function progressItem(pr: PullRef) {
  return storage.defineItem<Progress>(`local:reviewOrder:${pullKey(pr)}`);
}

function cacheItem(pr: PullRef) {
  return storage.defineItem<CachedReview>(`local:reviewOrderCache:${pullKey(pr)}`);
}

/** Returns the saved step, or 0 when the PR's commits or review order changed since. */
export async function loadProgress(pr: PullRef, fingerprint: string): Promise<number> {
  const progress = await progressItem(pr).getValue();
  return progress?.fingerprint === fingerprint ? progress.index : 0;
}

export async function saveProgress(pr: PullRef, fingerprint: string, index: number): Promise<void> {
  await progressItem(pr).setValue({ fingerprint, index });
}

/** The review order last read from the PR, shown while the current one is being fetched. */
export function loadCachedReview(pr: PullRef): Promise<CachedReview | null> {
  return cacheItem(pr).getValue();
}

/** Passing null forgets it, e.g. when the description no longer has a review order. */
export async function saveCachedReview(pr: PullRef, review: CachedReview | null): Promise<void> {
  if (review) await cacheItem(pr).setValue(review);
  else await cacheItem(pr).removeValue();
}
