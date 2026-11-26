import type { ConversationLayout, ConversationPage } from './types';

// GitHub's React "overview" page. Its markup uses generated class names, but it embeds the
// description as rendered HTML, which is read instead.
const ROUTE = 'pullRequestsOverviewIndexRoute';

export const COMMENTS_NOT_READ =
  "GitHub's new overview page loads comments separately, so only the description's review order is read.";

export const overviewLayout: ConversationLayout = {
  name: 'overview',
  matches: (page) => typeof descriptionHtml(page) === 'string',
  read(page) {
    // The fetched page is inert, so nothing in the markup loads or runs while it's parsed
    const body = page.doc.createElement('div');
    body.className = 'markdown-body';
    const html = descriptionHtml(page);
    body.innerHTML = typeof html === 'string' ? html : '';
    return {
      posts: [{ kind: 'description', author: page.author, anchor: null, body }],
      limitations: [COMMENTS_NOT_READ],
    };
  },
};

function descriptionHtml({ payload }: ConversationPage): unknown {
  const route = payload?.[ROUTE];
  return route && typeof route === 'object' ? (route as { description?: unknown }).description : undefined;
}
