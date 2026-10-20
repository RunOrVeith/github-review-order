import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentScriptContext } from '#imports';
import { createViewedState, type ViewedState } from '@/entrypoints/review-order.content/viewed';

const RENDERED = `diff-${'1'.repeat(64)}`;
const OFFSCREEN = `diff-${'2'.repeat(64)}`;
const UNKNOWN = `diff-${'3'.repeat(64)}`;

const ctx = { onInvalidated: () => () => {} } as unknown as ContentScriptContext;
const pr = { owner: 'acme', repo: 'repo', number: 1, isChangesTab: true };
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function embeddedData(states: Record<string, boolean>) {
  const diffSummaries = Object.entries(states).map(([anchor, markedAsViewed]) => ({
    pathDigest: anchor.replace('diff-', ''),
    markedAsViewed,
  }));
  return JSON.stringify({ payload: { pullRequestsChangesRoute: { diffSummaries } } });
}

function render(viewed: boolean) {
  return `
    <div id="${RENDERED}"><div>
      <button aria-pressed="${viewed}" aria-label="${viewed ? 'Viewed' : 'Not Viewed'}">Viewed</button>
    </div></div>`;
}

let state: ViewedState;

beforeEach(async () => {
  // Like a large PR: only one file is rendered, the page embeds the others' states
  document.body.innerHTML = `
    <script type="application/json" data-target="react-app.embeddedData">${embeddedData({
      [RENDERED]: false,
      [OFFSCREEN]: true,
    })}</script>
    <main>${render(true)}</main>`;
  state = createViewedState(ctx);
  await nextFrame();
});

afterEach(() => {
  state.stop();
  vi.unstubAllGlobals();
});

test('a rendered toggle wins over the embedded state', () => {
  expect(state.isViewed(RENDERED)).toBe(true);
});

test('files that are not rendered use the embedded state', () => {
  expect(state.isViewed(OFFSCREEN)).toBe(true);
  expect(state.isViewed(UNKNOWN)).toBe(false);
});

test('remembers a toggle after GitHub stops rendering the file', async () => {
  document.querySelector('main')!.innerHTML = '';
  await nextFrame();

  expect(state.isViewed(RENDERED)).toBe(true);
});

describe('isInPr', () => {
  test('knows files that are rendered, seen or embedded', () => {
    expect(state.isInPr(RENDERED)).toBe(true);
    expect(state.isInPr(OFFSCREEN)).toBe(true);
    expect(state.isInPr(UNKNOWN)).toBe(false);
  });
});

test('tells listeners when a file gets ticked or unticked', async () => {
  const onChange = vi.fn();
  state.watch(onChange);

  document.querySelector('button')!.setAttribute('aria-pressed', 'false');
  await nextFrame();

  expect(onChange).toHaveBeenCalled();
  expect(state.isViewed(RENDERED)).toBe(false);
});

test('refresh replaces the embedded states and forgets toggles seen before the push', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          `<script type="application/json" data-target="react-app.embeddedData">${embeddedData({
            [RENDERED]: false,
            [OFFSCREEN]: false,
          })}</script>`,
        ),
    ),
  );
  document.querySelector('main')!.innerHTML = '';
  await nextFrame();

  await state.refresh(pr);

  expect(state.isViewed(OFFSCREEN)).toBe(false);
  expect(state.isViewed(RENDERED)).toBe(false);
});
