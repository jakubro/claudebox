/** E2E tests for mermaid diagram rendering. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Mermaid Diagrams', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Diagram Rendering', () => {
    // SPEC: chat:mermaid
    // SPEC: chat:mermaid-render
    test('renders mermaid code block as SVG diagram', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const container = page.locator('.mermaid-container').first()
      await expect(container).toBeVisible()

      const diagram = container.locator('.mermaid-diagram')
      await expect(diagram).toBeVisible()
      await expect(diagram.locator('svg')).toBeVisible()
    })

    // SPEC: chat:mermaid-theme
    test('diagram uses dark theme colors', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const svg = page.locator('.mermaid-diagram svg').first()
      await expect(svg).toBeVisible()

      // Verify dark theme: SVG background or node fill should use dark/muted colors
      const bgColor = await svg.evaluate(el => {
        // Check the SVG element's background or the first rect/node fill
        const rect = el.querySelector('rect, .node rect, .label-container')
        if (rect) {
          return getComputedStyle(rect).fill || rect.getAttribute('fill')
        }
        return getComputedStyle(el).backgroundColor
      })
      // Dark theme means the color is not white/light — expect a non-trivially-light value
      expect(bgColor).toBeTruthy()
      expect(bgColor).not.toBe('rgb(255, 255, 255)')
      expect(bgColor).not.toBe('#ffffff')
      expect(bgColor).not.toBe('white')
    })

    // SPEC: chat:mermaid-no-side-effect
    test('non-mermaid code blocks render normally', async ({ page }) => {
      // Use mixed fixture with both mermaid and JS code blocks
      await mockSSE(page, 'events/mermaid-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Mermaid block renders as SVG diagram
      await expect(page.locator('.mermaid-container').first()).toBeVisible()
      await expect(page.locator('.mermaid-diagram svg').first()).toBeVisible()

      // Non-mermaid JS code block renders as normal code (not mermaid)
      const codeBlock = page.locator('.code-block-wrapper').first()
      await expect(codeBlock).toBeVisible()
      await expect(codeBlock.locator('code')).toContainText('const x = 42')
    })
  })

  test.describe('Toggle', () => {
    // SPEC: chat:mermaid-toggle
    test('toggle button switches to source view', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const container = page.locator('.mermaid-container').first()
      await expect(container.locator('.mermaid-diagram')).toBeVisible()

      // Hover to reveal toolbar, click toggle
      await container.hover()
      await container.locator('.mermaid-toolbar-btn').first().click()

      // Should show syntax highlighter with source (PreTag="div" renders code inside div, not pre)
      await expect(container.locator('.mermaid-diagram')).not.toBeVisible()
      await expect(container.locator('code')).toBeVisible()
      await expect(container.locator('code')).toContainText('graph TD')
    })

    // SPEC: chat:mermaid-toggle
    test('toggle button switches back to diagram view', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const container = page.locator('.mermaid-container').first()
      await container.hover()

      // Toggle to source
      await container.locator('.mermaid-toolbar-btn').first().click()
      await expect(container.locator('code')).toBeVisible()

      // Toggle back to diagram
      await container.locator('.mermaid-toolbar-btn.pressed').click()
      await expect(container.locator('.mermaid-diagram')).toBeVisible()
    })
  })

  test.describe('Zoom', () => {
    // SPEC: chat:mermaid-zoom
    test('clicking diagram opens zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()

      await expect(page.locator('.mermaid-zoom-overlay')).toBeVisible()
      await expect(page.locator('.mermaid-zoom-content svg')).toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('Escape closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.mermaid-zoom-overlay')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('.mermaid-zoom-overlay')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('backdrop click closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.mermaid-zoom-overlay')).toBeVisible()

      // Click the overlay itself (backdrop), not the content
      await page.locator('.mermaid-zoom-overlay').click({ position: { x: 10, y: 10 } })
      await expect(page.locator('.mermaid-zoom-overlay')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('close button closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.mermaid-zoom-overlay')).toBeVisible()

      await page.locator('.zoom-overlay-close').click()
      await expect(page.locator('.mermaid-zoom-overlay')).not.toBeVisible()
    })
  })

  test.describe('Copy', () => {
    // SPEC: chat:mermaid-copy
    test('copy button copies raw mermaid source', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const container = page.locator('.mermaid-container').first()
      await container.hover()

      const copyBtn = container.locator('.copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      // Verify clipboard contains raw mermaid source
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('graph TD')
      expect(clipboardText).toContain('A[Start]')
    })
  })

  test.describe('Error Fallback', () => {
    // SPEC: chat:mermaid-fallback
    test('invalid mermaid falls back to syntax-highlighted code', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-invalid.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Should show code block wrapper (fallback), not mermaid diagram
      await expect(page.locator('.code-block-wrapper').first()).toBeVisible()
      await expect(page.locator('.mermaid-diagram')).not.toBeVisible()
    })
  })
})
