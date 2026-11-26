import { mount } from 'svelte';
import { DIAGNOSE_MESSAGE, type DiagnoseMessage, type Diagnosis } from '@/utils/diagnosis';
import { SHOW_PANEL, type ShowPanelMessage } from '@/utils/messages';
import Popup from './Popup.svelte';

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Asks the active tab's content script what it found; rejects on tabs it doesn't run on. */
async function load(): Promise<Diagnosis | null> {
  const tabId = await activeTabId();
  if (tabId === undefined) return null;
  const message: DiagnoseMessage = { type: DIAGNOSE_MESSAGE };
  return ((await browser.tabs.sendMessage(tabId, message)) as Diagnosis | undefined) ?? null;
}

async function showPanel(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId === undefined) return;
  const message: ShowPanelMessage = { type: SHOW_PANEL };
  // The content script doesn't answer, so the channel closing without a response is expected
  await browser.tabs.sendMessage(tabId, message).catch(() => {});
}

mount(Popup, {
  target: document.getElementById('app')!,
  props: { load, showPanel, version: browser.runtime.getManifest().version },
});
