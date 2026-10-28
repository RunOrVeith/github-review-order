import { beforeEach, describe, expect, test, vi } from 'vitest';
import { diffAnchorId } from '@/utils/github';
import {
  clearTreeMarks,
  createAnchorKeys,
  findTree,
  findTreeEntries,
  hasUnreadableTree,
  markTreeEntries,
  reviewSteps,
  scrollTopToReveal,
  treeEntryPath,
} from '@/utils/file-tree';

const A = `diff-${'a'.repeat(64)}`;
const B = `diff-${'b'.repeat(64)}`;
const C = `diff-${'c'.repeat(64)}`;

// The classic tree identifies files by anchor, so the path doesn't matter here
const file = (anchor: string) => ({ path: `path-of-${anchor}`, anchor });

// Trimmed from GitHub's classic file tree (https://github.com/microsoft/vscode/pull/342841/files)
function fileEntry(anchor: string, path: string, extra = '') {
  return `
    <li id="file-tree-item-${anchor}" class="ActionList-item ActionList-item--subItem js-tree-node"
        role="treeitem" aria-level="2" data-tree-entry-type="file" ${extra}>
      <span data-filterable-item-text hidden>${path}</span>
      <a class="ActionList-content" href="#${anchor}" data-turbo="false">
        <span class="ActionList-item-label">${path.split('/').pop()}</span>
      </a>
    </li>`;
}

function renderTree() {
  document.body.innerHTML = `
    <file-tree>
      <nav aria-label="File Tree Navigation">
        <ul class="ActionList ActionList--tree" role="tree" aria-label="File Tree">
          <li class="ActionList-item ActionList-item--hasSubItem js-tree-node" role="treeitem"
              aria-level="1" data-tree-entry-type="directory">
            <button class="ActionList-content"><span class="ActionList-item-label">src</span></button>
            <ul class="ActionList ActionList--subGroup" role="group">
              ${fileEntry(A, 'src/a.ts')}
              ${fileEntry(B, 'src/b.ts', 'title="GitHub tooltip"')}
            </ul>
          </li>
          <li class="ActionList-item ActionList-item--hasSubItem js-tree-node" role="treeitem"
              aria-level="1" data-tree-entry-type="directory">
            <button class="ActionList-content"><span class="ActionList-item-label">docs</span></button>
            <ul class="ActionList ActionList--subGroup" role="group">
              <li class="ActionList-item" role="treeitem" data-tree-entry-type="file">
                <a class="ActionList-content" href="#${C}">README.md</a>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </file-tree>`;
}

function entry(anchor: string): HTMLElement {
  return findTreeEntries(document).get(anchor)!;
}

beforeEach(renderTree);

describe('findTreeEntries', () => {
  test('finds files by their anchor and skips folders', () => {
    const entries = findTreeEntries(document);

    expect([...entries.keys()]).toEqual([A, B, C]);
    expect(entries.get(A)?.id).toBe(`file-tree-item-${A}`);
  });

  test("reads the anchor from the entry's link when it has no id", () => {
    expect(entry(C).querySelector('a')?.textContent).toBe('README.md');
  });

  test('finds the same entries when given the tree itself', () => {
    expect([...findTreeEntries(findTree(document)!).keys()]).toEqual([A, B, C]);
  });

  test('ignores lists outside the file tree', () => {
    document.body.innerHTML = `<ul><li role="treeitem" id="file-tree-item-${A}"></li></ul>`;
    expect(findTreeEntries(document).size).toBe(0);
  });
});

describe('markTreeEntries', () => {
  test('numbers files in the order, warns about the rest and marks the current one', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([C, A].map(file)), A);

    expect(entry(C).dataset.reviewOrderStep).toBe('1');
    expect(entry(A).dataset.reviewOrderStep).toBe('2');
    expect(entry(A).hasAttribute('data-review-order-current')).toBe(true);
    expect(entry(C).hasAttribute('data-review-order-current')).toBe(false);

    expect(entry(B).hasAttribute('data-review-order-step')).toBe(false);
    expect(entry(B).hasAttribute('data-review-order-unlisted')).toBe(true);
    expect(entry(A).hasAttribute('data-review-order-unlisted')).toBe(false);
  });

  test('moves the current marker', () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([A, B, C].map(file)), A);
    markTreeEntries(entries, reviewSteps([A, B, C].map(file)), B);

    expect(entry(A).hasAttribute('data-review-order-current')).toBe(false);
    expect(entry(B).hasAttribute('data-review-order-current')).toBe(true);
  });

  test('explains the warning without replacing titles GitHub set', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([]), null);

    expect(entry(A).title).toBe('Not in the review order');
    expect(entry(B).title).toBe('GitHub tooltip');
  });

  test('changes nothing when called again with the same state', async () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([C, A].map(file)), A);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    markTreeEntries(entries, reviewSteps([C, A].map(file)), A);
    await Promise.resolve();
    observer.disconnect();

    expect(records).toEqual([]);
  });
});

