import type { BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';

export const CONVERSATION_URL = 'https://github.com/acme/repo/pull/1';
export const FILES_URL = `${CONVERSATION_URL}/files`;
/** GitHub's newer changes view, which only renders the files near the screen. */
export const CHANGES_URL = `${CONVERSATION_URL}/changes`;

export const reviewOrder = [
  { path: 'src/core.ts', description: 'start with the core change' },
  {
    path: 'src/ui.ts',
    // Long enough to wrap, so stepping to it makes the panel taller
    description:
      'then the UI using it, which wires the new core change into every screen that shows ' +
      'review state and needs a careful look at how loading and error states are handled',
  },
  { path: 'README.md', description: 'docs last' },
];

export function anchorId(path: string): string {
  return `diff-${createHash('sha256').update(path).digest('hex')}`;
}

type ReviewOrder = typeof reviewOrder;

/** A comment on the conversation page, by someone with the given role in the repo. */
export interface PullComment {
  login: string;
  role: 'Collaborator' | 'Contributor' | '';
  items: ReviewOrder;
}

/**
 * Serves a minimal stand-in for a GitHub PR. Assign `headSha` on the returned
 * object to simulate a new push, `viewed` to change which files GitHub
 * reports as viewed, `items` to edit the description's review order (null
 * leaves the section out), and `comments` to add comments.
 */
export async function servePullRequest(context: BrowserContext, headSha = 'a'.repeat(40)) {
  const pr = {
    headSha,
    items: reviewOrder as ReviewOrder | null,
    comments: [] as PullComment[],
    // Set conversationDelay to make reading the description slow, like a cold GitHub request
    conversationDelay: 0,
    // Set to an error status to make GitHub fail to serve the description
    conversationStatus: 200,
    viewed: new Set([reviewOrder[1]!.path]),
  };

  await context.route('https://github.com/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/acme/repo/pull/1') {
      await new Promise((resolve) => setTimeout(resolve, pr.conversationDelay));
      if (pr.conversationStatus !== 200) return route.fulfill({ status: pr.conversationStatus });
      return route.fulfill({ contentType: 'text/html', body: conversationPage(pr) });
    }
    if (pathname === '/acme/repo/pull/1/files') {
      return route.fulfill({ contentType: 'text/html', body: filesPage() });
    }
    if (pathname === '/acme/repo/pull/1/changes' || pathname.startsWith('/acme/repo/pull/1/changes/')) {
      return route.fulfill({ contentType: 'text/html', body: changesPage(pr.viewed) });
    }
    if (pathname === '/acme/repo/pull/1.diff') {
      return route.fulfill({ contentType: 'text/plain', body: PULL_DIFF });
    }
    return route.fulfill({ status: 404 });
  });

  return pr;
}

function conversationPage(pr: { headSha: string; items: ReviewOrder | null; comments: PullComment[] }): string {
  const section = (items: ReviewOrder) => `
    <div class="markdown-heading"><h2 class="heading-element">Review order</h2><a class="anchor"></a></div>
    <ol>${items.map((item) => `<li><code>${item.path}</code>: ${item.description}</li>`).join('')}</ol>`;
  const header = (login: string, role: string) => `
    <div class="timeline-comment-header">
      <a class="author" href="/${login}">${login}</a>${role && `<span class="Label">${role}</span>`}
    </div>`;
  const comments = pr.comments.map(
    (comment, index) => `
      <div class="timeline-comment-group" id="issuecomment-${index + 2}">
        <div class="timeline-comment">
          ${header(comment.login, comment.role)}
          <div class="edit-comment-hide"><table><tbody><tr>
            <td class="d-block comment-body markdown-body">${section(comment.items)}</td>
          </tr></tbody></table></div>
        </div>
      </div>`,
  );
  const data = { payload: { pullRequestsLayoutRoute: { pullRequest: { headSha: pr.headSha, author: { login: 'alice' } } } } };
  return `<!doctype html>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify(data)}</script>
    <div id="pullrequest-1" class="timeline-comment-group">
      ${header('alice', '')}
      <div class="comment-body markdown-body"><p>Adds the thing.</p>${pr.items ? section(pr.items) : ''}</div>
    </div>
    ${comments.join('')}`;
}

