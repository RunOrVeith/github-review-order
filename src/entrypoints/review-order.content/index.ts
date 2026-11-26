import { mount, unmount } from 'svelte';
import {
  conversationProblems,
  EMPTY_SECTION,
  isDiagnoseMessage,
  PROBLEMS_MESSAGE,
  type ConversationState,
  type Diagnosis,
  type ProblemsMessage,
} from '@/utils/diagnosis';
import { RequestError, type PullPage, type PullRef } from '@/utils/github';
import { isShowPanelMessage } from '@/utils/messages';
import { goToAnchor } from '@/utils/navigation';
import type { CachedReview } from '@/utils/progress';
import { diagnose } from './diagnose';
import { createMovedLines, type MovedLines } from './moved-lines';
import Panel from './Panel.svelte';
import { PanelStatus } from './status.svelte';
import { createTreeMarkers, type TreeMarkers } from './tree-markers';
import { createViewedState, type ViewedState } from './viewed';

interface Review {
  pr: PullRef;
  fingerprint: string;
  /** The files' anchors on the changes page, in review order. */
  anchors: string[];
  /** Lists the PR's files the order leaves out, which are stepped through after it. */
  status: PanelStatus;
  markers: TreeMarkers;
  viewed: ViewedState;
}

// Coming back to the tab re-reads the PR at most this often; GitHub's Refresh button always does.
// The e2e build sets it to 0 so tests don't have to wait.
const RECHECK_INTERVAL = Number(import.meta.env.WXT_RECHECK_INTERVAL ?? 30_000);

