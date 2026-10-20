import type { ContentScriptContext } from '#imports';
// ?inline crashes in WXT's content script build, and the CSS needs no processing anyway
import styles from './tree-markers.css?raw';

export interface TreeMarkers {
  setCurrent(index: number): void;
  stop(): void;
}

/**
 * Shows the review order in GitHub's file tree and keeps it there while GitHub
 * re-renders or lazy-loads the tree.
 */
export function createTreeMarkers(ctx: ContentScriptContext, order: string[]): TreeMarkers {
  const steps = reviewSteps(order);
  let currentId: string | null = null;
  let tree: HTMLElement | null = null;
  let frame: number | null = null;
  // A navigation still in flight when the panel closes must not mark the tree again
  let stopped = false;

  // The tree is part of GitHub's page, not the panel's shadow root, so this is page CSS
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);

  function apply(): Map<string, HTMLElement> {
    if (!tree?.isConnected) tree = findTree(document);
    const entries = tree ? findTreeEntries(tree) : new Map<string, HTMLElement>();
    markTreeEntries(entries, steps, currentId);
    return entries;
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
      if (stopped) return;
      currentId = order[index] ?? null;

      const entry = currentId ? apply().get(currentId) : undefined;
      if (entry) scrollTreeTo(entry);
    },
    stop,
  };
}
