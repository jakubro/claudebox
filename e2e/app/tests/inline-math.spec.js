/** E2E tests for inline math written GitHub's backtick way, $`...`$. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('Inline math', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/inline-math.jsonl')
  })

  // SPEC: chat:inline-math-forms
  test('backtick and dollar forms typeset as the same formulas, a dollar sign included', async ({
    page,
  }) => {
    const text = page.locator('.turn-text').first()
    await expect(text.locator('.katex').first()).toBeVisible()

    const sources = await text
      .locator('.katex annotation')
      .evaluateAll(nodes => nodes.map(n => n.textContent))
    expect(sources).toEqual(['\\sqrt{2}', 'a + \\$5', 'x', 'y', 'x^2'])
    await expect(text.locator('.katex-error')).toHaveCount(0)
    const drawn = await text.locator('.katex-html').evaluateAll(n => n.map(e => e.textContent))
    expect(drawn.join('')).not.toContain('‘')
    await expect(text.locator('p', { hasText: 'Cost' })).toHaveText(/end\.$/)
  })

  test('inline code holding dollars stays code', async ({ page }) => {
    await expect(page.locator('.turn-text code', { hasText: '$x$' })).toBeVisible()
  })
})
