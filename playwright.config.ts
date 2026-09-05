import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'production-desktop', use: { baseURL: 'http://localhost:8788', viewport: { width: 1440, height: 1000 } } },
    { name: 'production-mobile', use: { baseURL: 'http://localhost:8788', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'development-desktop', use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 1000 } } },
    { name: 'development-mobile', use: { baseURL: 'http://localhost:5174', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node tests/serve-browser.mjs production', url: 'http://localhost:8788', reuseExistingServer: false },
    { command: 'node tests/serve-browser.mjs development', url: 'http://localhost:5174', reuseExistingServer: false },
  ],
});