/** A changed file that the review order leaves out. */
export const UNLISTED_PATH = 'src/unlisted.ts';
/** Too long for the sidebar, so it has to truncate before its badge. */
export const LONG_PATH = 'src/a-very-long-component-name-that-does-not-fit.stories.tsx';
// Padding the classic tree so its sidebar has to scroll
const PADDING_PATHS = Array.from({ length: 30 }, (_, i) => `src/padding-${String(i).padStart(2, '0')}.ts`);
/** The files in the classic tree on /files, in its order. */
const CLASSIC_TREE_PATHS = ['src/core.ts', 'src/ui.ts', UNLISTED_PATH, LONG_PATH, ...PADDING_PATHS, 'README.md'];
/** The files on /changes. */
const CHANGES_PATHS = [...reviewOrder.map((item) => item.path), UNLISTED_PATH];

/** How many steps the panel has on each tab: the order, then the tree's files it leaves out. */
const stepCount = (paths: string[]) => new Set([...reviewOrder.map((item) => item.path), ...paths]).size;
export const FILES_STEPS = stepCount(CLASSIC_TREE_PATHS);
export const CHANGES_STEPS = stepCount(CHANGES_PATHS);

// The basic layout of GitHub's tree, then its active-file indicator rules verbatim from its
// stylesheet, which use the entries' ::before and ::after
const GITHUB_TREE_CSS = `
  :root { --base-size-4: 4px; --base-size-8: 8px; --base-size-12: 12px; --base-size-24: 24px; }
  .ActionList-item { position: relative; list-style: none; }
  .ActionList-content { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ActionList-item[aria-selected=true]:after{top:calc(50% - var(--base-size-12));left:calc(-1*var(--base-size-4));width:var(--base-size-4);height:var(--base-size-24);content:"";background:var(--bgColor-accent-emphasis,var(--color-accent-fg));border-radius:var(--borderRadius-medium);position:absolute}
  .ActionList-item.ActionList-item--navActive:not(.ActionList-item--danger):before,.ActionList-item.ActionList-item--navActive:not(.ActionList-item--danger)+.ActionList-item:before{visibility:hidden}
  .ActionList-item.ActionList-item--navActive:not(.ActionList-item--danger):after{top:calc(50% - var(--base-size-12));left:-var(--base-size-8);width:var(--base-size-4);height:var(--base-size-24);content:"";background:var(--bgColor-accent-emphasis,var(--color-accent-fg));border-radius:var(--borderRadius-medium);position:absolute}
`;

function filesPage(): string {
  // Listed out of order so scrolling has to jump around
  const files = [...reviewOrder].reverse().map(
    (item) => `<div id="${anchorId(item.path)}" style="height: 2000px">${item.path}</div>`,
  );
  // Stands in for GitHub's banner button that reloads the diff in place after a push
  const refresh = '<button>Refresh</button>';
  return `<!doctype html>
    <style>${GITHUB_TREE_CSS}</style>
    <aside id="sidebar" style="position: fixed; top: 0; left: 0; width: 250px; height: 300px; overflow-y: auto">
      <file-tree><nav aria-label="File Tree Navigation">${fileTree()}</nav></file-tree>
    </aside>
    <template id="file-tree-template">${fileTree()}</template>
    <main style="margin-left: 260px">${refresh}${files.join('')}</main>`;
}

