import type { ReviewFile } from '@/utils/file-tree';

/** Where the review order comes from, as a link to it on the conversation page. */
export interface PanelSource {
  text: string;
  href: string;
}

/** What the panel shows besides the order's own steps, set from outside it as it changes. */
export class PanelStatus {
  source = $state<PanelSource | null>(null);
  /** Why the review order is missing or may be out of date. */
  reviewProblem = $state<string | null>(null);
  /** Why GitHub's file tree doesn't show the review order. */
  treeProblem = $state<string | null>(null);
  /** The PR's files the order leaves out, in the tree's order; stepped through after the order. */
  unlisted = $state<ReviewFile[]>([]);
}
