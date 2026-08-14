/** E2E tests for thinking blocks display. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Thinking Blocks', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/thinking.jsonl')
  })

  // SPEC: tool:thinking-preview
  test('thinking block renders with header', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Thinking block should be visible (use first() for strict mode)
    const thinkingBlock = page.locator('.thinking-block').first()
    await expect(thinkingBlock).toBeVisible()

    await expect(thinkingBlock.locator('.thinking-label')).toHaveText('Thinking')

    const preview = thinkingBlock.locator('.thinking-preview')
    await expect(preview).toBeVisible()
    const previewText = await preview.textContent()
    expect(previewText.trim().length).toBeGreaterThan(0)
  })

  // SPEC: tool:thinking-bullet
  test('uses hollow circle bullet', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const bullet = page.locator('.thinking-bullet').first()
    await expect(bullet).toBeVisible()
    await expect(bullet).toHaveText('○')
  })

  // SPEC: tool:thinking-preview
  test('preview shows first line, truncated with ellipsis, no quotes', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const preview = page.locator('.thinking-summary').first()
    await expect(preview).toBeVisible()

    await expect(preview).toContainText('Let me think about how to explain this clearly')

    // Claim is "truncated with ellipsis" - accept the ellipsis char or CSS line-clamp as evidence.
    const previewText = (await preview.textContent())?.trim() ?? ''
    const overflow = await preview.evaluate(el => getComputedStyle(el).textOverflow)
    const lineClamp = await preview.evaluate(
      el => getComputedStyle(el).webkitLineClamp || getComputedStyle(el).lineClamp,
    )
    const looksTruncated =
      previewText.endsWith('…') ||
      previewText.endsWith('...') ||
      overflow === 'ellipsis' ||
      (lineClamp && lineClamp !== 'none' && lineClamp !== '')
    expect(looksTruncated, `preview text "${previewText}" must show truncation`).toBe(true)

    // Claim says "no quotes" - the rendered preview must not be wrapped in matching surrounding quotes.
    expect(previewText.startsWith('"') && previewText.endsWith('"')).toBe(false)
    expect(previewText.startsWith("'") && previewText.endsWith("'")).toBe(false)
  })

  // SPEC: tool:thinking-expand
  test('click expands full content rendered as formatted Markdown', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await expect(thinkingBlock).toBeVisible()

    // Initially, summary should be visible (collapsed state)
    await expect(thinkingBlock.locator('.thinking-summary')).toBeVisible()

    await thinkingBlock.locator('.thinking-header-area').click()

    await expect(thinkingBlock.locator('.thinking-summary')).not.toBeVisible()
    const inline = thinkingBlock.locator('.thinking-content-inline')
    await expect(inline).toBeVisible()

    await expect(inline).toContainText('First, I should consider')
    await expect(inline).toContainText('The key concepts are')

    // Claim is "rendered as formatted Markdown" - require a real node (p, list, strong/em, code), not plain text.
    const renderedNodes = await inline.evaluate(el => {
      const tags = ['P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'CODE', 'PRE', 'H1', 'H2', 'H3']
      return tags.filter(t => el.querySelector(t.toLowerCase()))
    })
    expect(
      renderedNodes.length,
      `expected at least one rendered Markdown element; found ${renderedNodes}`,
    ).toBeGreaterThan(0)
  })

  // SPEC: tool:thinking-expand-inline
  test('expanded content replaces preview in place within the same block', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await expect(thinkingBlock).toBeVisible()

    const boxBefore = await thinkingBlock.boundingBox()

    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-content-inline')).toBeVisible()

    // Inline content should be inside the same thinking block (in place, not a separate panel)
    const inlineContent = thinkingBlock.locator('.thinking-content-inline')
    const inlineBox = await inlineContent.boundingBox()

    expect(inlineBox.x).toBeGreaterThanOrEqual(boxBefore.x)
    expect(inlineBox.x).toBeLessThanOrEqual(boxBefore.x + boxBefore.width)

    // Preview line should be gone - replaced, not just hidden alongside
    await expect(thinkingBlock.locator('.thinking-summary')).not.toBeVisible()
  })

  // SPEC: tool:thinking-expand
  test('click again collapses content', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await expect(thinkingBlock).toBeVisible()

    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-content-inline')).toBeVisible()

    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-summary')).toBeVisible()
    await expect(thinkingBlock.locator('.thinking-content-inline')).not.toBeVisible()
  })

  test('corner bracket shows in preview', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const corner = page.locator('.thinking-corner').first()
    await expect(corner).toBeVisible()
    await expect(corner).toHaveText('└')
  })

  // SPEC: tool:thinking-preview
  test('preview shows plain text without quotes', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const preview = page.locator('.thinking-summary').first()
    await expect(preview).toBeVisible()

    const text = await preview.textContent()

    expect(text).not.toMatch(/^".*"$/)
    expect(text).not.toMatch(/^'.*'$/)
    expect(text).toContain('Let me think about')
  })

  // SPEC: tool:thinking-preview
  test('preview uses CSS text-overflow ellipsis', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const summary = page.locator('.thinking-summary').first()
    await expect(summary).toBeVisible()

    const overflow = await summary.evaluate(el => {
      const style = window.getComputedStyle(el)
      return {
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
      }
    })

    expect(overflow.textOverflow).toBe('ellipsis')
  })

  // SPEC: tool:thinking-expand
  test('expanded content is rendered as formatted Markdown', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await thinkingBlock.locator('.thinking-header-area').click()

    const inlineContent = thinkingBlock.locator('.thinking-content-inline')
    await expect(inlineContent).toBeVisible()

    const markdownElements = await inlineContent.locator('strong, em, p, ol, li').count()
    expect(markdownElements).toBeGreaterThan(0)
  })
})
