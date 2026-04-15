const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: false, // Chrome extensions must be headful for testing
    viewport: { width: 1280, height: 720 },
  },
});
