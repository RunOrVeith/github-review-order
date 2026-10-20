import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  changesViewedStates,
  describePost,
  diffAnchorId,
  fetchPullPage,
  fetchViewedSnapshot,
  isRefreshControl,
  parsePullUrl,
  parseViewedSnapshot,
  readRenderedViewToggles,
  readViewToggle,
  RequestError,
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

  // Shaped like the embedded data on GitHub's conversation page
  const embeddedData = (headSha: unknown, author = 'alice') =>
    `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        pullRequestsConversationsRoute: {},
        pullRequestsLayoutRoute: { pullRequest: { headSha, author: { login: author } } },
      },
    })}</script>`;

  test('reads the description and head commit from the conversation page', async () => {
    const sha = 'a'.repeat(40);
    const fetch = vi.fn(async () =>
      new Response(`
        <div class="comment-body markdown-body"><h2>Review order</h2></div>
        <div class="comment-body markdown-body"><p>"headSha":"${'b'.repeat(40)}"</p></div>
        ${embeddedData(sha)}
      `),
    );
    vi.stubGlobal('fetch', fetch);

    const page = await fetchPullPage(pr);

    expect(fetch).toHaveBeenCalledWith(new URL('/acme/repo/pull/12', location.origin), expect.anything());
    // Not taken from the comment that merely contains the same text
    expect(page.headSha).toBe(sha);
    expect(page.posts).toEqual([
      {
        kind: 'description',
        author: 'alice',
        anchor: null,
        body: expect.objectContaining({ textContent: 'Review order' }),
      },
    ]);
  });

  test('has no head commit when the embedded data lacks a valid one', async () => {
    const bodies = [
      embeddedData('not a sha'),
      embeddedData(undefined),
      '<script type="application/json" data-target="react-app.embeddedData">{</script>',
      '',
    ];
    for (const body of bodies) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
      expect((await fetchPullPage(pr)).headSha).toBeNull();
    }
  });

  describe('comments', () => {
    // Trimmed from GitHub's conversation page: the description, a comment and a review summary
    const header = (login: string, role: string) => `
      <div class="timeline-comment-header">
        <a class="author Link--primary text-bold" href="/${login}">${login}</a>
        ${role && `<span aria-label="This user has a role"><span class="Label ml-1">${role}</span></span>`}
      </div>`;
    const description = (text: string) => `
      <div class="TimelineItem js-comment-container">
        <div class="timeline-comment-group js-minimizable-comment-group" id="issue-1">
          <div id="pullrequest-1" class="timeline-comment-group timeline-comment unminimized-comment">
            ${header('alice', 'Contributor')}
            <div class="edit-comment-hide"><task-lists>
              <div class="comment-body markdown-body js-comment-body">${text}</div>
            </task-lists></div>
          </div>
        </div>
      </div>`;
    const comment = (id: number, login: string, role: string, text: string, classes = 'unminimized-comment') => `
      <div class="TimelineItem js-comment-container">
        <div class="timeline-comment-group js-minimizable-comment-group" id="issuecomment-${id}">
          <div class="timeline-comment ${classes}">
            ${header(login, role)}
            <div class="edit-comment-hide"><task-lists><table><tbody><tr>
              <td class="d-block comment-body markdown-body js-comment-body">${text}</td>
            </tr></tbody></table></task-lists></div>
          </div>
        </div>
      </div>`;
    const review = (id: number, login: string, role: string, text: string, inline = '') => `
      <div id="pullrequestreview-${id}" class="js-comment js-minimize-container">
        <div class="TimelineItem"><div class="TimelineItem-body">
          <div id="pullrequestreview-${id}" class="timeline-comment-group timeline-comment unminimized-comment">
            ${header(login, role)}
            <div class="edit-comment-hide"><div class="comment-body markdown-body js-comment-body">${text}</div></div>
          </div>
        </div></div>
        ${inline}
      </div>`;
    const inlineComment = (login: string, role: string, text: string) => `
      <div id="discussion_r9" class="review-comment">
        ${header(login, role)}
        <div class="comment-body markdown-body js-comment-body">${text}</div>
      </div>`;

    async function postsOf(html: string) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(html + embeddedData('a'.repeat(40)))));
      return (await fetchPullPage(pr)).posts;
    }

    async function bodiesOf(html: string) {
      return (await postsOf(html)).map((post) => post.body.textContent?.trim());
    }

    test("keeps those by the PR's author and its collaborators, oldest first", async () => {
      const bodies = await bodiesOf(`
        ${description('description')}
        ${comment(2, 'alice', '', 'by the author')}
        ${comment(3, 'bob', 'Contributor', 'by a contributor')}
        ${comment(4, 'carol', 'Collaborator', 'by a collaborator')}
        ${review(5, 'dave', 'Member', 'by a member', inlineComment('erin', 'Owner', 'on a line of code'))}
        ${comment(6, 'frank', 'Owner', 'by the owner')}
        ${comment(7, 'mallory', '', '<span class="Label">Owner</span> by someone else')}
      `);

      expect(bodies).toEqual(['description', 'by the author', 'by a collaborator', 'by a member', 'by the owner']);
    });

    test('says who wrote each and where to find it', async () => {
      const posts = await postsOf(`
        ${description('description')}
        ${comment(2, 'carol', 'Collaborator', 'a comment')}
        ${review(3, 'dave', 'Member', 'a review')}
      `);

      expect(posts.map(({ kind, author, anchor }) => ({ kind, author, anchor }))).toEqual([
        { kind: 'description', author: 'alice', anchor: null },
        { kind: 'comment', author: 'carol', anchor: 'issuecomment-2' },
        { kind: 'review', author: 'dave', anchor: 'pullrequestreview-3' },
      ]);
    });

    test('skips comments a collaborator hid', async () => {
      const bodies = await bodiesOf(`
        ${description('description')}
        ${comment(2, 'carol', 'Collaborator', 'hidden', 'minimized-comment')}
      `);

      expect(bodies).toEqual(['description']);
    });

    test("uses the first body as the description if GitHub's container for it changes", async () => {
      const bodies = await bodiesOf(`
        <div class="comment-body markdown-body">description</div>
        ${comment(2, 'carol', 'Collaborator', 'by a collaborator')}
      `);

      expect(bodies).toEqual(['description', 'by a collaborator']);
    });
  });

  test('rejects when the page fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));

    const error = await fetchPullPage(pr).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ status: 503, message: 'GitHub responded with 503' });
  });
});

