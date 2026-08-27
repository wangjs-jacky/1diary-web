import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
});
