import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    permissions: ['storage'],
    // A PR's .diff redirects from github.com to patch-diff, so only the background can fetch it
    host_permissions: ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*'],
  },
  webExt: {
    // Keeps the dev browser's profile, including the GitHub login, between runs
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
})
