import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const pathToExtension = path.resolve(import.meta.dirname, '../../.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
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
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');

    await use(serviceWorker.url().split('/')[2]!);
  },
});
export const expect = test.expect;
