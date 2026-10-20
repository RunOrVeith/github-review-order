export interface ReviewItem {
  path: string;
  description: string;
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const MARKER = /^review order$/i;
const ITEM = /^\s*(\S+?)(?::(?:\s+([\s\S]*))?)?\s*$/;

/**
 * Finds the "Review order" heading in a rendered PR description and parses the
 * numbered list that follows it, stopping at the next heading.
 */
export function parseReviewOrder(body: ParentNode): ReviewItem[] | null {
  const heading = Array.from(body.querySelectorAll(HEADINGS)).find((el) =>
    MARKER.test(el.textContent?.trim() ?? ''),
  );
  if (!heading) return null;

  // GitHub wraps rendered headings in <div class="markdown-heading"> next to their anchor link
  const wrapper = heading.parentElement?.classList.contains('markdown-heading')
    ? heading.parentElement
    : heading;

  for (let el = wrapper.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(HEADINGS) || el.classList.contains('markdown-heading')) return null;
    if (el.tagName !== 'OL') continue;

    const items = Array.from(el.querySelectorAll(':scope > li'))
      .map((li) => parseItem(li.textContent ?? ''))
      .filter((item) => item !== null);
    return items.length > 0 ? items : null;
  }
  return null;
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

/** Changes whenever new commits are pushed or the review order is edited. */
export function reviewFingerprint(headSha: string | null, items: ReviewItem[]): string {
  return `${headSha ?? ''}:${JSON.stringify(items)}`;
}
