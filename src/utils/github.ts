export interface PullRef {
  owner: string;
  repo: string;
  number: number;
  isChangesTab: boolean;
}

export interface PullPage {
  description: Element | null;
  headSha: string | null;
}

// Everything that depends on GitHub's markup lives here
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/;
const CHANGES_TAB = /^\/(files|changes)(\/|$)/;
const DESCRIPTION_SELECTOR = '.comment-body.markdown-body';
const HEAD_SHA = /"headSha":"([0-9a-f]{40})"/;

export function parsePullUrl(url: string): PullRef | null {
  const match = PULL_PATH.exec(new URL(url).pathname);
  if (!match) return null;

  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
    isChangesTab: CHANGES_TAB.test(match[4] ?? ''),
  };
}

/** The changes tab doesn't contain the description, so it's read from the conversation page. */
export async function fetchPullPage(pr: PullRef): Promise<PullPage> {
  const url = new URL(`/${pr.owner}/${pr.repo}/pull/${pr.number}`, location.origin);
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return { description: null, headSha: null };

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    description: doc.querySelector(DESCRIPTION_SELECTOR),
    headSha: HEAD_SHA.exec(html)?.[1] ?? null,
  };
}

/** GitHub anchors each file on the changes tab at `#diff-<sha256 of its path>`. */
export async function diffAnchorId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `diff-${hex}`;
}
