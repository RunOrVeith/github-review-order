import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ContentScriptContext } from '#imports';
import { createTreeMarkers, type TreeMarkers } from '@/entrypoints/review-order.content/tree-markers';

const A = `diff-${'a'.repeat(64)}`;
const B = `diff-${'b'.repeat(64)}`;

const ctx = { onInvalidated: () => () => {} } as unknown as ContentScriptContext;

function treeHtml() {
  return [A, B]
    .map((anchor) => `<li role="treeitem" id="file-tree-item-${anchor}"><a href="#${anchor}">f</a></li>`)
    .join('');
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const entry = (anchor: string) => document.getElementById(`file-tree-item-${anchor}`)!;

let markers: TreeMarkers;

beforeEach(async () => {
  document.body.innerHTML = `<nav><ul role="tree">${treeHtml()}</ul></nav><main></main>`;
  markers = createTreeMarkers(ctx, [A]);
  // Let the pass triggered by the badges it just added run
  await nextFrame();
});

afterEach(() => {
  markers.stop();
  vi.restoreAllMocks();
});

test('marks the tree right away', () => {
  expect(entry(A).dataset.reviewOrderStep).toBe('1');
  expect(entry(B).hasAttribute('data-review-order-unlisted')).toBe(true);
});

test('does nothing once stopped, even for a navigation still in flight', () => {
  markers.stop();
  markers.setCurrent(0);

  expect(document.querySelectorAll('[data-review-order-step], [data-review-order-current]')).toHaveLength(0);
  expect(document.querySelectorAll('[data-review-order-marker]')).toHaveLength(0);
});

test('marks the tree again when GitHub replaces it', async () => {
  document.querySelector('nav')!.innerHTML = `<ul role="tree">${treeHtml()}</ul>`;
  await Promise.resolve();
  await nextFrame();

  expect(entry(A).dataset.reviewOrderStep).toBe('1');
});

test('ignores changes outside the tree', async () => {
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

  document.querySelector('main')!.append(document.createElement('div'));
  await Promise.resolve();
  expect(requestFrame).not.toHaveBeenCalled();

  document.querySelector('[role="tree"]')!.append(document.createElement('li'));
  await Promise.resolve();
  expect(requestFrame).toHaveBeenCalledOnce();
});
