import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadCachedReview, loadProgress, saveCachedReview, saveProgress } from '@/utils/progress';

const pr = { owner: 'acme', repo: 'repo', number: 12, isChangesTab: true };

beforeEach(() => {
  fakeBrowser.reset();
});

test('starts at the first step', async () => {
  expect(await loadProgress(pr, 'v1')).toBe(0);
});

test('restores the saved step while the fingerprint matches', async () => {
  await saveProgress(pr, 'v1', 2);
  expect(await loadProgress(pr, 'v1')).toBe(2);
});

test('resets when the fingerprint changes', async () => {
  await saveProgress(pr, 'v1', 2);
  expect(await loadProgress(pr, 'v2')).toBe(0);
});

test('keeps progress separate per PR', async () => {
  await saveProgress(pr, 'v1', 2);
  expect(await loadProgress({ ...pr, number: 13 }, 'v1')).toBe(0);
});

test('caches the last review order per PR until it is cleared', async () => {
  const review = { fingerprint: 'v1', items: [{ path: 'src/a.ts', description: 'first' }] };
  await saveCachedReview(pr, review);

  expect(await loadCachedReview(pr)).toEqual(review);
  expect(await loadCachedReview({ ...pr, number: 13 })).toBeNull();

  await saveCachedReview(pr, null);
  expect(await loadCachedReview(pr)).toBeNull();
});
