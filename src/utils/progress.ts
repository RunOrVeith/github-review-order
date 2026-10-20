import type { PullRef } from './github';

interface Progress {
  fingerprint: string;
  index: number;
}

// storage.session isn't readable from content scripts by default, so progress lives in local storage
function progressItem(pr: PullRef) {
  return storage.defineItem<Progress>(`local:reviewOrder:${pr.owner}/${pr.repo}#${pr.number}`);
}

/** Returns the saved step, or 0 when the PR's commits or review order changed since. */
export async function loadProgress(pr: PullRef, fingerprint: string): Promise<number> {
  const progress = await progressItem(pr).getValue();
  return progress?.fingerprint === fingerprint ? progress.index : 0;
}

export async function saveProgress(pr: PullRef, fingerprint: string, index: number): Promise<void> {
  await progressItem(pr).setValue({ fingerprint, index });
}
