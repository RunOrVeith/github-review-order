import { SHOW_PANEL, type ShowPanelMessage } from '@/utils/messages';

export default defineBackground(() => {
  // Firefox builds are Manifest V2, which calls the toolbar button a browser action
  const action = browser.action ?? browser.browserAction;
  action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const message: ShowPanelMessage = { type: SHOW_PANEL };
    // Only GitHub tabs have the content script; anywhere else nothing is listening
    browser.tabs.sendMessage(tab.id, message).catch(() => {});
  });
});
