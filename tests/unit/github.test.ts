import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  diffAnchorId,
  fetchPullPage,
  fetchViewedSnapshot,
  isRefreshControl,
  parsePullUrl,
  parseViewedSnapshot,
  readRenderedViewToggles,
  readViewToggle,
} from '@/utils/github';

describe('parsePullUrl', () => {
  test.each([
    ['https://github.com/acme/repo/pull/12', false],
    ['https://github.com/acme/repo/pull/12/commits', false],
    ['https://github.com/acme/repo/pull/12/files', true],
    ['https://github.com/acme/repo/pull/12/files/abc..def', true],
    ['https://github.com/acme/repo/pull/12/changes#diff-123', true],
  ])('%s', (url, isChangesTab) => {
    expect(parsePullUrl(url)).toEqual({ owner: 'acme', repo: 'repo', number: 12, isChangesTab });
  });

  test('returns null outside pull requests', () => {
    expect(parsePullUrl('https://github.com/acme/repo/issues/12')).toBeNull();
    expect(parsePullUrl('https://github.com/acme/repo')).toBeNull();
  });
});

describe('diffAnchorId', () => {
  test("matches GitHub's file anchors", async () => {
    // Taken from https://github.com/wxt-dev/wxt/pull/1500/files
    expect(await diffAnchorId('packages/wxt/src/client/content-scripts/ui/index.ts')).toBe(
      'diff-19ae949e68eda07c97bac03553e4a1bf22f694717ec711b531e749e9f92a45da',
    );
  });
});

describe('fetchPullPage', () => {
  const pr = { owner: 'acme', repo: 'repo', number: 12, isChangesTab: true };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('reads the description and head commit from the conversation page', async () => {
    const sha = 'a'.repeat(40);
    const fetch = vi.fn(async () =>
      new Response(`
        <script type="application/json">{"headSha":"${sha}"}</script>
        <div class="comment-body markdown-body"><h2>Review order</h2></div>
        <div class="comment-body markdown-body"><p>A later comment</p></div>
      `),
    );
    vi.stubGlobal('fetch', fetch);

    const page = await fetchPullPage(pr);

    expect(fetch).toHaveBeenCalledWith(new URL('/acme/repo/pull/12', location.origin), expect.anything());
    expect(page.headSha).toBe(sha);
    expect(page.description?.textContent).toBe('Review order');
  });

  test('returns nothing when the page fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    expect(await fetchPullPage(pr)).toEqual({ description: null, headSha: null });
  });
});

describe('isRefreshControl', () => {
  function element(html: string): Element {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.querySelector('[data-target]') ?? container.firstElementChild!;
  }

  test.each([
    '<button>Refresh</button>',
    '<button><span data-target>Reload</span></button>',
    '<a href="#">Refresh page</a>',
    '<div role="button">refresh</div>',
    '<button aria-label="Refresh"><svg></svg></button>',
  ])('matches %s', (html) => {
    expect(isRefreshControl(element(html))).toBe(true);
  });

  test.each([
    '<button>Reset current</button>',
    '<button>Viewed</button>',
    '<span>Refresh</span>',
    '<p><button>Load diff</button> to refresh</p>',
  ])('ignores %s', (html) => {
    expect(isRefreshControl(element(html))).toBe(false);
  });

  test('ignores non-elements', () => {
    expect(isRefreshControl(null)).toBe(false);
    expect(isRefreshControl(window)).toBe(false);
  });
});

const VIEWED = `diff-${'1'.repeat(64)}`;
const NOT_VIEWED = `diff-${'2'.repeat(64)}`;

// Trimmed from GitHub's /changes view: the toggle sits a few levels inside the file's container
function viewToggle(viewed: boolean) {
  return `
    <button data-component="Button" type="button" aria-pressed="${viewed}"
        aria-label="${viewed ? 'Viewed' : 'Not Viewed'}" class="prc-Button-ButtonBase-9n-Xk">
      <span data-component="text"><span class="hide-on-mobile__6ak-TF">Viewed</span></span>
    </button>`;
}

function fileContainer(anchor: string, content: string) {
  return `<div id="${anchor}"><div><div><div><div>${content}</div></div></div></div></div>`;
}

describe('readViewToggle', () => {
  test("reads the toggle in the file's container", () => {
    document.body.innerHTML = `
      <div id="diff-comparison-viewer-container">
        ${fileContainer(VIEWED, viewToggle(true))}
        ${fileContainer(NOT_VIEWED, viewToggle(false))}
      </div>`;

    expect(readViewToggle(VIEWED)).toBe(true);
    expect(readViewToggle(NOT_VIEWED)).toBe(false);
  });

  test("returns null when the file isn't rendered or has no toggle", () => {
    document.body.innerHTML = fileContainer(NOT_VIEWED, '<button aria-pressed="true">Expand</button>');

    expect(readViewToggle(VIEWED)).toBeNull();
    expect(readViewToggle(NOT_VIEWED)).toBeNull();
  });
});

describe('readRenderedViewToggles', () => {
  test('maps each rendered toggle to its file, skipping wrapper ids', () => {
    document.body.innerHTML = `
      <div id="diff-comparison-viewer-container">
        ${fileContainer(VIEWED, viewToggle(true))}
        ${fileContainer(NOT_VIEWED, viewToggle(false))}
        <button aria-pressed="true" aria-label="Viewed">outside any file</button>
      </div>`;

    expect(readRenderedViewToggles()).toEqual(
      new Map([
        [VIEWED, true],
        [NOT_VIEWED, false],
      ]),
    );
  });
});

describe('parseViewedSnapshot', () => {
  // Shaped like the embedded data on a large PR's /changes page
  const data = (diffSummaries: unknown) =>
    JSON.stringify({ payload: { pullRequestsChangesRoute: { diffSummaries } } });

  test("maps every file's anchor to its viewed state", () => {
    const json = data([
      { changeType: 'ADDED', markedAsViewed: true, path: 'a.py', pathDigest: '1'.repeat(64) },
      { changeType: 'ADDED', markedAsViewed: false, path: 'b.py', pathDigest: '2'.repeat(64) },
    ]);

    expect(parseViewedSnapshot(json)).toEqual(
      new Map([
        [VIEWED, true],
        [NOT_VIEWED, false],
      ]),
    );
  });

  test('returns null without per-file summaries, as on small PRs', () => {
    expect(parseViewedSnapshot(JSON.stringify({ payload: {} }))).toBeNull();
    expect(parseViewedSnapshot(data([{ path: 'a.py' }]))).toBeNull();
    expect(parseViewedSnapshot('not json')).toBeNull();
  });
});

describe('fetchViewedSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads the states from a fresh copy of the changes page", async () => {
    const json = JSON.stringify({
      payload: { pullRequestsChangesRoute: { diffSummaries: [{ markedAsViewed: true, pathDigest: '1'.repeat(64) }] } },
    });
    const fetch = vi.fn(
      async () => new Response(`<script type="application/json" data-target="react-app.embeddedData">${json}</script>`),
    );
    vi.stubGlobal('fetch', fetch);

    const snapshot = await fetchViewedSnapshot({ owner: 'acme', repo: 'repo', number: 12, isChangesTab: true });

    expect(fetch).toHaveBeenCalledWith(new URL('/acme/repo/pull/12/changes', location.origin), expect.anything());
    expect(snapshot).toEqual(new Map([[VIEWED, true]]));
  });
});
