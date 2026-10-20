import { sha256Hex } from './hash';

export interface ReviewItem {
  path: string;
  description: string;
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const MARKER = /^review order$/i;
const ITEM = /^\s*(\S+?)(?::(?:\s+([\s\S]*))?)?\s*$/;

/**
 * The newest review order in the posts, which are oldest first, so a later
 * comment can replace the description's. Also returns the post it's from.
 */
export function latestReviewOrder<T extends { body: ParentNode }>(posts: T[]): { items: ReviewItem[]; post: T } | null {
  for (let i = posts.length - 1; i >= 0; i--) {
    const items = parseReviewOrder(posts[i]!.body);
    if (items) return { items, post: posts[i]! };
  }
  return null;
}

/**
 * Finds the "Review order" heading in a rendered PR description or comment and
 * parses the numbered list that follows it, stopping at the next heading. Null
 * without such a heading, empty when the section has no files.
 */
export function parseReviewOrder(body: ParentNode): ReviewItem[] | null {
  // A quoted order is someone replying to it, not proposing one
  const heading = Array.from(body.querySelectorAll(HEADINGS)).find(
    (el) => !el.closest('blockquote') && MARKER.test(el.textContent?.trim() ?? ''),
  );
  if (!heading) return null;

  // GitHub wraps rendered headings in <div class="markdown-heading"> next to their anchor link
  const wrapper = heading.parentElement?.classList.contains('markdown-heading')
    ? heading.parentElement
    : heading;

  for (let el = wrapper.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(HEADINGS) || el.classList.contains('markdown-heading')) return [];
    if (el.tagName !== 'OL') continue;

    return Array.from(el.querySelectorAll(':scope > li'))
      .map((li) => parseItem(li.textContent ?? ''))
      .filter((item) => item !== null);
  }
  return [];
}

/** Splits "path/to/file.ts: description" at the first colon followed by whitespace. */
export function parseItem(text: string): ReviewItem | null {
  const match = ITEM.exec(text);
  if (!match) return null;

  return {
    path: match[1]!,
    description: (match[2] ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/** Changes whenever new commits are pushed or the review order is edited. Hashed so it stays small in storage. */
export function reviewFingerprint(headSha: string | null, items: ReviewItem[]): Promise<string> {
  return sha256Hex(`${headSha ?? ''}:${JSON.stringify(items)}`);
}
