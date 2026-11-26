import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  ALL_SETTINGS,
  loadSettings,
  minMovedLines,
  SETTINGS,
  showMovedLines,
  skipViewed,
  watchSettings,
} from '@/utils/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

test('everything is on until turned off', async () => {
  expect(await loadSettings()).toEqual({ skipViewed: true, autoAdvance: true, showMovedLines: true, minMovedLines: 3 });
});

test('keeps the storage keys earlier versions used, so choices made in the panel carry over', async () => {
  await fakeBrowser.storage.local.set({ skipViewed: false, autoAdvance: false });
  expect(await loadSettings()).toMatchObject({ skipViewed: false, autoAdvance: false, showMovedLines: true });
});

test('lists every setting once, with something to say about it', () => {
  expect(SETTINGS.map((setting) => setting.key)).toEqual(['skipViewed', 'autoAdvance', 'showMovedLines']);
  // The minimum only matters while moved lines are shown
  expect(SETTINGS[2]!.children?.map((setting) => setting.key)).toEqual(['minMovedLines']);
  expect(ALL_SETTINGS).toHaveLength(4);
  for (const setting of ALL_SETTINGS) expect(setting.hint).not.toBe('');
});

test.each([
  [0, 1],
  [2.6, 3],
  [99, 20],
  ['5', 3],
  [Number.NaN, 3],
])('keeps a stored minimum of %s in range, as %s', async (stored, used) => {
  await fakeBrowser.storage.local.set({ minMovedLines: stored });
  expect((await loadSettings()).minMovedLines).toBe(used);
});

test('calls back with each change until stopped', async () => {
  const onChange = vi.fn();
  const stop = watchSettings(onChange);

  await showMovedLines.setValue(false);
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('showMovedLines', false));

  await minMovedLines.setValue(50);
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('minMovedLines', 20));

  stop();
  await skipViewed.setValue(false);
  expect(onChange).toHaveBeenCalledTimes(2);
});
