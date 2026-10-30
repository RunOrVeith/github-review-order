import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { SHOW_PANEL } from '../../src/utils/messages';

// Built by `npm run e2e`, which re-checks the PR on every focus instead of throttling it
const pathToExtension = path.resolve(import.meta.dirname, '../../.output/chrome-mv3-e2e');

export const test = base.extend<{ context: BrowserContext }>({
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
});
export const expect = test.expect;

/** Does what clicking the extension's toolbar button does, which Playwright can't reach. */
export async function clickToolbarButton(context: BrowserContext) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (message) => {
    const { tabs } = (globalThis as unknown as { chrome: typeof browser }).chrome;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    await tabs.sendMessage(tab!.id!, message);
  }, { type: SHOW_PANEL });
}
