/** E2E tests for the copy button on quotes, which copies a quote's markdown without its own `>`. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI, waitForStableScrollHeight } from '../helpers.js'

/**
 * Hover `quote` and copy it the way the app offers: a quote standing on its own in an agent message
 * through the part strip (with no button of its own), any other quote through its own button.
 */
async function copyQuote(page, quote) {
  await quote.hover({ position: { x: 20, y: 8 } })
  const topLevel = await quote.evaluate(el => el.parentElement.classList.contains('turn-text'))
  const own = quote.locator(':scope > .blockquote-copy-btn')
  if (topLevel) {
    await expect(own).toHaveCount(0)
    await page.getByTestId('block-strip').first().locator('.block-copy-btn').click()
  } else {
    await expect(own).toBeVisible()
    await own.click()
  }
  return page.evaluate(() => navigator.clipboard.readText())
}

test.describe('Quote copy', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openSessionWithAPI(page, 'events/quote-copy.jsonl')
    await expect(page.locator('.turn-text blockquote').first()).toBeVisible()
    await waitForStableScrollHeight(page.getByTestId('chat-messages'))
  })

  const quote = (page, text) => page.locator('.turn-text blockquote', { hasText: text }).last()

  const CASES = [
    ['Use', 'Use `npm test`:\n- **fast** run\n- full run'],
    ['b', 'a\n\nb'],
    ['first', 'first\nsecond'],
    ['quoted', 'quoted\nmore'],
    ['raw', 'raw text'],
    ['const x', '```js\nconst x = 1\n```'],
  ]

  for (const [text, expected] of CASES) {
    // SPEC: chat:copy-button-quote
    test(`the quote holding "${text}" copies without its leading marker`, async ({ page }) => {
      expect(await copyQuote(page, quote(page, text))).toBe(expected)
    })
  }

  // SPEC: chat:copy-button-quote
  test('an outer quote keeps the inner quote marker; the inner quote copies alone', async ({
    page,
  }) => {
    const outer = page.locator('.turn-text blockquote:has(> blockquote)')
    expect(await copyQuote(page, outer)).toBe('outer\n> inner')
    expect(await copyQuote(page, outer.locator('blockquote'))).toBe('inner')
  })

  // SPEC: chat:copy-button-quote-everywhere
  test('a quote in thinking has the same button', async ({ page }) => {
    await page.locator('.thinking-header-area').first().click()
    const thought = page.locator('.thinking-content-inline blockquote')
    expect(await copyQuote(page, thought)).toBe('thought quote\nsecond line')
  })
})
