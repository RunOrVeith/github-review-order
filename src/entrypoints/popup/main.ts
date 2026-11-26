import { mount } from 'svelte';
import { DIAGNOSE_MESSAGE, type DiagnoseMessage, type Diagnosis } from '@/utils/diagnosis';
import Popup from './Popup.svelte';

/** Asks the active tab's content script what it found; rejects on tabs it doesn't run on. */
async function load(): Promise<Diagnosis | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const message: DiagnoseMessage = { type: DIAGNOSE_MESSAGE };
  return ((await browser.tabs.sendMessage(tab.id, message)) as Diagnosis | undefined) ?? null;
}

mount(Popup, {
  target: document.getElementById('app')!,
  props: { load, version: browser.runtime.getManifest().version },
});
