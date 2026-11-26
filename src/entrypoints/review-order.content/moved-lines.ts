import type { ContentScriptContext } from '#imports';
import {
  diffAnchorId,
  diffCodeSelector,
  diffLineAnchor,
  diffLineAt,
  viewsWholePull,
  type DiffLine,
  type DiffSide,
  type PullRef,
} from '@/utils/github';
import { FETCH_DIFF, type FetchDiffMessage, type FetchDiffResponse } from '@/utils/messages';
import { findMovedBlocks, type LineRange, type MovedBlock, type MoveOptions } from '@/utils/moves';
import { goToAnchor } from '@/utils/navigation';
import { parseUnifiedDiff, type ChangedLines } from '@/utils/unified-diff';
// ?inline crashes in WXT's content script build, and the CSS needs no processing anyway
import hintStyles from './moved-lines.css?raw';

export interface MovedLines {
  /** Turns the colours off while the page shows only some of the commits, whose line numbers differ. */
  followUrl(url: string): void;
  /** Reads the PR's diff again, e.g. after new commits were pushed. */
  refresh(): void;
  /** Finds the moves again with other thresholds, from the diff already read. */
  setOptions(options: MoveOptions): void;
  stop(): void;
}

/** What hovering a moved line says, and links to its other end. */
export interface MoveHint {
  text: string;
  /** Null when the other end is right next to it. */
  link: { label: string; line: DiffLine } | null;
}

/** Maps each file's path to its anchor on the changes tab. */
export type FileAnchors = Map<string, string>;

// Stripes over GitHub's own red and green, in the page's background colour so they suit light and dark themes
const MOVED = `
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0 6px,
    color-mix(in srgb, var(--bgColor-default, #ffffff) 55%, transparent) 6px 10px
  );
`;
// Marks the line a hint's link jumped to for a moment, so it's easy to spot
const JUMP_TARGET_ATTRIBUTE = 'data-review-order-jump-target';
const JUMP_TARGET = `[${JUMP_TARGET_ATTRIBUTE}] { box-shadow: inset 0 0 0 2px var(--borderColor-accent-emphasis, #0969da); }\n`;
const JUMP_HIGHLIGHT = 2000;
// GitHub renders a file it's sent to within a moment; after this the line is given up on
const JUMP_TIMEOUT = 5000;
const IN_PLACE = 'Only the indentation changed';
// Long enough to move the pointer from a line onto the hint without it disappearing
const HIDE_DELAY = 200;

/**
 * Stripes the lines a PR moves, apart from whitespace, over GitHub's red where
 * they were removed and its green where they were added. Hovering one says where its
 * other end is. GitHub only renders the files near the screen and re-renders
 * rows all the time, so this is a stylesheet keyed on GitHub's own attributes
 * rather than marks on the rows.
 */
export function createMovedLines(
  ctx: ContentScriptContext,
  pr: PullRef,
  url: string,
  initialOptions: MoveOptions = {},
): MovedLines {
  let options = initialOptions;
  // The diff as last read, so other thresholds don't need it fetched again
  let changed: ChangedLines | null = null;
  let hints = new Map<string, MoveHint>();
  let enabled = viewsWholePull(url);
  let stopped = false;
  // Only the latest read of the diff is applied, and only the latest stripes worked out from it
  let loads = 0;
  let applies = 0;

  // The diff is part of GitHub's page, not a shadow root, so this is page CSS
  const style = document.createElement('style');
  style.textContent = JUMP_TARGET;
  document.head.append(style);
  const hint = createHintPopover();

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleHide() {
    hideTimer ??= setTimeout(() => {
      hideTimer = undefined;
      hint.hide();
    }, HIDE_DELAY);
  }
  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  function onMouseOver(event: Event) {
    if (!enabled || !(event.target instanceof Element)) return;
    // Events from inside the hint's shadow root come from its host
    if (event.target === hint.host) return cancelHide();
    const line = diffLineAt(event.target);
    const found = line && hints.get(diffLineAnchor(line));
    if (!found) return scheduleHide();
    cancelHide();
    hint.show(found, line.cell);
  }

  function onScroll() {
    cancelHide();
    hint.hide();
  }

  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const removeInvalidatedListener = ctx.onInvalidated(stop);

  async function load() {
    const load = ++loads;
    const message: FetchDiffMessage = { type: FETCH_DIFF, pr: { owner: pr.owner, repo: pr.repo, number: pr.number } };
    const response: FetchDiffResponse | null = await browser.runtime.sendMessage(message).catch(() => null);
    // Without the diff there's nothing to colour, and what's shown may still be right
    if (stopped || load !== loads || !response || !('diff' in response)) return;

    changed = parseUnifiedDiff(response.diff);
    await apply();
  }

  /** Stripes the moves in the diff as last read; only the latest diff and options are applied. */
  async function apply() {
    if (!changed) return;
    const applied = ++applies;
    const blocks = findMovedBlocks(changed, options);
    const paths = new Set(blocks.flatMap((block) => [block.from.path, block.to.path]));
    const anchors = new Map(await Promise.all(Array.from(paths, async (path) => [path, await diffAnchorId(path)] as const)));
    if (stopped || applied !== applies) return;

    style.textContent = JUMP_TARGET + movedLinesCss(blocks, anchors);
    hints = moveHints(blocks, anchors);
  }

  function setEnabled(value: boolean) {
    enabled = value;
    style.media = enabled ? 'all' : 'not all';
    if (!enabled) onScroll();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    removeInvalidatedListener();
    document.removeEventListener('mouseover', onMouseOver);
    document.removeEventListener('scroll', onScroll, { capture: true });
    cancelHide();
    style.remove();
    hint.host.remove();
  }

  setEnabled(enabled);
  void load();

  return {
    followUrl: (next) => setEnabled(viewsWholePull(next)),
    refresh: () => void load(),
    setOptions(next) {
      options = next;
      // A load still under way uses the new options once it's done
      void apply();
    },
    stop,
  };
}

