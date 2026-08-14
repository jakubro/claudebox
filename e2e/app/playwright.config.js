/** Playwright configuration for E2E tests with route-mocked API. */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/demo-video*'],

  workers: process.env.CLAUDEBOX_AGENT ? '20%' : '20%',
  fullyParallel: true,

  reporter: [['html', { open: 'never' }]],

  retries: 1,
  failOnFlakyTests: true,
  forbidOnly: !!process.env.CI || !!process.env.CLAUDEBOX_AGENT,

  timeout: 5 * 1000,
  expect: {
    timeout: 5 * 1000,
    toHaveScreenshot: {
      animations: 'disabled',
    },
  },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: ['**/mobile.spec.js'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: ['**/mobile.spec.js'],
      // Pixel 5 is Chromium-based, keeping the install footprint at chromium-only
      // while still providing a phone viewport (393x851) and hasTouch.
      use: { ...devices['Pixel 5'], hasTouch: true },
    },
  ],

  // The build is NOT here on purpose - it belongs to the `test-e2e-app` recipe.
  // This command runs only when Playwright decides to start a server, so with
  // `reuseExistingServer` a leftover `serve` would skip the build entirely and
  // the suite would score whatever bundle was left in dist/. Serving alone is
  // safe to skip: `serve` reads from disk per request, so a server started by
  // an earlier run picks up a freshly built bundle.
  webServer: {
    command: 'npx serve -s -l 5173 -L -n -u --no-port-switching ../../src/claudebox_frontend/dist',
    url: 'http://localhost:5173',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
})
