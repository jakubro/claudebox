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

    // Header should show "Thinking"
    await expect(thinkingBlock.locator('.thinking-label')).toHaveText('Thinking')

    // Preview should contain actual thinking content (truncated)
    const preview = thinkingBlock.locator('.thinking-preview')
    await expect(preview).toBeVisible()
    const previewText = await preview.textContent()
    expect(previewText.trim().length).toBeGreaterThan(0)
  })

  // SPEC: tool:thinking-bullet
  test('uses hollow circle bullet', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Should have hollow circle bullet (○)
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

    // First line content present
    await expect(preview).toContainText('Let me think about how to explain this clearly')

    // Claim says "truncated with ellipsis": the rendered content must end with
    // the ellipsis character (or CSS line-clamp must be applied).
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

    // Claim says "no quotes" — the rendered preview must not be wrapped in
    // matching surrounding quotes.
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

    // Click to expand
    await thinkingBlock.locator('.thinking-header-area').click()

    // Summary should be replaced by full content inline
    await expect(thinkingBlock.locator('.thinking-summary')).not.toBeVisible()
    const inline = thinkingBlock.locator('.thinking-content-inline')
    await expect(inline).toBeVisible()

    // Should show full thinking content
    await expect(inline).toContainText('First, I should consider')
    await expect(inline).toContainText('The key concepts are')

    // Claim says "rendered as formatted Markdown" — verify the expanded body
    // contains at least one rendered Markdown construct (paragraph, list,
    // strong/em, or code element) rather than a single plain-text node.
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

    // Record the bounding box of the thinking block before expanding
    const boxBefore = await thinkingBlock.boundingBox()

    // Expand
    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-content-inline')).toBeVisible()

    // Inline content should be inside the same thinking block (in place, not a separate panel)
    const inlineContent = thinkingBlock.locator('.thinking-content-inline')
    const inlineBox = await inlineContent.boundingBox()

    // Expanded content should start at approximately the same horizontal position
    expect(inlineBox.x).toBeGreaterThanOrEqual(boxBefore.x)
    expect(inlineBox.x).toBeLessThanOrEqual(boxBefore.x + boxBefore.width)

    // Preview line should be gone — replaced, not just hidden alongside
    await expect(thinkingBlock.locator('.thinking-summary')).not.toBeVisible()
  })

  // SPEC: tool:thinking-expand
  test('click again collapses content', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await expect(thinkingBlock).toBeVisible()

    // Expand
    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-content-inline')).toBeVisible()

    // Collapse
    await thinkingBlock.locator('.thinking-header-area').click()
    await expect(thinkingBlock.locator('.thinking-summary')).toBeVisible()
    await expect(thinkingBlock.locator('.thinking-content-inline')).not.toBeVisible()
  })

  test('corner bracket shows in preview', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Should have corner bracket (└)
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

    // Get the text content
    const text = await preview.textContent()

    // Should NOT have quotes around the preview
    expect(text).not.toMatch(/^".*"$/)
    expect(text).not.toMatch(/^'.*'$/)

    // Should be plain text starting with first line content
    expect(text).toContain('Let me think about')
  })

  // SPEC: tool:thinking-preview
  test('preview uses CSS text-overflow ellipsis', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const summary = page.locator('.thinking-summary').first()
    await expect(summary).toBeVisible()

    // Check CSS for ellipsis truncation
    const overflow = await summary.evaluate(el => {
      const style = window.getComputedStyle(el)
      return {
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
      }
    })

    // Should use CSS ellipsis for truncation
    expect(overflow.textOverflow).toBe('ellipsis')
  })

  // SPEC: tool:thinking-expand
  test('expanded content is rendered as formatted Markdown', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const thinkingBlock = page.locator('.thinking-block').first()
    await thinkingBlock.locator('.thinking-header-area').click()

    // Should show inline content
    const inlineContent = thinkingBlock.locator('.thinking-content-inline')
    await expect(inlineContent).toBeVisible()

    // Content should be rendered as Markdown — verify HTML elements from Markdown rendering
    const markdownElements = await inlineContent.locator('strong, em, p, ol, li').count()
    expect(markdownElements).toBeGreaterThan(0)
  })
})
