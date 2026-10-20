import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadProgress, saveProgress } from '@/utils/progress';

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
