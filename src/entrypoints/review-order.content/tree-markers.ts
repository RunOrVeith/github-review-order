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
  let currentId: string | null = null;
  let frame: number | null = null;

  // The tree is part of GitHub's page, not the panel's shadow root, so this is page CSS
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);

  const apply = () => markTreeEntries(findTreeEntries(document), order, currentId);

  // Only childList changes are observed, so the attributes set by apply() don't re-trigger it
  const observer = new MutationObserver(() => {
    frame ??= requestAnimationFrame(() => {
      frame = null;
      apply();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  apply();

  const removeInvalidatedListener = ctx.onInvalidated(stop);

  function stop() {
    removeInvalidatedListener();
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    style.remove();
    clearTreeMarks(document);
  }

  return {
    setCurrent(index) {
      currentId = order[index] ?? null;
      apply();

      const entry = currentId ? findTreeEntries(document).get(currentId) : undefined;
      if (entry) scrollTreeTo(entry);
    },
    stop,
  };
}
