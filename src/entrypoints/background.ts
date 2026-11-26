import { isProblemsMessage } from '@/utils/diagnosis';
import { fetchPullDiff } from '@/utils/github';
import { isFetchDiffMessage, type FetchDiffResponse } from '@/utils/messages';

export default defineBackground(() => {
  // Firefox builds are Manifest V2, which calls the toolbar button a browser action
  const action = browser.action ?? browser.browserAction;

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Marks the toolbar button on tabs whose review order has a problem; its popup explains
    if (isProblemsMessage(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      void action.setBadgeText({ tabId, text: message.count > 0 ? '!' : '' });
      void action.setBadgeBackgroundColor({ tabId, color: '#bf8700' });
      return;
    }

    if (!isFetchDiffMessage(message)) return;
    fetchPullDiff(message.pr).then(
      (diff) => sendResponse({ diff } satisfies FetchDiffResponse),
      (error: unknown) => sendResponse({ error: String(error) } satisfies FetchDiffResponse),
    );
    // Keeps the channel open for the answer
    return true;
  });
});
