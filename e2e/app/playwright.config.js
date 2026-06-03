/** Playwright configuration for E2E tests with route-mocked API. */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/demo-video*'],

  workers: process.env.CLAUDEBOX_AGENT ? '25%' : '50%',
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
      // Pixel 5 is Chromium-based — keeps the install footprint at chromium-only
      // while still providing a phone viewport (393×851) and hasTouch.
      use: { ...devices['Pixel 5'], hasTouch: true },
    },
  ],

  webServer: {
    command:
      'npm --prefix ../../src/claudebox_frontend run build && npx serve -s -l 5173 -L -n -u --no-port-switching ../../src/claudebox_frontend/dist',
    url: 'http://localhost:5173',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
})
