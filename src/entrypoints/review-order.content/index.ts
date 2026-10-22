import { mount, unmount } from 'svelte';
import { RequestError, type PullPage, type PullRef } from '@/utils/github';
import type { CachedReview } from '@/utils/progress';
import Panel from './Panel.svelte';
import { PanelStatus } from './status.svelte';
import { createTreeMarkers, type TreeMarkers } from './tree-markers';
import { createViewedState, type ViewedState } from './viewed';

interface Review {
  pr: PullRef;
  fingerprint: string;
  /** The files' anchors on the changes page, in review order. */
  anchors: string[];
  markers: TreeMarkers;
  viewed: ViewedState;
}

// Coming back to the tab re-reads the PR at most this often; GitHub's Refresh button always does.
// The e2e build sets it to 0 so tests don't have to wait.
const RECHECK_INTERVAL = Number(import.meta.env.WXT_RECHECK_INTERVAL ?? 30_000);

const EMPTY_SECTION = 'The "Review order" section has no numbered list of files.';

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script has to be on every page
  matches: ['https://github.com/*'],
  // Starts the description request as soon as the HTML is parsed instead of after the page loaded
  runAt: 'document_end',
  cssInjectionMode: 'ui',

  async main(ctx) {
    let ui: ShadowRootContentScriptUi<ReturnType<typeof mount>> | undefined;
    let markers: TreeMarkers | undefined;
    // Lives as long as the changes tab is open, so toggles seen there outlast panel rebuilds
    let viewed: ViewedState | undefined;
    // The PR whose changes tab is open; hash-only URL changes from scrolling keep it unchanged
    let active: { key: string; pr: PullRef } | null = null;
    // What the panel currently shows, so re-checks only rebuild it when something changed
    let shownFingerprint: string | null = null;
    // What the current panel shows besides the steps
    let status: PanelStatus | undefined;
    let recheck: Promise<void> | null = null;
    let lastRead = 0;

    function hide() {
      ui?.remove();
      ui = undefined;
      markers?.stop();
      markers = undefined;
      shownFingerprint = null;
      status = undefined;
    }

    async function update(url: string) {
      const pr = parsePullUrl(url);
      const key = pr?.isChangesTab ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
      if (key === (active?.key ?? null)) return;

      active = pr && key ? { key, pr } : null;
      hide();
      viewed?.stop();
      viewed = active ? createViewedState(ctx) : undefined;
      if (pr && key) await show(pr, key);
    }

    /** Shows the panel for the PR's current review order, or rebuilds it if that changed. */
    async function show(pr: PullRef, key: string, rechecking = false) {
      // Reading the description takes a full page request, so show the last known order meanwhile
      if (!ui) {
        const cached = await loadCachedReview(pr);
        if (cached && active?.key === key) await mountPanel(pr, key, cached);
      }

      lastRead = Date.now();
      let page: PullPage;
      try {
        page = await fetchPullPage(pr);
      } catch (error) {
        // Whatever is shown stays; a failed request says nothing about the PR's review order
        if (active?.key === key && status) status.reviewProblem = loadFailure(error);
        return;
      }
      const latest = latestReviewOrder(page.posts);
      const fingerprint = latest && (await reviewFingerprint(page.headSha, latest.items));
      // The user may have left the changes tab while this was loading
      if (active?.key !== key) return;
      if (!latest || !fingerprint) {
        void forgetReview(pr);
        return hide();
      }

      const { kind, author, anchor } = latest.post;
      const review = { fingerprint, items: latest.items, source: { kind, author, anchor } };
      if (review.items.length > 0) void saveCachedReview(pr, review);
      else void forgetReview(pr);
      // Someone may have posted the same order again, which keeps the step but not where it's from
      if (fingerprint === shownFingerprint) {
        if (status) showStatus(status, pr, review);
        return;
      }

      // GitHub unticks files changed by new commits, but the page's embedded states don't update
      if (rechecking) await viewed?.refresh(pr);
      await mountPanel(pr, key, review);
    }

    async function mountPanel(pr: PullRef, key: string, review: CachedReview) {
      const { fingerprint, items } = review;
      const [initialIndex, initialPosition, initialSkipViewed, initialMinimized, anchors] = await Promise.all([
        loadProgress(pr, fingerprint),
        loadPanelPosition(),
        skipViewed.getValue(),
        panelMinimized.getValue(),
        Promise.all(items.map((item) => diffAnchorId(item.path))),
      ]);
      const viewedState = viewed;
      if (active?.key !== key || !viewedState) return;

      const newStatus = new PanelStatus();
      showStatus(newStatus, pr, review);
      // Assigned right before mounting; the panel navigates to its first step as soon as it mounts
      let steps: Review;
      const newUi = await createShadowRootUi(ctx, {
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
              initialSkipViewed,
              initialMinimized,
              status: newStatus,
              isViewed: (index) => viewedState.isViewed(anchors[index]!),
              watchViewed: (onChange) => viewedState.watch(onChange),
              onNavigate: (index) => navigate(steps, index),
              onMove: (position) => void panelPosition.setValue(position),
              onSkipViewedChange: (skip) => void skipViewed.setValue(skip),
              onMinimizedChange: (minimized) => void panelMinimized.setValue(minimized),
              onClose: hide,
            },
          }),
        onRemove: (app) => {
          if (app) void unmount(app);
        },
      });
      // Nothing is on the page until mount(), so a panel for a tab the user already left is just dropped
      if (active?.key !== key) return;

      hide();
      shownFingerprint = fingerprint;
      status = newStatus;
      // A section without files has no steps to navigate or mark
      if (items.length > 0) {
        const files = items.map((item, index) => ({ path: item.path, anchor: anchors[index]! }));
        markers = createTreeMarkers(ctx, files, {
          viewed: viewedState,
          onProblem: (problem) => (newStatus.treeProblem = problem),
        });
        steps = { pr, fingerprint, anchors, markers, viewed: viewedState };
      }
      ui = newUi;
      ui.mount();
    }

    /** Picks up new pushes and description edits while the changes tab stays open. */
    function recheckOpenPanel(always = false) {
      // A closed panel stays closed until the changes tab is opened again
      if (!active || !ui || recheck) return;
      // Each check downloads the whole conversation page, which is large on busy PRs
      if (!always && Date.now() - lastRead < RECHECK_INTERVAL) return;
      recheck = show(active.pr, active.key, true).finally(() => (recheck = null));
    }

    // The event can fire before location.href is updated, so use the URL it carries
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => void update(newUrl.href));
    // GitHub's Refresh button for new pushes reloads the diff in place, without a navigation.
    // Capturing sees the click before GitHub can remove the banner it's in.
    ctx.addEventListener(
      document,
      'click',
      (event) => {
        if (isRefreshControl(event.target)) recheckOpenPanel(true);
      },
      { capture: true },
    );
    // Coming back to the tab, e.g. after pushing from a terminal
    ctx.addEventListener(window, 'focus', () => recheckOpenPanel());
    ctx.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') recheckOpenPanel();
    });
    await update(location.href);
  },
});

/** Shows where the order is from, and clears a failed request's problem now that it loaded. */
function showStatus(status: PanelStatus, pr: PullRef, review: CachedReview) {
  status.source = describePost(pr, review.source);
  status.reviewProblem = review.items.length > 0 ? null : EMPTY_SECTION;
}

function loadFailure(error: unknown): string {
  const reason = error instanceof RequestError ? error.message : "GitHub couldn't be reached";
  return `Couldn't load the latest review order (${reason}), so this may be out of date.`;
}

async function navigate(review: Review, index: number) {
  const id = review.anchors[index]!;
  // Clear the hash first so jumping to the file that's already selected still scrolls
  if (location.hash === `#${id}`) history.replaceState(null, '', location.pathname + location.search);
  location.hash = id;
  const inTree = review.markers.setCurrent(index);
  // Large PRs only render the files near the screen, so the page alone can't tell what's in the PR
  const found = review.viewed.isInPr(id) || inTree;

  await saveProgress(review.pr, review.fingerprint, index);
  return found;
}