describe('markTreeEntries badges', () => {
  const marker = (anchor: string) =>
    entry(anchor).querySelectorAll(':scope > [data-review-order-badges] > [data-review-order-marker]');

  test('adds one badge per file and none to folders', () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([C, A].map(file)), A);
    markTreeEntries(entries, reviewSteps([C, A].map(file)), C);

    expect(marker(C)).toHaveLength(1);
    expect(marker(C)[0]?.textContent).toBe('1');
    expect(marker(A)[0]?.textContent).toBe('2');
    expect(marker(B)[0]?.textContent).toBe('!');
    expect(marker(A)[0]?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('[data-review-order-marker]')).toHaveLength(3);
  });

  test('updates the badge when the order changes', () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([A].map(file)), null);
    markTreeEntries(entries, reviewSteps([B, A].map(file)), null);

    expect(marker(A)[0]?.textContent).toBe('2');
    expect(marker(B)[0]?.textContent).toBe('1');
  });
});

describe('markTreeEntries eyes', () => {
  const eye = (anchor: string) => entry(anchor).querySelector('[data-review-order-eye]');

  test('puts an eye in front of the badge of every viewed file, listed or not', () => {
    const viewed = new Set([A, B]);
    markTreeEntries(findTreeEntries(document), reviewSteps([A, C].map(file)), null, (key) => viewed.has(key));

    // B isn't in the order, so its badge is the warning
    for (const anchor of [A, B]) {
      expect(entry(anchor).hasAttribute('data-review-order-viewed')).toBe(true);
      expect(eye(anchor)?.nextElementSibling?.hasAttribute('data-review-order-marker')).toBe(true);
    }
    expect(eye(B)?.nextElementSibling?.textContent).toBe('!');
    expect(entry(C).hasAttribute('data-review-order-viewed')).toBe(false);
    expect(eye(C)).toBeNull();
  });

  test('takes the eye away again when a file is unticked', () => {
    const viewed = new Set([A]);
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([A].map(file)), null, (key) => viewed.has(key));

    viewed.delete(A);
    markTreeEntries(entries, reviewSteps([A].map(file)), null, (key) => viewed.has(key));

    expect(eye(A)).toBeNull();
    expect(entry(A).hasAttribute('data-review-order-viewed')).toBe(false);
    expect(entry(A).querySelector('[data-review-order-marker]')?.textContent).toBe('1');
  });

  test('changes nothing when called again with the same states', async () => {
    const entries = findTreeEntries(document);
    const isViewed = (key: string) => key === A;
    markTreeEntries(entries, reviewSteps([A].map(file)), null, isViewed);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    markTreeEntries(entries, reviewSteps([A].map(file)), null, isViewed);
    await Promise.resolve();
    observer.disconnect();

    expect(records).toEqual([]);
  });

  test('is removed with the other marks', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([A].map(file)), null, () => true);
    clearTreeMarks(document);

    expect(document.querySelectorAll('[data-review-order-eye], [data-review-order-badges]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-review-order-viewed]')).toHaveLength(0);
  });
});

describe('treeEntryPath', () => {
  test("reads the classic tree's full path", () => {
    expect(treeEntryPath(entry(A))).toBe('src/a.ts');
  });

  test("falls back to the file's name", () => {
    expect(treeEntryPath(entry(C))).toBe('README.md');
  });
});

describe('reviewSteps', () => {
  test('keeps the first step of a file listed twice', () => {
    expect(reviewSteps([A, B, A].map(file))).toEqual(
      new Map([
        [A, 1],
        [B, 2],
      ]),
    );
  });
});

describe('clearTreeMarks', () => {
  test('removes every marker and only the titles it added', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([A].map(file)), A);
    clearTreeMarks(document);

    for (const anchor of [A, B, C]) {
      const attributes = entry(anchor).getAttributeNames().filter((name) => name.startsWith('data-review-order'));
      expect(attributes).toEqual([]);
    }
    expect(entry(C).hasAttribute('title')).toBe(false);
    expect(entry(B).title).toBe('GitHub tooltip');
    expect(document.querySelectorAll('[data-review-order-marker]')).toHaveLength(0);
  });

  test('keeps a title GitHub set after ours', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([]), null);
    entry(A).title = 'src/a.ts';
    clearTreeMarks(document);

    expect(entry(A).title).toBe('src/a.ts');
  });
});

describe('scrollTopToReveal', () => {
  const container = { top: 100, bottom: 400, height: 300 };

  test('leaves visible items alone', () => {
    expect(scrollTopToReveal(container, { top: 150, bottom: 180, height: 30 }, 50)).toBeNull();
  });

  test('centres items below the visible area', () => {
    // Item centre is 500px below the container's top, the container's centre 150px
    expect(scrollTopToReveal(container, { top: 585, bottom: 615, height: 30 }, 50)).toBe(400);
  });

  test('centres items above the visible area, but never past the top', () => {
    expect(scrollTopToReveal(container, { top: 40, bottom: 70, height: 30 }, 200)).toBe(5);
    expect(scrollTopToReveal(container, { top: 40, bottom: 70, height: 30 }, 50)).toBe(0);
  });
});

