import type { PullRef } from './github';

/** Sent to a tab's content script when the extension's toolbar button is clicked. */
export const SHOW_PANEL = 'show-panel';

export interface ShowPanelMessage {
  type: typeof SHOW_PANEL;
}

export function isShowPanelMessage(message: unknown): message is ShowPanelMessage {
  return (message as ShowPanelMessage | null)?.type === SHOW_PANEL;
}

/** Asks the background for a PR's diff, which content scripts can't fetch themselves. */
export const FETCH_DIFF = 'fetch-diff';

export interface FetchDiffMessage {
  type: typeof FETCH_DIFF;
  pr: Pick<PullRef, 'owner' | 'repo' | 'number'>;
}

export type FetchDiffResponse = { diff: string } | { error: string };

export function isFetchDiffMessage(message: unknown): message is FetchDiffMessage {
  const pr = (message as FetchDiffMessage | null)?.pr;
  return (
    (message as FetchDiffMessage | null)?.type === FETCH_DIFF &&
    typeof pr?.owner === 'string' &&
    typeof pr.repo === 'string' &&
    Number.isInteger(pr.number)
  );
}