/** GitHub's classic file tree markup, long enough that the sidebar has to scroll. */
function fileTree(): string {
  // GitHub marks the file currently in view as active
  const active = (path: string) => (path === reviewOrder[0]!.path ? ' ActionList-item--navActive' : '');
  const entry = (path: string) => `
    <li id="file-tree-item-${anchorId(path)}" class="ActionList-item ActionList-item--subItem${active(path)}" role="treeitem"
        aria-level="2" data-tree-entry-type="file" style="height: 32px">
      <span data-filterable-item-text hidden>${path}</span>
      <a class="ActionList-content" href="#${anchorId(path)}">${path.split('/').pop()}</a>
    </li>`;
  const src = CLASSIC_TREE_PATHS.filter((path) => path.startsWith('src/'));

  return `
    <ul class="ActionList ActionList--tree" role="tree" aria-label="File Tree">
      <li class="ActionList-item ActionList-item--hasSubItem" role="treeitem" aria-level="1"
          data-tree-entry-type="directory">
        <button class="ActionList-content">src</button>
        <ul class="ActionList ActionList--subGroup" role="group">${src.map(entry).join('')}</ul>
      </li>
      ${CLASSIC_TREE_PATHS.filter((path) => !path.startsWith('src/')).map(entry).join('')}
    </ul>`;
}

/** A function the PR moves from one file to another, re-indented on the way. */
export const MOVED = {
  from: { path: 'src/core.ts', start: 10 },
  to: { path: 'src/ui.ts', start: 20 },
  lines: ['export function resolveRecipient(talent: Talent) {', '  return talent.contactDetails.email;', '}'],
};

/** The PR's .diff: the moved function, and a line changed in place next to where it went. */
const PULL_DIFF = [
  `diff --git a/${MOVED.from.path} b/${MOVED.from.path}`,
  `--- a/${MOVED.from.path}`,
  `+++ b/${MOVED.from.path}`,
  `@@ -${MOVED.from.start},3 +${MOVED.from.start - 1},0 @@`,
  ...MOVED.lines.map((line) => `-${line}`),
  `diff --git a/${MOVED.to.path} b/${MOVED.to.path}`,
  `--- a/${MOVED.to.path}`,
  `+++ b/${MOVED.to.path}`,
  `@@ -${MOVED.to.start - 1},1 +${MOVED.to.start - 1},4 @@`,
  '-const before = 1;',
  '+const after = 2;',
  ...MOVED.lines.map((line) => `+  ${line}`),
  '',
].join('\n');

/** GitHub's unified diff table for a file: its removed lines, then its added ones, each with GitHub's colours. */
function diffTable(path: string, removed: [number, string][], added: [number, string][]): string {
  const anchor = anchorId(path);
  const cell = (side: string, line: number, color: string, extra = '') =>
    `<td data-diff-side="${side}" data-line-number="${line}" ${extra} style="background-color: ${color}">`;
  const removedRow = ([line, text]: [number, string]) => `
    <tr class="diff-line-row">
      ${cell('left', line, 'var(--diffBlob-deletionNum-bgColor, rgb(255, 206, 203))', 'data-first-unified-line-number-cell="true"')}${line}</td>
      <td class="empty-diff-line" style="background-color: var(--diffBlob-deletionNum-bgColor, rgb(255, 206, 203))"></td>
      ${cell('left', line, 'var(--diffBlob-deletionLine-bgColor, rgb(255, 235, 233))', `data-line-anchor="${anchor}L${line}"`)}<code>-${text}</code></td>
    </tr>`;
  const addedRow = ([line, text]: [number, string]) => `
    <tr class="diff-line-row">
      <td class="empty-diff-line" style="background-color: var(--diffBlob-additionNum-bgColor, rgb(172, 238, 187))"></td>
      ${cell('right', line, 'var(--diffBlob-additionNum-bgColor, rgb(172, 238, 187))', 'data-first-unified-line-number-cell="false"')}${line}</td>
      ${cell('right', line, 'var(--diffBlob-additionLine-bgColor, rgb(218, 251, 225))', `data-line-anchor="${anchor}R${line}"`)}<code>+${text}</code></td>
    </tr>`;
  return `<table data-diff-anchor="${anchor}" style="width: 900px; font: 12px monospace"><tbody>
    ${removed.map(removedRow).join('')}${added.map(addedRow).join('')}
  </tbody></table>`;
}

