import type { PullPost } from '../github';
import type { ConversationLayout } from './types';

// The server-rendered conversation page, with the description and comments as a timeline
const COMMENT_BODY_SELECTOR = '.comment-body.markdown-body';
const DESCRIPTION_SELECTOR = `[id^="pullrequest-"] ${COMMENT_BODY_SELECTOR}`;
// A body belongs to the nearest element with an id. Inline review comments (discussion_r123) are about a
// line of code and don't count.
const TIMELINE_COMMENT_ID = /^(issuecomment|pullrequestreview)-\d+$/;
const MINIMIZED_SELECTOR = '.minimized-comment';
// GitHub labels commenters by their role in the repo; these can usually edit the description anyway
const TRUSTED_ROLE = /^(owner|member|collaborator|author)$/i;

export const classicLayout: ConversationLayout = {
  name: 'classic',
  matches: ({ doc }) => doc.querySelector(COMMENT_BODY_SELECTOR) !== null,
  read: ({ doc, author }) => ({ posts: reviewOrderPosts(doc, author), limitations: [] }),
};

/**
 * The description, then the comments and review summaries by the PR's author
 * or its collaborators. Anyone can comment, but only they may change the order.
 */
function reviewOrderPosts(doc: Document, author: string | null): PullPost[] {
  const bodies = Array.from(doc.querySelectorAll(COMMENT_BODY_SELECTOR));
  // The description has always been the first body, so that stays if its container changes
  const description = doc.querySelector(DESCRIPTION_SELECTOR) ?? bodies[0];
  if (!description) return [];

  const posts: PullPost[] = [{ kind: 'description', author, anchor: null, body: description }];
  for (const body of bodies) {
    if (body === description || body.closest(MINIMIZED_SELECTOR)) continue;
    const comment = body.parentElement?.closest('[id]');
    if (!comment || !TIMELINE_COMMENT_ID.test(comment.id)) continue;

    const login = comment.querySelector('a.author')?.textContent?.trim() || null;
    if (!isTrustedCommenter(comment, login, author)) continue;
    const kind = comment.id.startsWith('pullrequestreview-') ? 'review' : 'comment';
    posts.push({ kind, author: login, anchor: comment.id, body });
  }
  return posts;
}

function isTrustedCommenter(comment: Element, login: string | null, author: string | null): boolean {
  if (author && login === author) return true;

  // Markdown can't set classes, so labels are GitHub's, but those inside the body are skipped anyway
  return Array.from(comment.querySelectorAll('.Label')).some(
    (label) => !label.closest(COMMENT_BODY_SELECTOR) && TRUSTED_ROLE.test(label.textContent?.trim() ?? ''),
  );
}
