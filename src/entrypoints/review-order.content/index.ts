import { mount, unmount } from 'svelte';
import type { PullRef } from '@/utils/github';
import type { ReviewItem } from '@/utils/review-order';
import Panel from './Panel.svelte';

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script has to be on every page
  matches: ['https://github.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let ui: ShadowRootContentScriptUi<ReturnType<typeof mount>> | undefined;
    // The PR whose changes tab is open; hash-only URL changes from scrolling keep it unchanged
    let active: { key: string; pr: PullRef } | null = null;
    // What the panel currently shows, so re-checks only rebuild it when something changed
    let shownFingerprint: string | null = null;
    let recheck: Promise<void> | null = null;

    function hide() {
      ui?.remove();
      ui = undefined;
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

      const [initialIndex, initialPosition] = await Promise.all([
        loadProgress(pr, fingerprint),
        panelPosition.getValue(),
      ]);
      if (active?.key !== key) return;

      hide();
      shownFingerprint = fingerprint;
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
              onNavigate: (index) => navigate(pr, fingerprint, items, index),
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

async function navigate(pr: PullRef, fingerprint: string, items: ReviewItem[], index: number) {
  await saveProgress(pr, fingerprint, index);

  const id = await diffAnchorId(items[index]!.path);
  // Clear the hash first so jumping to the file that's already selected still scrolls
  if (location.hash === `#${id}`) history.replaceState(null, '', location.pathname + location.search);
  location.hash = id;

  return document.getElementById(id) !== null;
}
