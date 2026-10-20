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
  const pr = { headSha };

  await context.route('https://github.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/acme/repo/pull/1') {
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

function filesPage(): string {
  // Listed out of order so scrolling has to jump around
  const files = [...reviewOrder].reverse().map(
    (item) => `<div id="${anchorId(item.path)}" style="height: 2000px">${item.path}</div>`,
  );
  return `<!doctype html>${files.join('')}`;
}
