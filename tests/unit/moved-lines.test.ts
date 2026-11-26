import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentScriptContext } from '#imports';
import { diffAnchorId, type PullRef } from '@/utils/github';
import { FETCH_DIFF } from '@/utils/messages';
import type { MovedBlock } from '@/utils/moves';
import {
  createMovedLines,
  moveHints,
  movedLinesCss,
  type MovedLines,
} from '@/entrypoints/review-order.content/moved-lines';

const OLD = 'src/old.ts';
const NEW = 'src/new.ts';
let anchors: Map<string, string>;

beforeEach(async () => {
  anchors = new Map([
    [OLD, await diffAnchorId(OLD)],
    [NEW, await diffAnchorId(NEW)],
  ]);
});

const moved: MovedBlock = { from: { path: OLD, start: 10, end: 12 }, to: { path: NEW, start: 40, end: 42 }, inPlace: false };

/** A file's diff as GitHub's unified view renders it: removed lines, then added ones. */
function unifiedTable(path: string, removed: number[], added: number[]): string {
  const anchor = anchors.get(path)!;
  const removedRow = (line: number) => `
    <tr class="diff-line-row">
      <td data-diff-side="left" data-line-number="${line}" data-first-unified-line-number-cell="true">${line}</td>
      <td class="empty-diff-line"></td>
      <td data-diff-side="left" data-line-number="${line}" data-line-anchor="${anchor}L${line}"><code>-x</code></td>
    </tr>`;
  const addedRow = (line: number) => `
    <tr class="diff-line-row">
      <td class="empty-diff-line"></td>
      <td data-diff-side="right" data-line-number="${line}" data-first-unified-line-number-cell="false">${line}</td>
      <td data-diff-side="right" data-line-number="${line}" data-line-anchor="${anchor}R${line}"><code>+x</code></td>
    </tr>`;
  return `<table data-diff-anchor="${anchor}"><tbody>${removed.map(removedRow).join('')}${added.map(addedRow).join('')}</tbody></table>`;
}

/** The cells the stylesheet's rules select, as "side line" plus "code" or "number" or "blank". */
function styledCells(css: string): Map<string, string[]> {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const cells = new Map<string, string[]>();
  for (const rule of Array.from(style.sheet!.cssRules) as CSSStyleRule[]) {
    for (const cell of Array.from(document.querySelectorAll(rule.selectorText))) {
      const file = cell.closest('table')!.getAttribute('data-diff-anchor') === anchors.get(OLD) ? 'old' : 'new';
      const row = cell.closest('tr')!.querySelector('[data-line-number]')!;
      const kind = cell.hasAttribute('data-line-anchor') ? 'code' : cell.hasAttribute('data-line-number') ? 'number' : 'blank';
      const key = `${file} ${row.getAttribute('data-diff-side')} ${row.getAttribute('data-line-number')}`;
      cells.set(key, [...(cells.get(key) ?? []), kind]);
    }
  }
  style.remove();
  return cells;
}

describe('movedLinesCss', () => {
  test('stripes the code of removed and added lines, but not their numbers', () => {
    document.body.innerHTML = unifiedTable(OLD, [9, 10, 11, 12, 13], []) + unifiedTable(NEW, [], [39, 40, 41, 42, 43]);
    const cells = styledCells(movedLinesCss([moved], anchors));

    expect(Object.fromEntries(cells)).toEqual({
      'old left 10': ['code'],
      'old left 11': ['code'],
      'old left 12': ['code'],
      'new right 40': ['code'],
      'new right 41': ['code'],
      'new right 42': ['code'],
    });
  });

  test('leaves the same line numbers in other files alone', () => {
    document.body.innerHTML = unifiedTable(NEW, [10, 11, 12], []) + unifiedTable(OLD, [], [40, 41, 42]);
    expect(styledCells(movedLinesCss([moved], anchors)).size).toBe(0);
  });

  test('is empty without moves', () => {
    expect(movedLinesCss([], anchors)).toBe('');
  });
});

describe('moveHints', () => {
  test('each end of a move links to the other', () => {
    const hints = moveHints([moved], anchors);
    const oldAnchor = anchors.get(OLD)!;
    const newAnchor = anchors.get(NEW)!;

    expect(hints.get(`${oldAnchor}L11`)).toEqual({
      text: 'Moved to',
      link: { label: 'src/new.ts lines 40–42', line: { fileAnchor: newAnchor, side: 'right', line: 40 } },
    });
    expect(hints.get(`${newAnchor}R42`)).toEqual({
      text: 'Moved from',
      link: { label: 'src/old.ts lines 10–12', line: { fileAnchor: oldAnchor, side: 'left', line: 10 } },
    });
    // Lines of one block share their hint, so it stays put while moving along them
    expect(hints.get(`${oldAnchor}L10`)).toBe(hints.get(`${oldAnchor}L12`));
  });

  test('says "in this file" for moves within a file, and needs no link for re-indenting in place', () => {
    const within: MovedBlock = { from: { path: OLD, start: 5, end: 5 }, to: { path: OLD, start: 90, end: 90 }, inPlace: false };
    const inPlace: MovedBlock = { from: { path: NEW, start: 3, end: 4 }, to: { path: NEW, start: 3, end: 4 }, inPlace: true };
    const hints = moveHints([within, inPlace], anchors);

    expect(hints.get(`${anchors.get(OLD)}R90`)?.link?.label).toBe('line 5 in this file');
    expect(hints.get(`${anchors.get(NEW)}L4`)).toEqual({ text: 'Only the indentation changed', link: null });
    expect(hints.get(`${anchors.get(NEW)}R3`)).toEqual({ text: 'Only the indentation changed', link: null });
  });
});

