import { afterEach, describe, expect, test, vi } from 'vitest';
import { diffAnchorId, fetchPullPage, isRefreshControl, parsePullUrl } from '@/utils/github';

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
