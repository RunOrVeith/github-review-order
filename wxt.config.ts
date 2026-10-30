import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    permissions: ['storage'],
    // Clicking the toolbar button brings back a closed or minimized panel
    action: { default_title: 'Show review order' },
  },
  webExt: {
    // Keeps the dev browser's profile, including the GitHub login, between runs
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
})
