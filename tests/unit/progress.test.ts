import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  forgetReview,
  loadCachedReview,
  loadProgress,
  MAX_AGE,
  saveCachedReview,
  saveProgress,
} from '@/utils/progress';

const pr = { owner: 'acme', repo: 'repo', number: 12, isChangesTab: true };
const other = { ...pr, number: 13 };
const items = [
  { path: 'src/a.ts', description: 'first' },
  { path: 'src/b.ts', description: 'second' },
  { path: 'src/c.ts', description: 'third' },
];
const source = { kind: 'comment', author: 'carol', anchor: 'issuecomment-2' } as const;
const review = { fingerprint: 'v1', items, source };

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const storedKeys = async () => Object.keys(await fakeBrowser.storage.local.get(null)).sort();
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('progress', () => {
  test('starts at the first step', async () => {
    expect(await loadProgress(pr, 'v1')).toBe(0);
  });

  test('restores the saved step while the fingerprint matches', async () => {
    await saveCachedReview(pr, review);
    await saveProgress(pr, 'v1', 2);
    expect(await loadProgress(pr, 'v1')).toBe(2);
  });

  test('resets when the fingerprint changes', async () => {
    await saveCachedReview(pr, review);
    await saveProgress(pr, 'v1', 2);
    expect(await loadProgress(pr, 'v2')).toBe(0);
  });

  test('keeps the step when the same order is saved again, and resets it for a new one', async () => {
    await saveCachedReview(pr, review);
    await saveProgress(pr, 'v1', 2);

    await saveCachedReview(pr, review);
    expect(await loadProgress(pr, 'v1')).toBe(2);

    await saveCachedReview(pr, { ...review, fingerprint: 'v2' });
    expect(await loadProgress(pr, 'v2')).toBe(0);
  });

  test("ignores a step for an order that isn't saved", async () => {
    await saveProgress(pr, 'v1', 2);
    expect(await storedKeys()).toEqual([]);
  });

  test('keeps progress separate per PR', async () => {
    await saveCachedReview(pr, review);
    await saveProgress(pr, 'v1', 2);
    expect(await loadProgress(other, 'v1')).toBe(0);
  });
});

describe('cached review', () => {
  test('is kept per PR until it is forgotten', async () => {
    await saveCachedReview(pr, review);

    expect(await loadCachedReview(pr)).toEqual(review);
    expect(await loadCachedReview(other)).toBeNull();

    await forgetReview(pr);
    expect(await loadCachedReview(pr)).toBeNull();
    expect(await storedKeys()).toEqual([]);
  });

  test('stores the step and the order together, under one key per PR', async () => {
    await saveCachedReview(pr, review);
    await saveProgress(pr, 'v1', 1);

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      'review:acme/repo#12': { ...review, index: 1, savedAt: Date.now() },
    });
  });
});

describe('expiry', () => {
  test('a review not opened for a week is gone', async () => {
    await saveCachedReview(pr, review);
    advance(MAX_AGE + 1);

    expect(await loadCachedReview(pr)).toBeNull();
    expect(await loadProgress(pr, 'v1')).toBe(0);
  });

  test('opening a review keeps it for another week', async () => {
    await saveCachedReview(pr, review);
    advance(MAX_AGE - 1000);
    await saveProgress(pr, 'v1', 1);
    advance(MAX_AGE - 1000);

    expect(await loadProgress(pr, 'v1')).toBe(1);
  });

  test("saving a review deletes other PRs' expired ones", async () => {
    await saveCachedReview(other, review);
    advance(MAX_AGE + 1);
    await saveCachedReview(pr, review);

    expect(await storedKeys()).toEqual(['review:acme/repo#12']);
  });

  test('deletes what earlier versions stored, and unreadable reviews, but nothing else', async () => {
    await fakeBrowser.storage.local.set({
      'reviewOrder:acme/repo#1': { fingerprint: 'x', index: 1 },
      'reviewOrderCache:acme/repo#1': { fingerprint: 'x', items },
      'review:acme/repo#2': { fingerprint: 'x', items: 'not a list' },
      'review:acme/repo#3': { fingerprint: 'x', items, index: 0, savedAt: Date.now() },
      skipViewed: false,
    });
    await saveCachedReview(pr, review);

    expect(await storedKeys()).toEqual(['review:acme/repo#12', 'skipViewed']);
  });
});

describe('when storage is full', () => {
  const quotaExceeded = () => new Error('QUOTA_BYTES quota exceeded');

  test('drops the least recently opened reviews until the new one fits', async () => {
    for (const number of [1, 2, 3]) {
      await saveCachedReview({ ...pr, number }, review);
      advance(1000);
    }
    // Opening #1 again makes #2 the oldest
    await saveProgress({ ...pr, number: 1 }, 'v1', 1);

    vi.spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(quotaExceeded())
      .mockRejectedValueOnce(quotaExceeded());
    await saveCachedReview(pr, review);

    expect(await storedKeys()).toEqual(['review:acme/repo#1', 'review:acme/repo#12']);
  });

  test('gives up when there is nothing left to drop', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(quotaExceeded());
    await expect(saveCachedReview(pr, review)).rejects.toThrow('quota');
  });

  test('keeps other reviews when the write failed for another reason', async () => {
    await saveCachedReview(other, review);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('Extension context invalidated'));

    await expect(saveCachedReview(pr, review)).rejects.toThrow('invalidated');
    expect(await storedKeys()).toEqual(['review:acme/repo#13']);
  });
});