describe('the /changes tree', () => {
  // Trimmed from GitHub's /changes view: Primer React's TreeView, with the file's path as its id
  function reactFile(path: string) {
    return `
      <li aria-level="2" class="PRIVATE_TreeView-item" tabindex="-1" id="${path}" role="treeitem"
          aria-label="${path.split('/').pop()}" aria-describedby="_r_251_" aria-selected="false">
        <div class="PRIVATE_TreeView-item-container" style="--level: 2;">
          <div id="_r_250_" class="PRIVATE_TreeView-item-content">
            <div class="PRIVATE_VisuallyHidden" aria-hidden="true" id="_r_251_"></div>
            <span class="PRIVATE_TreeView-item-content-text">${path.split('/').pop()}</span>
          </div>
        </div>
      </li>`;
  }

  const a = { path: 'src/a.ts', anchor: A };
  const b = { path: 'src/b.ts', anchor: B };

  beforeEach(() => {
    document.body.innerHTML = `
      <ul role="tree" aria-label="File Tree">
        <li id="src" role="treeitem" aria-level="1" aria-expanded="true" aria-label="src">
          <div class="PRIVATE_TreeView-item-container"><span>src</span></div>
          <ul role="group">${reactFile(a.path)}${reactFile(b.path)}</ul>
        </li>
        ${reactFile('README.md')}
      </ul>`;
  });

  test('finds files by path and skips folders and React ids', () => {
    expect([...findTreeEntries(document).keys()]).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(findTree(document)).toBe(document.querySelector('[role="tree"]'));
  });

  test('reads the path from the id', () => {
    expect(treeEntryPath(document.getElementById('src/b.ts')!)).toBe('src/b.ts');
  });

  test('marks files by path once they are keyed by anchor', async () => {
    const onHashed = vi.fn();
    const keyByAnchor = createAnchorKeys([b, a], onHashed);
    markTreeEntries(keyByAnchor(findTreeEntries(document)), reviewSteps([b, a]), A);

    expect(document.getElementById('src/b.ts')!.dataset.reviewOrderStep).toBe('1');
    expect(document.getElementById('src/a.ts')!.dataset.reviewOrderStep).toBe('2');
    expect(document.getElementById('src/a.ts')!.hasAttribute('data-review-order-current')).toBe(true);
    expect(document.getElementById('src')!.hasAttribute('data-review-order-unlisted')).toBe(false);

    // README.md isn't in the order, so it's only marked once its path is hashed
    expect(document.getElementById('README.md')!.hasAttribute('data-review-order-unlisted')).toBe(false);
    await vi.waitFor(() => expect(onHashed).toHaveBeenCalledOnce());
    markTreeEntries(keyByAnchor(findTreeEntries(document)), reviewSteps([b, a]), A);
    expect(document.getElementById('README.md')!.hasAttribute('data-review-order-unlisted')).toBe(true);
  });
});

describe('createAnchorKeys', () => {
  const entries = (...keys: string[]) => new Map(keys.map((key) => [key, document.createElement('li')]));

  test('keeps anchors and uses the known files right away', () => {
    const keyByAnchor = createAnchorKeys([{ path: 'src/a.ts', anchor: A }], () => {});
    expect([...keyByAnchor(entries(B, 'src/a.ts')).keys()]).toEqual([B, A]);
  });

  test('hashes the unknown paths of a pass in one batch', async () => {
    const onHashed = vi.fn();
    const keyByAnchor = createAnchorKeys([], onHashed);

    expect(keyByAnchor(entries('src/x.ts', 'src/y.ts')).size).toBe(0);
    // A second pass while the batch is running doesn't start another one
    keyByAnchor(entries('src/x.ts', 'src/y.ts'));
    await vi.waitFor(() => expect(onHashed).toHaveBeenCalledOnce());

    expect([...keyByAnchor(entries('src/x.ts', 'src/y.ts')).keys()]).toEqual([
      await diffAnchorId('src/x.ts'),
      await diffAnchorId('src/y.ts'),
    ]);
    expect(onHashed).toHaveBeenCalledOnce();
  });
});

describe('hasUnreadableTree', () => {
  test('is false for a tree it can read, and for a page without one', () => {
    expect(hasUnreadableTree(document)).toBe(false);
    document.body.innerHTML = '<main></main>';
    expect(hasUnreadableTree(document)).toBe(false);
  });

  test('is false while only folders are rendered', () => {
    document.body.innerHTML = '<ul role="tree"><li role="treeitem" aria-expanded="false">src</li></ul>';
    expect(hasUnreadableTree(document)).toBe(false);
  });

  test('is true when files have nothing that identifies them', () => {
    document.body.innerHTML = '<ul role="tree"><li role="treeitem" id="_r_1_">a.ts</li></ul>';
    expect(hasUnreadableTree(document)).toBe(true);
  });
});
