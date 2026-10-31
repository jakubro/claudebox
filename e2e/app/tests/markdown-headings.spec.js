/** E2E tests that all six heading levels are styled as one family on every markdown surface. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

/** Computed size, weight and top margin of each heading in `root`, plus the first paragraph's size. */
function headingStyles(root) {
  const px = v => Number.parseFloat(v)
  const read = el => {
    const s = getComputedStyle(el)
    return {
      size: px(s.fontSize),
      weight: s.fontWeight,
      marginTopEm: px(s.marginTop) / px(s.fontSize),
    }
  }
  const headings = {}
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const el = root.querySelector(tag)
    if (el) {
      headings[tag] = read(el)
    }
  }
  return { headings, paragraph: px(getComputedStyle(root.querySelector('p')).fontSize) }
}

test.describe('Markdown headings', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/markdown-headings.jsonl')
  })

  // SPEC: chat:heading-levels
  test('agent text styles all six levels as one stepped family', async ({ page }) => {
    const text = page.locator('.turn-text').first()
    await expect(text.locator('h6')).toBeVisible()
    const { headings, paragraph } = await text.evaluate(headingStyles)

    const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    for (const tag of levels) {
      expect(headings[tag].weight, tag).toBe('600')
    }
    for (let i = 1; i < levels.length; i++) {
      expect(headings[levels[i]].size).toBeLessThanOrEqual(headings[levels[i - 1]].size)
    }
    expect(headings.h5.size / paragraph).toBeGreaterThanOrEqual(0.8)
    expect(headings.h6.size / paragraph).toBeGreaterThanOrEqual(0.8)
    expect(headings.h5.marginTopEm).toBeCloseTo(headings.h4.marginTopEm, 2)
    expect(headings.h6.marginTopEm).toBeCloseTo(headings.h4.marginTopEm, 2)
  })

  // SPEC: chat:heading-levels
  test('a message starting with a small heading has no gap above it', async ({ page }) => {
    const h5 = page.locator('.turn-text').nth(1).locator('h5')
    await expect(h5).toBeVisible()
    expect(await h5.evaluate(el => getComputedStyle(el).marginTop)).toBe('0px')
  })

  // SPEC: chat:heading-levels
  test('a compaction summary scales its headings to its smaller text', async ({ page }) => {
    const block = page.locator('.compaction-block').first()
    await block.locator('.compaction-header').click()
    const summary = block.locator('.compaction-summary')
    await expect(summary.locator('h5')).toBeVisible()

    const { headings, paragraph } = await summary.evaluate(headingStyles)
    expect(headings.h2.size).toBeGreaterThan(paragraph)
    expect(headings.h2.size / paragraph).toBeLessThan(1.4)
    expect(headings.h5.size / paragraph).toBeGreaterThanOrEqual(0.8)
    expect(headings.h5.weight).toBe('600')
  })
})
