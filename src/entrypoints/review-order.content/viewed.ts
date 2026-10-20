import type { ContentScriptContext } from '#imports';
import type { PullRef } from '@/utils/github';

export interface ViewedState {
  isViewed(anchor: string): boolean;
  /** Whether the file is part of the PR, even if GitHub hasn't rendered it. */
  isInPr(anchor: string): boolean;
  /** Re-reads every file's state after new commits, which GitHub may have unticked. */
  refresh(pr: PullRef): Promise<void>;
  watch(onChange: () => void): () => void;
  stop(): void;
}

/**
 * Tracks which files are ticked as viewed on the changes page. GitHub only
 * renders the files near the screen on large PRs, so this combines the toggles
 * on the page with the per-file states GitHub embeds in it.
 */
export function createViewedState(ctx: ContentScriptContext): ViewedState {
  // Last toggle state seen for each file during this visit, kept after GitHub un-renders the file
  const seen = new Map<string, boolean>();
  // Snapshots are tied to the embedded data they were taken for; a replaced script means newer data
  let embedded: { script: Element; snapshot: Map<string, boolean> | null } | null = null;
  let fetched: { script: Element | null; snapshot: Map<string, boolean> } | null = null;
  const listeners = new Set<() => void>();
  let frame: number | null = null;

  function snapshot(): Map<string, boolean> | null {
    const script = document.querySelector(EMBEDDED_DATA_SELECTOR);
    if (fetched && fetched.script === script) return fetched.snapshot;
    if (!script) return null;

    if (embedded?.script !== script) {
      embedded = { script, snapshot: parseViewedSnapshot(script.textContent ?? '') };
    }
    return embedded.snapshot;
  }

  function notify() {
    frame ??= requestAnimationFrame(() => {
      frame = null;
      for (const [anchor, viewed] of readRenderedViewToggles()) seen.set(anchor, viewed);
      for (const listener of listeners) listener();
    });
  }

  // GitHub may flip aria-pressed or re-render the toggle, and renders files as they scroll into view.
  // Everything else on the page, like diffs and comments, changes all the time and is skipped.
  const observer = new MutationObserver((records) => {
    if (changesViewedStates(records)) notify();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-pressed'],
  });
  notify();

  const removeInvalidatedListener = ctx.onInvalidated(stop);

  function stop() {
    removeInvalidatedListener();
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    listeners.clear();
  }

  return {
    isViewed(anchor) {
      return readViewToggle(anchor) ?? seen.get(anchor) ?? snapshot()?.get(anchor) ?? false;
    },
    isInPr(anchor) {
      return document.getElementById(anchor) !== null || seen.has(anchor) || (snapshot()?.has(anchor) ?? false);
    },
    async refresh(pr) {
      const script = document.querySelector(EMBEDDED_DATA_SELECTOR);
      const fresh = await fetchViewedSnapshot(pr).catch(() => null);
      // States seen before the push may be outdated now; toggles still rendered are read live anyway
      seen.clear();
      if (fresh) fetched = { script, snapshot: fresh };
      notify();
    },
    watch(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    stop,
  };
}
