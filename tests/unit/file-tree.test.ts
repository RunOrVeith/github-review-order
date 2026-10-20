import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearTreeMarks,
  findTree,
  findTreeEntries,
  markTreeEntries,
  reviewSteps,
  scrollTopToReveal,
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
    markTreeEntries(findTreeEntries(document), reviewSteps([C, A].map(file)), file(A));

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
    markTreeEntries(entries, reviewSteps([A, B, C].map(file)), file(A));
    markTreeEntries(entries, reviewSteps([A, B, C].map(file)), file(B));

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
    markTreeEntries(entries, reviewSteps([C, A].map(file)), file(A));

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    markTreeEntries(entries, reviewSteps([C, A].map(file)), file(A));
    await Promise.resolve();
    observer.disconnect();

    expect(records).toEqual([]);
  });
});

describe('markTreeEntries badges', () => {
  const marker = (anchor: string) => entry(anchor).querySelectorAll(':scope > [data-review-order-marker]');

  test('adds one badge per file and none to folders', () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, reviewSteps([C, A].map(file)), file(A));
    markTreeEntries(entries, reviewSteps([C, A].map(file)), file(C));

    expect(marker(C)).toHaveLength(1);
    expect(marker(C)[0]?.textContent).toBe('1');
    expect(marker(A)[0]?.textContent).toBe('2');
    expect(marker(B)[0]?.textContent).toBe('!');
    expect(marker(A)[0]?.getAttribute('aria-hidden')).toBe('true');
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

describe('reviewSteps', () => {
  test('keeps the first step of a file listed twice', () => {
    expect(reviewSteps([A, B, A].map(file))).toEqual(
      new Map([
        [file(A).path, 1],
        [A, 1],
        [file(B).path, 2],
        [B, 2],
      ]),
    );
  });
});

describe('clearTreeMarks', () => {
  test('removes every marker and only the titles it added', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([A].map(file)), file(A));
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

  test('marks files by path', () => {
    markTreeEntries(findTreeEntries(document), reviewSteps([b, a]), a);

    expect(document.getElementById('src/b.ts')!.dataset.reviewOrderStep).toBe('1');
    expect(document.getElementById('src/a.ts')!.dataset.reviewOrderStep).toBe('2');
    expect(document.getElementById('src/a.ts')!.hasAttribute('data-review-order-current')).toBe(true);
    expect(document.getElementById('README.md')!.hasAttribute('data-review-order-unlisted')).toBe(true);
    expect(document.getElementById('src')!.hasAttribute('data-review-order-unlisted')).toBe(false);
  });
});