const numbered = (start: number, lines: string[]) => lines.map((line, i): [number, string] => [start + i, line]);
const DIFF_TABLES: Record<string, string> = {
  [anchorId(MOVED.from.path)]: diffTable(MOVED.from.path, numbered(MOVED.from.start, MOVED.lines), []),
  [anchorId(MOVED.to.path)]: diffTable(
    MOVED.to.path,
    [[MOVED.to.start - 1, 'const before = 1;']],
    numbered(MOVED.to.start - 1, ['const after = 2;', ...MOVED.lines.map((line) => `  ${line}`)]),
  ),
};

/**
 * GitHub's newer changes view, as on a large PR: only the first file is
 * rendered and the others appear once navigated to, but every file's viewed
 * state is embedded in the page. Navigated anchors are recorded in
 * `window.navigatedFiles`.
 */
function changesPage(viewed: Set<string>): string {
  const files = CHANGES_PATHS;
  const diffSummaries = files.map((path) => ({
    changeType: 'MODIFIED',
    markedAsViewed: viewed.has(path),
    path,
    pathDigest: anchorId(path).replace('diff-', ''),
  }));
  const data = JSON.stringify({ payload: { pullRequestsChangesRoute: { diffSummaries } } });
  const states = Object.fromEntries(files.map((path) => [anchorId(path), viewed.has(path)]));

  const treeEntry = (path: string) => `
    <li id="${path}" role="treeitem" aria-level="2" aria-label="${path.split('/').pop()}" aria-selected="false"
        aria-describedby="_r_1_" class="PRIVATE_TreeView-item" style="height: 32px; list-style: none">
      <div class="PRIVATE_TreeView-item-container"><span>${path.split('/').pop()}</span></div>
    </li>`;

  return `<!doctype html>
    <script type="application/json" data-target="react-app.embeddedData">${data}</script>
    <aside id="sidebar" style="position: fixed; top: 0; left: 0; width: 250px; height: 300px; overflow-y: auto">
      <ul role="tree" aria-label="File Tree">
        <li id="src" role="treeitem" aria-level="1" aria-expanded="true" style="list-style: none">
          <div><span>src</span></div>
          <ul role="group">${files.filter((path) => path.startsWith('src/')).map(treeEntry).join('')}</ul>
        </li>
        ${files.filter((path) => !path.startsWith('src/')).map(treeEntry).join('')}
      </ul>
    </aside>
    <main id="diff-comparison-viewer-container" style="margin-left: 260px">
      <button>Refresh</button>
    </main>
    <script>
      const states = ${JSON.stringify(states)};
      const tables = ${JSON.stringify(DIFF_TABLES)};
      window.navigatedFiles = [];

      function renderFile(anchor) {
        if (document.getElementById(anchor) || !(anchor in states)) return;
        const viewed = states[anchor];
        const container = document.createElement('div');
        container.id = anchor;
        container.style.height = '2000px';
        container.innerHTML =
          '<div><div><button type="button" aria-pressed="' + viewed + '" aria-label="' +
          (viewed ? 'Viewed' : 'Not Viewed') + '">Viewed</button></div></div>' + (tables[anchor] ?? '');
        container.querySelector('button').addEventListener('click', (event) => {
          const button = event.currentTarget;
          const pressed = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(pressed));
          button.setAttribute('aria-label', pressed ? 'Viewed' : 'Not Viewed');
        });
        document.querySelector('main').append(container);
      }

      // GitHub renders a file when it's navigated to. It ignores line anchors (#<file>L12 or R12).
      addEventListener('hashchange', () => {
        const anchor = location.hash.slice(1);
        navigatedFiles.push(anchor);
        renderFile(anchor);
        document.getElementById(anchor)?.scrollIntoView();
      });
      renderFile(Object.keys(states)[0]);
    </script>`;
}
