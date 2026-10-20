import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

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
