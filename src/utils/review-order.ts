import { sha256Hex } from './hash';

export interface ReviewItem {
  path: string;
  description: string;
}

/** The PR's changed files by their full paths, or null when they aren't known. */
export type ChangedFiles = ReadonlySet<string> | null;

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const BLOCK = /^(LI|P|DIV|UL|OL|BR)$/;
// "Review order", "Suggested review order", "Review order:" and so on
const MARKER = /\breview order\b/i;
// A first word that's a file, then "path: description", "path - description" or "path — description"
const HEAD = /^(\S+?)(?::(?=\s|$)|\s[-–—](?=\s|$)|$)/;
// Without the PR's files, a first word is a path if it has a folder or an extension
const PATH_LIKE = /\/|\.[A-Za-z0-9]+$/;
// Around a file named in running text, like "(`a.ts`," or "`b.ts`."
const LEADING_PUNCTUATION = /^[("'`[]+/;
const TRAILING_PUNCTUATION = /[)"'`\],;:.!?]+$/;

/**
 * The newest review order in the posts, which are oldest first, so a later
 * comment can replace the description's. Also returns the post it's from.
 */
export function latestReviewOrder<T extends { body: ParentNode }>(
  posts: T[],
  files: ChangedFiles = null,
): { items: ReviewItem[]; post: T } | null {
  for (let i = posts.length - 1; i >= 0; i--) {
    const items = parseReviewOrder(posts[i]!.body, files);
    if (items) return { items, post: posts[i]! };
  }
  return null;
}

/**
 * Finds the heading that mentions the review order in a rendered PR description
 * or comment, like "Review order" or "Suggested review order", and parses the
 * first numbered list after it, or failing that the first bullet list, stopping
 * at the next heading. A paragraph that's only bold text counts as a heading.
 * Null without such a heading, empty when the section has no files.
 */
export function parseReviewOrder(body: ParentNode, files: ChangedFiles = null): ReviewItem[] | null {
  // A quoted order is someone replying to it, not proposing one
  const marker = Array.from(body.querySelectorAll(`${HEADINGS}, p`)).find(
    (el) => !el.closest('blockquote') && isMarker(el),
  );
  if (!marker) return null;

  // GitHub wraps rendered headings in <div class="markdown-heading"> next to their anchor link
  const start = marker.parentElement?.classList.contains('markdown-heading') ? marker.parentElement : marker;

  let bullets: Element | null = null;
  for (let el = start.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(HEADINGS) || el.classList.contains('markdown-heading')) break;
    if (el.tagName === 'OL') return parseList(el, files);
    if (el.tagName === 'UL') bullets ??= el;
  }
  return bullets ? parseList(bullets, files) : [];
}

function isMarker(el: Element): boolean {
  const text = el.textContent?.trim() ?? '';
  if (!MARKER.test(text)) return false;
  if (el.matches(HEADINGS)) return true;

  // **Review order** on a line of its own stands in for a heading
  const only = el.childElementCount === 1 ? el.firstElementChild : null;
  return only !== null && only.matches('strong, b') && only.textContent?.trim() === text;
}

function parseList(list: Element, files: ChangedFiles): ReviewItem[] {
  return Array.from(list.querySelectorAll(':scope > li')).flatMap((li) => parseItem(itemText(li), files));
}

/** An item's text, with nested list items and paragraphs kept apart, which textContent runs together. */
function itemText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  const text = Array.from(node.childNodes, itemText).join('');
  return node instanceof Element && BLOCK.test(node.tagName) ? ` ${text} ` : text;
}

/**
 * The files one item of the list names. Mostly that's one, as in
 * "path/to/file.ts: description", split at the first colon followed by
 * whitespace (or a dash between spaces). Otherwise the item is a label followed
 * by files, as in "Tests: `a.test.ts` (timeouts), `b.test.ts` (retries)": each
 * file the PR changes gets the text up to the next one as its description.
 * Files can be named by the end of their path, like `b.test.ts` for
 * tests/api/b.test.ts, as long as only one of the PR's files ends that way.
 */
export function parseItem(text: string, files: ChangedFiles = null): ReviewItem[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const head = HEAD.exec(normalized);
  const rest = head ? normalized.slice(head[0].length).trim() : normalized;
  if (head) {
    const path = files ? resolvePath(head[1]!, files) : null;
    if (path) return [{ path, description: rest }];
    // A path the PR doesn't have still gets a step, which then says the file isn't found
    if (PATH_LIKE.test(head[1]!)) return [{ path: head[1]!, description: rest }];
  }

  const named = namedFiles(normalized, files);
  if (named.length === 0) return head ? [{ path: head[1]!, description: rest }] : [];

  const label = trimSeparators(normalized.slice(0, named[0]!.start));
  return named.map(({ path, end }, i) => {
    const own = cleanDescription(normalized.slice(end, named[i + 1]?.start ?? normalized.length));
    return { path, description: label && own ? `${label}: ${own}` : label || own };
  });
}

/** The PR's files the words of the text name, each once, with where its word is. */
function namedFiles(text: string, files: ChangedFiles): { path: string; start: number; end: number }[] {
  const found: { path: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0].replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '');
    // Without the PR's files only words with a folder are taken for paths, since names like `Foo.bar` may be code
    const path = files ? resolvePath(word, files) : word.includes('/') ? word : null;
    if (path && !found.some((file) => file.path === path)) {
      found.push({ path, start: match.index, end: match.index + match[0].length });
    }
  }
  return found;
}

/** The PR's file a reference names: its whole path, or the end of exactly one file's path. */
export function resolvePath(reference: string, files: ReadonlySet<string>): string | null {
  const path = reference.replace(/^\.?\//, '');
  if (!path) return null;
  if (files.has(path)) return path;

  let found: string | null = null;
  for (const file of files) {
    if (!file.endsWith(`/${path}`)) continue;
    // Two files end the same way, so the reference doesn't say which
    if (found) return null;
    found = file;
  }
  return found;
}

function trimSeparators(text: string): string {
  return text.replace(/^[\s:,;–—-]+|[\s:,;–—-]+$/g, '');
}

/** The text after a file, up to the next one, without what joins them, like "(retries), and". */
function cleanDescription(text: string): string {
  const trimmed = trimSeparators(text).replace(/(^|\s+)(and|or|&)$/i, '').replace(/[,;.]+$/, '');
  // "(retries)" is the whole description in brackets, "(a) and (b)" isn't
  return trimmed.startsWith('(') && trimmed.indexOf(')') === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
}

/** Changes whenever new commits are pushed or the review order is edited. Hashed so it stays small in storage. */
export function reviewFingerprint(headSha: string | null, items: ReviewItem[]): Promise<string> {
  return sha256Hex(`${headSha ?? ''}:${JSON.stringify(items)}`);
}
