import type { BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';

export const CONVERSATION_URL = 'https://github.com/acme/repo/pull/1';
export const FILES_URL = `${CONVERSATION_URL}/files`;

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

/**
 * Serves a minimal stand-in for a GitHub PR. Assign `headSha` on the returned
 * object to simulate a new push.
 */
export async function servePullRequest(context: BrowserContext, headSha = 'a'.repeat(40)) {
  // Set conversationDelay to make reading the description slow, like a cold GitHub request
  const pr = { headSha, conversationDelay: 0 };

  await context.route('https://github.com/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/acme/repo/pull/1') {
      await new Promise((resolve) => setTimeout(resolve, pr.conversationDelay));
      return route.fulfill({ contentType: 'text/html', body: conversationPage(pr.headSha) });
    }
    if (pathname === '/acme/repo/pull/1/files') {
      return route.fulfill({ contentType: 'text/html', body: filesPage() });
    }
    return route.fulfill({ status: 404 });
  });

  return pr;
}

function conversationPage(headSha: string): string {
  const items = reviewOrder.map((item) => `<li><code>${item.path}</code>: ${item.description}</li>`);
  return `<!doctype html>
    <script type="application/json">{"pullRequest":{"headSha":"${headSha}"}}</script>
    <div class="comment-body markdown-body">
      <p>Adds the thing.</p>
      <div class="markdown-heading"><h2 class="heading-element">Review order</h2><a class="anchor"></a></div>
      <ol>${items.join('')}</ol>
    </div>`;
}

/** A changed file that the review order leaves out. */
export const UNLISTED_PATH = 'src/unlisted.ts';
/** Too long for the sidebar, so it has to truncate before its badge. */
export const LONG_PATH = 'src/a-very-long-component-name-that-does-not-fit.stories.tsx';

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
  const padding = Array.from({ length: 30 }, (_, i) => `src/padding-${String(i).padStart(2, '0')}.ts`);
  const src = ['src/core.ts', 'src/ui.ts', UNLISTED_PATH, LONG_PATH, ...padding];

  return `
    <ul class="ActionList ActionList--tree" role="tree" aria-label="File Tree">
      <li class="ActionList-item ActionList-item--hasSubItem" role="treeitem" aria-level="1"
          data-tree-entry-type="directory">
        <button class="ActionList-content">src</button>
        <ul class="ActionList ActionList--subGroup" role="group">${src.map(entry).join('')}</ul>
      </li>
      ${entry('README.md')}
    </ul>`;
}