/** What the mounted panel lets the content script do to it. */
interface PanelApp {
  expand(): void;
}

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script has to be on every page
  matches: ['https://github.com/*'],
  // Starts the description request as soon as the HTML is parsed instead of after the page loaded
  runAt: 'document_end',
  cssInjectionMode: 'ui',

  async main(ctx) {
    let ui: ShadowRootContentScriptUi<PanelApp> | undefined;
    let markers: TreeMarkers | undefined;
    // Lives as long as the changes tab is open, so toggles seen there outlast panel rebuilds
    let viewed: ViewedState | undefined;
    // Also there without a panel, since moves are worth seeing on any PR
    let moves: MovedLines | undefined;
    // The PR whose changes tab is open; hash-only URL changes from scrolling keep it unchanged
    let active: { key: string; pr: PullRef } | null = null;
    // What the panel currently shows, so re-checks only rebuild it when something changed
    let shownFingerprint: string | null = null;
    // What the current panel shows besides the steps
    let status: PanelStatus | undefined;
    // A re-read of the PR in progress, so another one isn't started on top of it
    let recheck: Promise<void> | null = null;
    let lastRead = 0;
    // How reading the active PR went, for the toolbar button's diagnosis; null off a changes tab
    let conversation: ConversationState | null = null;
    // Whether the user closed the panel on the active PR
    let closed = false;
    // Whether the shown panel is minimized to just its step and arrows
    let minimized = false;
    // The problem count the badge last showed; null so the first one is always sent
    let reportedProblems: number | null = null;

    /** Problems that keep the order from working only show on the toolbar button, never by opening the panel. */
    function setConversation(state: ConversationState | null) {
      conversation = state;
      const count = conversationProblems(state).length;
      if (count === reportedProblems) return;
      reportedProblems = count;
      const message: ProblemsMessage = { type: PROBLEMS_MESSAGE, count };
      // Throws or rejects once the extension was reloaded or updated, when there's no badge left to update
      try {
        browser.runtime.sendMessage(message).catch(() => {});
      } catch {}
    }

    function removePanel() {
      ui?.remove();
      ui = undefined;
      markers?.stop();
      markers = undefined;
      shownFingerprint = null;
      status = undefined;
    }

    function hide() {
      removePanel();
      // Without a panel the tree still shows which files are viewed
      if (viewed) markers = createTreeMarkers(ctx, null, { viewed });
    }

    async function update(url: string) {
      const pr = parsePullUrl(url);
      const key = pr?.isChangesTab ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
      if (key === (active?.key ?? null)) {
        // Picking some of the PR's commits stays on its changes tab
        moves?.followUrl(url);
        return;
      }

      active = pr && key ? { key, pr } : null;
      closed = false;
      setConversation(active ? { state: 'loading' } : null);
      viewed?.stop();
      viewed = active ? createViewedState(ctx) : undefined;
      moves?.stop();
      moves = active ? createMovedLines(ctx, active.pr, url) : undefined;
      hide();
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
        if (active?.key !== key) return;
        setConversation({ state: 'failed', reason: loadFailure(error) });
        // Whatever is shown stays; a failed request says nothing about the PR's review order
        if (status) status.reviewProblem = loadFailure(error);
        return;
      }
      const latest = latestReviewOrder(page.posts);
      const fingerprint = latest && (await reviewFingerprint(page.headSha, latest.items));
      // The user may have left the changes tab while this was loading
      if (active?.key !== key) return;
      setConversation({
        state: 'read',
        layout: page.layout,
        posts: page.posts.length,
        headSha: page.headSha,
        limitations: page.limitations,
        review: latest && { source: describePost(pr, latest.post).text, items: latest.items.length },
      });
      // A page no layout recognises hides the panel like one without an order; the diagnosis says why
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
      if (rechecking) {
        moves?.refresh();
        await viewed?.refresh(pr);
      }
      await mountPanel(pr, key, review);
    }

    async function mountPanel(pr: PullRef, key: string, review: CachedReview) {
      const { fingerprint, items } = review;
      const [initialIndex, initialPosition, initialSkipViewed, initialAutoAdvance, initialMinimized, anchors] =
        await Promise.all([
          loadProgress(pr, fingerprint),
          loadPanelPosition(),
          skipViewed.getValue(),
          autoAdvance.getValue(),
          panelMinimized.getValue(),
          Promise.all(items.map((item) => diffAnchorId(item.path))),
        ]);
      const viewedState = viewed;
      if (active?.key !== key || !viewedState) return;
      minimized = initialMinimized;

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
              initialAutoAdvance,
              initialMinimized,
              status: newStatus,
              isViewed: (index) => {
                const anchor = anchorAt(steps, index);
                return anchor !== undefined && viewedState.isViewed(anchor);
              },
              watchViewed: (onChange) => viewedState.watch(onChange),
              onNavigate: (index) => navigate(steps, index),
              onMove: (position) => void panelPosition.setValue(position),
              onSkipViewedChange: (skip) => void skipViewed.setValue(skip),
              onAutoAdvanceChange: (advance) => void autoAdvance.setValue(advance),
              onMinimizedChange: (value) => {
                minimized = value;
                void panelMinimized.setValue(value);
              },
              onClose: () => {
                closed = true;
                hide();
              },
            },
          }),
        onRemove: (app) => {
          if (app) void unmount(app);
        },
      });
      // Nothing is on the page until mount(), so a panel for a tab the user already left is just dropped
      if (active?.key !== key) return;

      removePanel();
      shownFingerprint = fingerprint;
      status = newStatus;
      // A section without files has no steps to navigate or mark, but the tree still shows which files are viewed
      if (items.length === 0) {
        markers = createTreeMarkers(ctx, null, { viewed: viewedState });
      } else {
        const files = items.map((item, index) => ({ path: item.path, anchor: anchors[index]! }));
        markers = createTreeMarkers(ctx, files, {
          viewed: viewedState,
          onProblem: (problem) => (newStatus.treeProblem = problem),
          onUnlisted: (unlisted) => (newStatus.unlisted = unlisted),
        });
        steps = { pr, fingerprint, anchors, status: newStatus, markers, viewed: viewedState };
      }
      ui = newUi;
      ui.mount();
    }

    /** Picks up new pushes and description edits while the changes tab stays open. */
    function recheckOpenPanel(always = false) {
      // A closed panel stays closed until the changes tab is opened again or the toolbar popup brings it back
      if (!active || !ui || recheck) return;
      // Each check downloads the whole conversation page, which is large on busy PRs
      if (!always && Date.now() - lastRead < RECHECK_INTERVAL) return;
      recheck = show(active.pr, active.key, true).finally(() => (recheck = null));
    }

    /** Brings back a closed or minimized panel when asked from the toolbar button's popup. */
    function showPanel() {
      // Off the changes tab there's no panel to show
      if (!active) return;
      closed = false;
      if (ui) return ui.mounted?.expand();
      // Re-reads the PR, since it may have changed while the panel was closed
      if (!recheck) recheck = show(active.pr, active.key).finally(() => (recheck = null));
    }

    // The toolbar button's popup asks what was found on this tab, and can bring back the panel
    const onMessage = (message: unknown, _sender: unknown, sendResponse: (diagnosis: Diagnosis) => void) => {
      if (isShowPanelMessage(message)) return void showPanel();
      if (!isDiagnoseMessage(message)) return;
      const panel = ui ? (minimized ? 'minimized' : 'shown') : closed ? 'closed' : 'hidden';
      sendResponse(diagnose({ url: location.href, pr: active?.key ?? null, conversation, panel }));
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

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

/** The step's file: one from the order, or after those one it leaves out. */
function anchorAt(review: Review | undefined, index: number): string | undefined {
  return review && (review.anchors[index] ?? review.status.unlisted[index - review.anchors.length]?.anchor);
}

async function navigate(review: Review, index: number) {
  const id = anchorAt(review, index);
  if (id === undefined) return false;
  goToAnchor(id);
  const inTree = review.markers.setCurrent(id);
  // Large PRs only render the files near the screen, so the page alone can't tell what's in the PR
  const found = review.viewed.isInPr(id) || inTree;

  // Files left out of the order aren't known until the tree is read again, so only steps in the order are kept
  if (index < review.anchors.length) await saveProgress(review.pr, review.fingerprint, index);
  return found;
}
