import { conversationProblems, type ConversationState, type Diagnosis } from '@/utils/diagnosis';
import { findTreeEntries, hasUnreadableTree } from '@/utils/file-tree';
import { EMBEDDED_DATA_SELECTOR, parseViewedSnapshot, readRenderedViewToggles } from '@/utils/github';
import { UNREADABLE_TREE } from './tree-markers';

/** What the content script tracks itself; the rest is read off the page when asked. */
export interface DiagnosisInput {
  url: string;
  /** Like acme/repo#1, or null off a PR's changes tab. */
  pr: string | null;
  conversation: ConversationState | null;
  panel: Diagnosis['panel'];
}

export const NOT_A_CHANGES_TAB = "This isn't a pull request's changes tab, where the review order is shown.";
export const NO_REVIEW_ORDER = 'No "Review order" section in the description or the comments that were read.';
export const NO_TREE = "GitHub's file tree isn't on the page, so it can't show the review order.";

/** Everything the toolbar button's popup shows, read now so the page's current state is what's reported. */
export function diagnose(input: DiagnosisInput, root: Document = document): Diagnosis {
  const { url, pr, conversation, panel } = input;
  if (pr === null) {
    return { url, pr, conversation: null, tree: null, viewed: null, panel, problems: [], notes: [NOT_A_CHANGES_TAB] };
  }

  const tree = { files: findTreeEntries(root).size, unreadable: hasUnreadableTree(root) };
  const embedded = root.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent;
  const viewed = {
    rendered: readRenderedViewToggles(root).size,
    embedded: (embedded && parseViewedSnapshot(embedded)?.size) || null,
  };

  const problems = conversationProblems(conversation);
  if (tree.unreadable) problems.push(UNREADABLE_TREE);

  const notes: string[] = [];
  if (conversation?.state === 'read') {
    notes.push(...conversation.limitations);
    if (conversation.layout !== null && conversation.review === null) notes.push(NO_REVIEW_ORDER);
  }
  if (tree.files === 0 && !tree.unreadable) notes.push(NO_TREE);

  return { url, pr, conversation, tree, viewed, panel, problems, notes };
}
