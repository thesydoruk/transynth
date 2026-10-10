import { defineConfig, devices } from '@playwright/test';

/*
 * Device tests: the same pages on a desktop, a tablet both ways round, and
 * three phones down to the 320 CSS px that WCAG 1.4.10 (Reflow) asks a page to
 * work at. Phones and tablets run in WebKit as well as Chromium, because
 * iPhone and iPad users only ever get Safari's engine.
 *
 * The API is faked (see e2e/mockApi.ts), so only a static preview of the build runs.
 */

const PORT = 5179;
const OUT_DIR = '.e2e-dist';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    { name: 'ipad-landscape', use: { ...devices['iPad Mini landscape'] } },
    { name: 'ipad', use: { ...devices['iPad Mini'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'] } },
  ],
  webServer: {
    // The production bundle, not the dev server: what users get, and no
    // on-demand compiling to slow the first visit to a page under parallel load.
    command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir --logLevel warn && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always a fresh server: one left over from an interrupted run hangs the suite.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
