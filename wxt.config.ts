import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    permissions: ['storage'],
  },
  webExt: {
    // Keeps the dev browser's profile, including the GitHub login, between runs
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
})