describe('describePost', () => {
  const pr = { owner: 'acme', repo: 'repo', number: 12, isChangesTab: true };
  const conversation = new URL('/acme/repo/pull/12', location.origin).href;

  test('links the description to the conversation page', () => {
    expect(describePost(pr, { kind: 'description', author: 'alice', anchor: null })).toEqual({
      text: 'File order from the PR description',
      href: conversation,
    });
  });

  test('names who wrote a comment or review and links to it', () => {
    expect(describePost(pr, { kind: 'comment', author: 'carol', anchor: 'issuecomment-2' })).toEqual({
      text: "File order from @carol's comment",
      href: `${conversation}#issuecomment-2`,
    });
    expect(describePost(pr, { kind: 'review', author: null, anchor: 'pullrequestreview-3' }).text).toBe(
      'File order from a review',
    );
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

describe('changesViewedStates', () => {
  /** Whether the change to the page counts, as seen by an observer set up like the viewed state's. */
  function counts(change: () => void): boolean {
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
    change();
    const records = observer.takeRecords();
    observer.disconnect();
    return changesViewedStates(records);
  }

  const main = () => document.querySelector('main')!;

  beforeEach(() => {
    document.body.innerHTML = `
      <main>${fileContainer(VIEWED, viewToggle(true))}</main>
      <button aria-pressed="false">Bold</button>`;
  });

  test('sees toggles flipping and being rendered', () => {
    expect(counts(() => main().querySelector('button')!.setAttribute('aria-pressed', 'false'))).toBe(true);
    expect(counts(() => main().insertAdjacentHTML('beforeend', fileContainer(NOT_VIEWED, viewToggle(false))))).toBe(
      true,
    );
  });

  test('sees new embedded data', () => {
    const script = '<script type="application/json" data-target="react-app.embeddedData">{}</script>';
    expect(counts(() => document.body.insertAdjacentHTML('beforeend', script))).toBe(true);
  });

  test('skips everything else', () => {
    expect(counts(() => main().append(document.createElement('div')))).toBe(false);
    // Rendered toggles going away doesn't change anything, their states are remembered
    expect(counts(() => main().replaceChildren())).toBe(false);
    expect(counts(() => document.querySelector('body > button')!.setAttribute('aria-pressed', 'true'))).toBe(false);
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
