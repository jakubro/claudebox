/** E2E tests for raw HTML rendering and sanitization in chat messages. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Raw HTML in messages', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:html-content
  test('renders common HTML as formatted elements', async ({ page }) => {
    await mockSSE(page, 'events/html-content.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('summary', { hasText: 'Build log' })).toBeVisible()
    await expect(page.locator('kbd')).toHaveText('Ctrl+S')
  })

  // SPEC: chat:html-details-toggle
  test('details block expands and collapses', async ({ page }) => {
    await mockSSE(page, 'events/html-content.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const details = page.locator('details').first()
    await expect(details.locator('summary')).toBeVisible()
    expect(await details.evaluate(el => el.open)).toBe(false)

    await details.locator('summary').click()
    expect(await details.evaluate(el => el.open)).toBe(true)
  })

  // SPEC: chat:html-safe
  test('scripts and iframes are stripped and inert', async ({ page }) => {
    await mockSSE(page, 'events/html-content.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Content rendered, proving the message was processed.
    await expect(page.locator('kbd')).toBeVisible()

    expect(await page.locator('iframe[src*="evil.example"]').count()).toBe(0)
    expect(await page.evaluate(() => window.__xss_fired === true)).toBe(false)
  })

  // SPEC: chat:html-link-safe
  test('links open safely with rel and target', async ({ page }) => {
    await mockSSE(page, 'events/html-content.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const link = page.locator('a', { hasText: 'external link' })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  })
})
