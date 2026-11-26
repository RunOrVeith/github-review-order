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
