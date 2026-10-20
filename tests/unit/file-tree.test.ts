import { beforeEach, describe, expect, test } from 'vitest';
import { clearTreeMarks, findTreeEntries, markTreeEntries, scrollTopToReveal } from '@/utils/file-tree';

const A = `diff-${'a'.repeat(64)}`;
const B = `diff-${'b'.repeat(64)}`;
const C = `diff-${'c'.repeat(64)}`;

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

  test('ignores lists outside the file tree', () => {
    document.body.innerHTML = `<ul><li role="treeitem" id="file-tree-item-${A}"></li></ul>`;
    expect(findTreeEntries(document).size).toBe(0);
  });
});

describe('markTreeEntries', () => {
  test('numbers files in the order, warns about the rest and marks the current one', () => {
    markTreeEntries(findTreeEntries(document), [C, A], A);

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
    markTreeEntries(entries, [A, B, C], A);
    markTreeEntries(entries, [A, B, C], B);

    expect(entry(A).hasAttribute('data-review-order-current')).toBe(false);
    expect(entry(B).hasAttribute('data-review-order-current')).toBe(true);
  });

  test('explains the warning without replacing titles GitHub set', () => {
    markTreeEntries(findTreeEntries(document), [], null);

    expect(entry(A).title).toBe('Not in the review order');
    expect(entry(B).title).toBe('GitHub tooltip');
  });

  test('changes nothing when called again with the same state', async () => {
    const entries = findTreeEntries(document);
    markTreeEntries(entries, [C, A], A);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    markTreeEntries(entries, [C, A], A);
    await Promise.resolve();
    observer.disconnect();

    expect(records).toEqual([]);
  });
});

describe('clearTreeMarks', () => {
  test('removes every marker and only the titles it added', () => {
    markTreeEntries(findTreeEntries(document), [A], A);
    clearTreeMarks(document);

    for (const anchor of [A, B, C]) {
      const attributes = entry(anchor).getAttributeNames().filter((name) => name.startsWith('data-review-order'));
      expect(attributes).toEqual([]);
    }
    expect(entry(C).hasAttribute('title')).toBe(false);
    expect(entry(B).title).toBe('GitHub tooltip');
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
