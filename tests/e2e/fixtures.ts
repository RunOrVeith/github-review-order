import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import type { WxtBrowser } from 'wxt/browser';
import type { Diagnosis } from '../../src/utils/diagnosis';

// The extension's APIs, as seen from its service worker
declare const chrome: WxtBrowser;

// Built by `npm run e2e`, which re-checks the PR on every focus instead of throttling it
const pathToExtension = path.resolve(import.meta.dirname, '../../.output/chrome-mv3-e2e');

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    // The bundled Chromium channel is the only one that can load extensions headless
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  // The window's first tab, so the GitHub page is the only tab and the extension can find it without
  // the "tabs" permission it doesn't need otherwise
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});
export const expect = test.expect;

/** The extension's background service worker, which can call extension APIs as the extension. */
export async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

/**
 * Opens the toolbar button's popup for the page's tab. Playwright can't reach real popups, so it's
 * opened as a tab told the GitHub tab is the active one; its messages to that tab are real.
 */
export async function openPopup(context: BrowserContext): Promise<Page> {
  const worker = await extensionWorker(context);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({}))[0]!.id!);
  const popup = await context.newPage();
  await popup.addInitScript((id) => {
    (globalThis as unknown as { chrome: WxtBrowser }).chrome.tabs.query = async () => [{ id } as never];
  }, tabId);
  await popup.goto(new URL('popup.html', worker.url()).href);
  return popup;
}

/** Turns a setting on or off in the toolbar button's popup, then closes it; open tabs follow right away. */
export async function setSetting(context: BrowserContext, label: string, on: boolean) {
  const popup = await openPopup(context);
  const toggle = popup.getByRole('checkbox', { name: label });
  await toggle.setChecked(on);
  await expect(toggle).toBeChecked({ checked: on });
  await popup.close();
}

/** Sets a number in the toolbar button's popup, then closes it. */
export async function setNumberSetting(context: BrowserContext, label: string, value: number) {
  const popup = await openPopup(context);
  const field = popup.getByRole('spinbutton', { name: label });
  await field.fill(String(value));
  // Stored once the field is left, like a person tabbing or clicking away
  await field.blur();
  await expect(field).toHaveValue(String(value));
  await popup.close();
}

/** Whether a setting is on, as the toolbar button's popup shows it. */
export async function settingIsOn(context: BrowserContext, label: string): Promise<boolean> {
  const popup = await openPopup(context);
  const toggle = popup.getByRole('checkbox', { name: label });
  await expect(toggle).toBeVisible();
  const on = await toggle.isChecked();
  await popup.close();
  return on;
}

/** What the toolbar button's popup would show for the page's tab, asked from the extension like the popup does. */
export async function diagnosis(context: BrowserContext): Promise<Diagnosis> {
  return (await extensionWorker(context)).evaluate(async () => {
    const [tab] = await chrome.tabs.query({});
    return chrome.tabs.sendMessage(tab!.id!, { type: 'review-order:diagnose' });
  });
}

/** The badge on the toolbar button for the page's tab. */
export async function badgeText(context: BrowserContext): Promise<string> {
  return (await extensionWorker(context)).evaluate(async () => {
    const [tab] = await chrome.tabs.query({});
    return chrome.action.getBadgeText({ tabId: tab!.id! });
  });
}
