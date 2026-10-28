import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentScriptContext } from '#imports';
import { diffAnchorId } from '@/utils/github';
import {
  createTreeMarkers,
  NONE_IN_TREE,
  UNREADABLE_TREE,
  type TreeMarkers,
} from '@/entrypoints/review-order.content/tree-markers';

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
let onProblem: ReturnType<typeof vi.fn<(problem: string | null) => void>>;

beforeEach(async () => {
  document.body.innerHTML = `<nav><ul role="tree">${treeHtml()}</ul></nav><main></main>`;
  onProblem = vi.fn();
  markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { onProblem });
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
  markers.setCurrent(A);

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

test('reports no problem while the tree shows the order', () => {
  expect(onProblem).not.toHaveBeenCalled();
});

describe('when the tree does not have any of the files', () => {
  const C = `diff-${'c'.repeat(64)}`;

  test('marks nothing rather than flagging every file, and says why', () => {
    markers.stop();
    const report = vi.fn();
    markers = createTreeMarkers(ctx, [{ path: 'src/c.ts', anchor: C }], { onProblem: report });

    expect(document.querySelectorAll('[data-review-order-unlisted], [data-review-order-marker]')).toHaveLength(0);
    expect(report).toHaveBeenLastCalledWith(NONE_IN_TREE);
  });

  test('removes its marks once the files are gone, and puts them back when they return', async () => {
    const nav = document.querySelector('nav')!;
    nav.innerHTML = `<ul role="tree"><li role="treeitem" id="file-tree-item-${C}"><a href="#${C}">f</a></li></ul>`;
    await nextFrame();

    expect(document.querySelectorAll('[data-review-order-marker]')).toHaveLength(0);
    expect(onProblem).toHaveBeenLastCalledWith(NONE_IN_TREE);

    nav.innerHTML = `<ul role="tree">${treeHtml()}</ul>`;
    await nextFrame();

    expect(entry(A).dataset.reviewOrderStep).toBe('1');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });
});

test("says when GitHub's tree can't be read", async () => {
  // Files without the ids or links that identify them
  document.querySelector('nav')!.innerHTML = '<ul role="tree"><li role="treeitem">a.ts</li></ul>';
  await nextFrame();

  expect(onProblem).toHaveBeenLastCalledWith(UNREADABLE_TREE);
});

test('reports nothing when the page has no file tree', async () => {
  // E.g. with the sidebar collapsed
  document.querySelector('nav')!.remove();
  await nextFrame();

  expect(onProblem).not.toHaveBeenCalled();
});

test('marks the current file, also one left out of the order', () => {
  expect(markers.setCurrent(B)).toBe(true);
  expect(entry(B).hasAttribute('data-review-order-current')).toBe(true);

  expect(markers.setCurrent(A)).toBe(true);
  expect(entry(B).hasAttribute('data-review-order-current')).toBe(false);
  expect(markers.setCurrent(`diff-${'c'.repeat(64)}`)).toBe(false);
});

describe('files left out of the order', () => {
  const C = `diff-${'c'.repeat(64)}`;
  const treeEntry = (anchor: string, path: string) =>
    `<li role="treeitem" id="file-tree-item-${anchor}"><span data-filterable-item-text hidden>${path}</span><a href="#${anchor}">${path}</a></li>`;

  test('are reported right away, in the order of the tree', () => {
    markers.stop();
    document.querySelector('[role="tree"]')!.innerHTML = treeEntry(C, 'src/c.ts') + treeEntry(A, 'src/a.ts') + treeEntry(B, 'src/b.ts');
    const onUnlisted = vi.fn();
    markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { onUnlisted });

    expect(onUnlisted).toHaveBeenCalledExactlyOnceWith([
      { path: 'src/c.ts', anchor: C },
      { path: 'src/b.ts', anchor: B },
    ]);
  });

  test('are kept when GitHub stops rendering them, and new ones are added', async () => {
    markers.stop();
    const onUnlisted = vi.fn();
    markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { onUnlisted });
    onUnlisted.mockClear();

    // Like collapsing a folder, then expanding another one
    entry(B).remove();
    await Promise.resolve();
    await nextFrame();
    expect(onUnlisted).not.toHaveBeenCalled();

    document.querySelector('[role="tree"]')!.insertAdjacentHTML('beforeend', treeEntry(C, 'src/c.ts'));
    await Promise.resolve();
    await nextFrame();
    expect(onUnlisted).toHaveBeenCalledExactlyOnceWith([
      { path: 'f', anchor: B },
      { path: 'src/c.ts', anchor: C },
    ]);
  });
});

describe('viewed files', () => {
  /** Stands in for the page's viewed states; set() ticks or unticks a file and tells the watchers. */
  function fakeViewed(initial: string[]) {
    const viewed = new Set(initial);
    const listeners = new Set<() => void>();
    return {
      isViewed: (anchor: string) => viewed.has(anchor),
      watch: vi.fn((onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      }),
      set(anchor: string, isViewed: boolean) {
        if (isViewed) viewed.add(anchor);
        else viewed.delete(anchor);
        for (const listener of listeners) listener();
      },
      listeners,
    };
  }

  const eye = (element: Element) => element.querySelector('[data-review-order-eye]');

  test('get an eye right away in a tree keyed by anchor', () => {
    markers.stop();
    markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { viewed: fakeViewed([B]) });

    expect(eye(entry(B))).not.toBeNull();
    expect(eye(entry(A))).toBeNull();
  });

  test("get an eye in the /changes tree once the path's anchor is known", async () => {
    markers.stop();
    const unlisted = await diffAnchorId('src/b.ts');
    document.body.innerHTML = `
      <ul role="tree">
        <li role="treeitem" id="src/a.ts">a.ts</li>
        <li role="treeitem" id="src/b.ts">b.ts</li>
      </ul>`;
    markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { viewed: fakeViewed([A, unlisted]) });

    // The listed file's anchor is known, the unlisted one's is still being hashed
    expect(eye(document.getElementById('src/a.ts')!)).not.toBeNull();
    await vi.waitFor(() => expect(eye(document.getElementById('src/b.ts')!)).not.toBeNull());
  });

  test('are shown without a review order, which reports no problems or files left out', async () => {
    markers.stop();
    const viewed = fakeViewed([B]);
    onProblem.mockClear();
    const onUnlisted = vi.fn();
    markers = createTreeMarkers(ctx, null, { viewed, onProblem, onUnlisted });

    expect(eye(entry(B))).not.toBeNull();
    expect(document.querySelectorAll('[data-review-order-marker]')).toHaveLength(0);

    viewed.set(A, true);
    await nextFrame();
    expect(eye(entry(A))).not.toBeNull();
    expect(onProblem).not.toHaveBeenCalled();
    expect(onUnlisted).not.toHaveBeenCalled();
  });

  test('follow files being ticked and unticked, until stopped', async () => {
    markers.stop();
    const viewed = fakeViewed([]);
    markers = createTreeMarkers(ctx, [{ path: 'src/a.ts', anchor: A }], { viewed });

    viewed.set(A, true);
    await nextFrame();
    expect(eye(entry(A))).not.toBeNull();

    viewed.set(A, false);
    await nextFrame();
    expect(eye(entry(A))).toBeNull();

    markers.stop();
    expect(viewed.listeners.size).toBe(0);
  });
});
