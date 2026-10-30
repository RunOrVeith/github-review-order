import { fetchPullDiff } from '@/utils/github';
import { isFetchDiffMessage, SHOW_PANEL, type FetchDiffResponse, type ShowPanelMessage } from '@/utils/messages';

export default defineBackground(() => {
  // Firefox builds are Manifest V2, which calls the toolbar button a browser action
  const action = browser.action ?? browser.browserAction;
  action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const message: ShowPanelMessage = { type: SHOW_PANEL };
    // Only GitHub tabs have the content script; anywhere else nothing is listening
    browser.tabs.sendMessage(tab.id, message).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isFetchDiffMessage(message)) return;
    fetchPullDiff(message.pr).then(
      (diff) => sendResponse({ diff } satisfies FetchDiffResponse),
      (error: unknown) => sendResponse({ error: String(error) } satisfies FetchDiffResponse),
    );
    // Keeps the channel open for the answer
    return true;
  });
});