function linesOf(range: LineRange, side: DiffSide, anchors: FileAnchors): DiffLine[] {
  const fileAnchor = anchors.get(range.path);
  if (!fileAnchor) return [];
  return Array.from({ length: range.end - range.start + 1 }, (_, i) => ({ fileAnchor, side, line: range.start + i }));
}

/** Page CSS that stripes the blocks' lines wherever GitHub renders them. */
export function movedLinesCss(blocks: MovedBlock[], anchors: FileAnchors): string {
  // Only the code is striped; the line numbers keep GitHub's plain colours so they stay readable
  const selectors = blocks
    .flatMap((block) => [...linesOf(block.from, 'left', anchors), ...linesOf(block.to, 'right', anchors)])
    .map(diffCodeSelector);
  return selectors.length > 0 ? `${selectors.join(',\n')} {${MOVED}}\n` : '';
}

/** What hovering each moved line says, keyed by the line's anchor. Lines of one block share their hint. */
export function moveHints(blocks: MovedBlock[], anchors: FileAnchors): Map<string, MoveHint> {
  const hints = new Map<string, MoveHint>();
  const add = (lines: DiffLine[], hint: MoveHint) => {
    for (const line of lines) hints.set(diffLineAnchor(line), hint);
  };

  for (const block of blocks) {
    const removed = linesOf(block.from, 'left', anchors);
    const added = linesOf(block.to, 'right', anchors);
    if (block.inPlace) {
      const hint = { text: IN_PLACE, link: null };
      add(removed, hint);
      add(added, hint);
      continue;
    }
    if (added[0]) add(removed, { text: 'Moved to', link: { label: describe(block.to, block.from.path), line: added[0] } });
    if (removed[0]) add(added, { text: 'Moved from', link: { label: describe(block.from, block.to.path), line: removed[0] } });
  }
  return hints;
}

/** E.g. "src/a.ts lines 3–7", or "line 3 in this file" when it's the file the hint is shown in. */
function describe(range: LineRange, herePath: string): string {
  const lines = range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
  return range.path === herePath ? `${lines} in this file` : `${range.path} ${lines}`;
}

/** A small card next to a hovered line, in a shadow root of its own so GitHub's styles leave it alone. */
function createHintPopover() {
  const host = document.createElement('div');
  host.setAttribute('data-review-order-move-hint', '');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${hintStyles}</style><div class="hint" role="tooltip"><span></span> <a></a></div>`;
  const card = shadow.querySelector<HTMLElement>('.hint')!;
  const text = shadow.querySelector('span')!;
  const link = shadow.querySelector('a')!;
  let shown: MoveHint | null = null;

  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (!shown?.link) return;
    void jumpTo(shown.link.line);
    hide();
  });

  function hide() {
    shown = null;
    host.remove();
  }

  return {
    host,
    /** Shows the hint by the hovered cell's row; it stays put while the pointer moves within the same block. */
    show(hint: MoveHint, cell: Element) {
      if (hint === shown && host.isConnected) return;
      shown = hint;
      text.textContent = hint.text;
      link.hidden = hint.link === null;
      link.textContent = hint.link?.label ?? '';
      link.href = hint.link ? `#${diffLineAnchor(hint.link.line)}` : '';
      if (!host.isConnected) document.body.append(host);

      // Below the row, or above it when there's no room left below
      const row = (cell.closest('tr') ?? cell).getBoundingClientRect();
      const height = card.offsetHeight;
      const below = row.bottom + height + 8 <= document.documentElement.clientHeight;
      card.style.top = `${below ? row.bottom + 4 : Math.max(4, row.top - height - 4)}px`;
      card.style.left = `${Math.max(4, cell.getBoundingClientRect().left)}px`;
    },
    hide,
  };
}

/**
 * Scrolls to a line in another part of the diff. GitHub only follows file
 * anchors in the URL, rendering the file if it wasn't, so this goes to the
 * file and then finds the line in it.
 */
async function jumpTo(line: DiffLine) {
  goToAnchor(line.fileAnchor);
  const selector = diffCodeSelector(line);
  const deadline = Date.now() + JUMP_TIMEOUT;
  let cell = document.querySelector(selector);
  while (!cell && Date.now() < deadline) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    cell = document.querySelector(selector);
  }
  if (!cell) return;

  cell.scrollIntoView({ block: 'center' });
  cell.setAttribute(JUMP_TARGET_ATTRIBUTE, '');
  setTimeout(() => cell.removeAttribute(JUMP_TARGET_ATTRIBUTE), JUMP_HIGHLIGHT);
}
