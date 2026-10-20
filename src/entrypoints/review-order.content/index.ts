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
    let activeKey: string | null = null;

    async function update(url: string) {
      const pr = parsePullUrl(url);
      const key = pr?.isChangesTab ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
      if (key === activeKey) return;

      activeKey = key;
      ui?.remove();
      ui = undefined;
      if (!pr || !key) return;

      const page = await fetchPullPage(pr);
      const items = page.description && parseReviewOrder(page.description);
      if (!items) return;

      const fingerprint = reviewFingerprint(page.headSha, items);
      const initialIndex = await loadProgress(pr, fingerprint);
      const initialPosition = await panelPosition.getValue();
      // The user may have left the changes tab while this was loading
      if (activeKey !== key) return;

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
              onClose: () => ui?.remove(),
            },
          }),
        onRemove: (app) => {
          if (app) void unmount(app);
        },
      });
      ui.mount();
    }

    // The event can fire before location.href is updated, so use the URL it carries
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => void update(newUrl.href));
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
