import { isProblemsMessage } from '@/utils/diagnosis';

export default defineBackground(() => {
  // Firefox's Manifest V2 build still calls the toolbar button browserAction
  const action = browser.action ?? browser.browserAction;

  // Marks the toolbar button on tabs whose review order has a problem; clicking it explains
  browser.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id;
    if (!isProblemsMessage(message) || tabId === undefined) return;
    void action.setBadgeText({ tabId, text: message.count > 0 ? '!' : '' });
    void action.setBadgeBackgroundColor({ tabId, color: '#bf8700' });
  });
});
