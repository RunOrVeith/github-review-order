// What the content script found on a tab, for the toolbar button's popup to show. Nothing here
// opens the panel; problems that keep it hidden are only reported here and as a badge.

/** The popup asks the tab's content script for its diagnosis. */
export const DIAGNOSE_MESSAGE = 'review-order:diagnose';
/** The content script tells the background how many problems the tab has, for the badge. */
export const PROBLEMS_MESSAGE = 'review-order:problems';

export interface DiagnoseMessage {
  type: typeof DIAGNOSE_MESSAGE;
}

export interface ProblemsMessage {
  type: typeof PROBLEMS_MESSAGE;
  count: number;
}

export const UNRECOGNIZED_LAYOUT =
  "GitHub's conversation page has a layout this extension doesn't recognise, so the review order can't be read. " +
  'GitHub probably changed it.';
export const EMPTY_SECTION = 'The "Review order" section has no numbered list of files.';

/** How reading the PR's conversation page went. */
export type ConversationState =
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | {
      state: 'read';
      /** Which version of the page was read, or null when none was recognised. */
      layout: string | null;
      /** How many posts that may set the order were read: the description, then comments. */
      posts: number;
      headSha: string | null;
      limitations: string[];
      /** The review order that was found, or null without one. */
      review: { source: string; items: number } | null;
    };

export interface Diagnosis {
  url: string;
  /** Like acme/repo#1, or null off a PR's changes tab. */
  pr: string | null;
  /** Null off a PR's changes tab. */
  conversation: ConversationState | null;
  /** How many files the file tree has, and whether it has files that can't be identified. */
  tree: { files: number; unreadable: boolean } | null;
  /** How many files' viewed states the page has, as toggles and as embedded data (null without it). */
  viewed: { rendered: number; embedded: number | null } | null;
  /** Hidden when there's no review order to show, closed when the user closed it. */
  panel: 'shown' | 'minimized' | 'closed' | 'hidden';
  /** What keeps the review order from working, worst first. */
  problems: string[];
  /** Things worth knowing that aren't problems, e.g. what a layout can't read. */
  notes: string[];
}

export function isDiagnoseMessage(message: unknown): message is DiagnoseMessage {
  return (message as DiagnoseMessage | null)?.type === DIAGNOSE_MESSAGE;
}

export function isProblemsMessage(message: unknown): message is ProblemsMessage {
  const candidate = message as ProblemsMessage | null;
  return candidate?.type === PROBLEMS_MESSAGE && typeof candidate.count === 'number';
}

/** The problems with reading the conversation page; there are none while it loads. */
export function conversationProblems(conversation: ConversationState | null): string[] {
  if (conversation?.state === 'failed') return [conversation.reason];
  if (conversation?.state !== 'read') return [];
  if (conversation.layout === null) return [UNRECOGNIZED_LAYOUT];
  return conversation.review?.items === 0 ? [EMPTY_SECTION] : [];
}
