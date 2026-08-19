/** Standalone config for the README demo GIF, outside test-e2e-app; only file selection differs. */

import { defineConfig, devices } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testMatch: ['**/demo-video*'],
  testIgnore: [],
  projects: [{ name: 'demo', use: { ...devices['Desktop Chrome'] } }],
})
