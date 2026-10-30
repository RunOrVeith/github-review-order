/** Sent to a tab's content script when the extension's toolbar button is clicked. */
export const SHOW_PANEL = 'show-panel';

export interface ShowPanelMessage {
  type: typeof SHOW_PANEL;
}

export function isShowPanelMessage(message: unknown): message is ShowPanelMessage {
  return (message as ShowPanelMessage | null)?.type === SHOW_PANEL;
}