describe('createMovedLines', () => {
  const pr: PullRef = { owner: 'acme', repo: 'repo', number: 1, isChangesTab: true };
  const WHOLE = 'https://github.com/acme/repo/pull/1/changes';
  const ctx = { onInvalidated: () => () => {} } as unknown as ContentScriptContext;
  const FUNCTION = ['function resolveRecipient(talent) {', '  return talent.address;', '}'];
  const DIFF = [
    `--- a/${OLD}`,
    `+++ b/${OLD}`,
    '@@ -10,3 +9,0 @@',
    ...FUNCTION.map((line) => `-${line}`),
    `--- a/${NEW}`,
    `+++ b/${NEW}`,
    '@@ -39,0 +40,3 @@',
    ...FUNCTION.map((line) => `+${line}`),
    '',
  ].join('\n');

  let lines: MovedLines | undefined;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = unifiedTable(OLD, [10, 11, 12], []) + unifiedTable(NEW, [], [40, 41, 42]);
    sendMessage = vi.fn(async () => ({ diff: DIFF }));
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(sendMessage as never);
  });

  afterEach(() => {
    lines?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // The style that colours moves, once the diff has been read
  const pageStyle = () =>
    Array.from(document.head.querySelectorAll('style')).find((style) => style.textContent?.includes('repeating-linear-gradient'));
  const hint = () => document.querySelector('[data-review-order-move-hint]')?.shadowRoot?.querySelector('.hint');
  const code = (path: string, side: 'L' | 'R', line: number) =>
    document.querySelector(`[data-line-anchor="${anchors.get(path)}${side}${line}"]`)!;
  const hover = (element: Element) => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  async function start(url = WHOLE) {
    lines = createMovedLines(ctx, pr, url);
    await vi.waitFor(() => expect(pageStyle()).toBeDefined());
  }

  test('asks the background for the diff and colours what moved', async () => {
    await start();

    expect(sendMessage).toHaveBeenCalledWith({ type: FETCH_DIFF, pr: { owner: 'acme', repo: 'repo', number: 1 } });
    expect(pageStyle()!.textContent).toContain(`${anchors.get(OLD)}"] td[data-diff-side="left"][data-line-number="11"]`);
    expect(pageStyle()!.media).toBe('all');
  });

  test('hovering a moved line says where it went, and the link jumps there', async () => {
    await start();
    hover(code(OLD, 'L', 11).querySelector('code')!);
    expect(hint()).toHaveTextContent('Moved to src/new.ts lines 40–42');

    const target = code(NEW, 'R', 40);
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    hint()!.querySelector('a')!.click();

    // GitHub only follows file anchors, so the file is what the URL points at
    expect(location.hash).toBe(`#${anchors.get(NEW)}`);
    expect(hint()).toBeUndefined();
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalledWith({ block: 'center' }));
    expect(target).toHaveAttribute('data-review-order-jump-target');
  });

  test('the hint goes away a moment after leaving the moved lines', async () => {
    await start();
    vi.useFakeTimers();
    hover(code(NEW, 'R', 40));
    expect(hint()).toHaveTextContent('Moved from src/old.ts lines 10–12');

    hover(document.body);
    expect(hint()).toBeDefined();
    vi.advanceTimersByTime(250);
    expect(hint()).toBeUndefined();
  });

  test('turns off while only some commits are shown, whose line numbers differ', async () => {
    await start();
    lines!.followUrl(`${WHOLE}/${'a'.repeat(40)}..${'b'.repeat(40)}`);

    expect(pageStyle()!.media).toBe('not all');
    hover(code(OLD, 'L', 11));
    expect(hint()).toBeUndefined();

    lines!.followUrl(WHOLE);
    expect(pageStyle()!.media).toBe('all');
  });

  test('finds the moves again with another minimum, without fetching the diff again', async () => {
    await start();
    const selector = `${anchors.get(OLD)}"] td[data-diff-side="left"][data-line-number="11"]`;

    // The fixture moves three lines
    lines!.setOptions({ minLines: 4 });
    await vi.waitFor(() => expect(pageStyle()).toBeUndefined());
    hover(code(OLD, 'L', 11));
    expect(hint()).toBeUndefined();

    lines!.setOptions({ minLines: 3 });
    await vi.waitFor(() => expect(pageStyle()?.textContent).toContain(selector));
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  test('starts with the minimum it was given', async () => {
    lines = createMovedLines(ctx, pr, WHOLE, { minLines: 4 });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve));

    expect(pageStyle()).toBeUndefined();
  });

  test('colours nothing when the diff could not be fetched', async () => {
    sendMessage.mockResolvedValue({ error: 'GitHub responded with 404' });
    lines = createMovedLines(ctx, pr, WHOLE);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve));

    expect(pageStyle()).toBeUndefined();
  });

  test('leaves the page as it was once stopped, even with the diff still on its way', async () => {
    let answer!: (response: unknown) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    lines = createMovedLines(ctx, pr, WHOLE);
    lines.stop();
    answer({ diff: DIFF });
    await new Promise((resolve) => setTimeout(resolve));

    expect(document.head.querySelectorAll('style')).toHaveLength(0);
    hover(code(OLD, 'L', 11));
    expect(hint()).toBeUndefined();
  });
});
