import { mount, unmount } from 'svelte';
import type { PullRef } from '@/utils/github';
import Panel from './Panel.svelte';
import { createTreeMarkers, type TreeMarkers } from './tree-markers';

interface Review {
  pr: PullRef;
  fingerprint: string;
  /** The files' anchors on the changes page, in review order. */
  anchors: string[];
  markers: TreeMarkers;
}

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script has to be on every page
  matches: ['https://github.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let ui: ShadowRootContentScriptUi<ReturnType<typeof mount>> | undefined;
    let markers: TreeMarkers | undefined;
    // The PR whose changes tab is open; hash-only URL changes from scrolling keep it unchanged
    let active: { key: string; pr: PullRef } | null = null;
    // What the panel currently shows, so re-checks only rebuild it when something changed
    let shownFingerprint: string | null = null;
    let recheck: Promise<void> | null = null;

    function hide() {
      ui?.remove();
      ui = undefined;
      markers?.stop();
      markers = undefined;
      shownFingerprint = null;
    }

    async function update(url: string) {
      const pr = parsePullUrl(url);
      const key = pr?.isChangesTab ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
      if (key === (active?.key ?? null)) return;

      active = pr && key ? { key, pr } : null;
      hide();
      if (pr && key) await show(pr, key);
    }

    /** Shows the panel for the PR's current review order, or rebuilds it if that changed. */
    async function show(pr: PullRef, key: string) {
      const page = await fetchPullPage(pr);
      const items = page.description && parseReviewOrder(page.description);
      // The user may have left the changes tab while this was loading
      if (active?.key !== key) return;
      if (!items) return hide();

      const fingerprint = reviewFingerprint(page.headSha, items);
      if (fingerprint === shownFingerprint) return;

      const [initialIndex, initialPosition, anchors] = await Promise.all([
        loadProgress(pr, fingerprint),
        panelPosition.getValue(),
        Promise.all(items.map((item) => diffAnchorId(item.path))),
      ]);
      if (active?.key !== key) return;

      hide();
      shownFingerprint = fingerprint;
      // Created before the panel, which navigates to its first step as soon as it mounts
      const review: Review = { pr, fingerprint, anchors, markers: createTreeMarkers(ctx, anchors) };
      markers = review.markers;
      ui = await createShadowRootUi(ctx, {
        name: 'review-order-panel',
        position: 'inline',
        anchor: 'body',
        append: 'last',
        onMount: (container) =>
          mount(Panel, {
            target: container,
            props: {
              items,
              initialIndex,
              initialPosition,
              onNavigate: (index) => navigate(review, index),
              onMove: (position) => void panelPosition.setValue(position),
              onClose: hide,
            },
          }),
        onRemove: (app) => {
          if (app) void unmount(app);
        },
      });
      ui.mount();
    }

    /** Picks up new pushes and description edits while the changes tab stays open. */
    function recheckOpenPanel() {
      // A closed panel stays closed until the changes tab is opened again
      if (!active || !ui || recheck) return;
      recheck = show(active.pr, active.key).finally(() => (recheck = null));
    }

    // The event can fire before location.href is updated, so use the URL it carries
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => void update(newUrl.href));
    // GitHub's Refresh button for new pushes reloads the diff in place, without a navigation.
    // Capturing sees the click before GitHub can remove the banner it's in.
    ctx.addEventListener(
      document,
      'click',
      (event) => {
        if (isRefreshControl(event.target)) recheckOpenPanel();
      },
      { capture: true },
    );
    // Coming back to the tab, e.g. after pushing from a terminal
    ctx.addEventListener(window, 'focus', recheckOpenPanel);
    ctx.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') recheckOpenPanel();
    });
    await update(location.href);
  },
});

async function navigate(review: Review, index: number) {
  await saveProgress(review.pr, review.fingerprint, index);

  const id = review.anchors[index]!;
  // Clear the hash first so jumping to the file that's already selected still scrolls
  if (location.hash === `#${id}`) history.replaceState(null, '', location.pathname + location.search);
  location.hash = id;
  review.markers.setCurrent(index);

  return document.getElementById(id) !== null;
}
