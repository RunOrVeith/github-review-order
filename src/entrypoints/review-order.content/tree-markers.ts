import type { ContentScriptContext } from '#imports';
import type { ReviewFile } from '@/utils/file-tree';
// ?inline crashes in WXT's content script build, and the CSS needs no processing anyway
import styles from './tree-markers.css?raw';

export interface TreeMarkers {
  /** Marks the step's file as current and returns whether the tree has it. */
  setCurrent(index: number): boolean;
  stop(): void;
}

export const NONE_IN_TREE = "None of the review order's files are in GitHub's file tree.";
export const UNREADABLE_TREE = "Couldn't read GitHub's file tree, so it doesn't show the review order.";

/**
 * Shows the review order in GitHub's file tree and keeps it there while GitHub
 * re-renders or lazy-loads the tree. Calls onProblem whenever the reason the
 * tree can't show it changes, with null once it can.
 */
export function createTreeMarkers(
  ctx: ContentScriptContext,
  files: ReviewFile[],
  onProblem: (problem: string | null) => void = () => {},
): TreeMarkers {
  const steps = reviewSteps(files);
  let current: ReviewFile | null = null;
  let tree: HTMLElement | null = null;
  let frame: number | null = null;
  // Whether the tree has marks on it, so they're removed once it can't be read anymore
  let marked = false;
  let problem: string | null = null;
  // A navigation still in flight when the panel closes must not mark the tree again
  let stopped = false;

  // The tree is part of GitHub's page, not the panel's shadow root, so this is page CSS
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);

  function apply(): Map<string, HTMLElement> {
    if (!tree?.isConnected) tree = findTree(document);
    const entries = tree ? findTreeEntries(tree) : new Map<string, HTMLElement>();

    // If none of the order's files are in the tree it was most likely misread, and every file would be flagged
    const matched = files.some((file) => treeEntryFor(entries, file) !== undefined);
    if (matched) markTreeEntries(entries, steps, current);
    else if (marked) clearTreeMarks(document);
    marked = matched;

    report(matched ? null : tree ? NONE_IN_TREE : hasUnreadableTree(document) ? UNREADABLE_TREE : null);
    return entries;
  }

  function report(next: string | null) {
    if (next === problem) return;
    problem = next;
    onProblem(problem);
  }

  // Only childList changes are observed, so the attributes set by apply() don't re-trigger it
  const observer = new MutationObserver((records) => {
    if (stopped || frame !== null) return;
    // Diffs and comments change all the time; only the tree appearing or changing matters
    const known = tree?.isConnected ? tree : null;
    if (known && !records.some((record) => known.contains(record.target))) return;

    frame = requestAnimationFrame(() => {
      frame = null;
      if (!stopped) apply();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  apply();

  const removeInvalidatedListener = ctx.onInvalidated(stop);

  function stop() {
    if (stopped) return;
    stopped = true;
    removeInvalidatedListener();
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    style.remove();
    clearTreeMarks(document);
  }

  return {
    setCurrent(index) {
      if (stopped) return false;
      current = files[index] ?? null;

      const entry = current ? treeEntryFor(apply(), current) : undefined;
      if (entry) scrollTreeTo(entry);
      return entry !== undefined;
    },
    stop,
  };
}
