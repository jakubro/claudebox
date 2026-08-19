/** E2E tests for mermaid diagram rendering. */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
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

      const bgColor = await svg.evaluate(el => {
        const rect = el.querySelector('rect, .node rect, .label-container')
        if (rect) {
          return getComputedStyle(rect).fill || rect.getAttribute('fill')
        }
        return getComputedStyle(el).backgroundColor
      })
      // Dark theme is asserted indirectly: color must not be white/light.
      expect(bgColor).toBeTruthy()
      expect(bgColor).not.toBe('rgb(255, 255, 255)')
      expect(bgColor).not.toBe('#ffffff')
      expect(bgColor).not.toBe('white')
    })

    // SPEC: chat:mermaid-no-side-effect
    test('non-mermaid code blocks render normally', async ({ page }) => {
      // Fixture mixes a mermaid block with a JS code block.
      await mockSSE(page, 'events/mermaid-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.mermaid-container').first()).toBeVisible()
      await expect(page.locator('.mermaid-diagram svg').first()).toBeVisible()

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

      await container.hover()
      await container.locator('.mermaid-toolbar-btn').first().click()

      // PreTag="div" renders the highlighted source inside a div, not a pre.
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

      await container.locator('.mermaid-toolbar-btn').first().click()
      await expect(container.locator('code')).toBeVisible()

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

      await expect(page.locator('.zoom-overlay')).toBeVisible()
      await expect(page.locator('.mermaid-zoom-content svg')).toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('Escape closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.zoom-overlay')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('.zoom-overlay')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('backdrop click closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.zoom-overlay')).toBeVisible()

      // Click the overlay itself (backdrop), not the content
      await page.locator('.zoom-overlay').click({ position: { x: 10, y: 10 } })
      await expect(page.locator('.zoom-overlay')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-close
    test('close button closes zoom overlay', async ({ page }) => {
      await mockSSE(page, 'events/mermaid-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.locator('.mermaid-diagram').first().click()
      await expect(page.locator('.zoom-overlay')).toBeVisible()

      await page.locator('.zoom-overlay-close').click()
      await expect(page.locator('.zoom-overlay')).not.toBeVisible()
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

      await expect(page.locator('.code-block-wrapper').first()).toBeVisible()
      await expect(page.locator('.mermaid-diagram')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-failure-notice
    test('a syntax failure shows a notice naming the reason, source stays visible', async ({
      page,
    }) => {
      await mockSSE(page, 'events/mermaid-syntax-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const notice = page.locator('.mermaid-failure-notice')
      await expect(notice).toBeVisible()

      const text = await notice.locator('.mermaid-failure-text').textContent()
      expect(text).toContain('Diagram failed to draw - Parse error on line')
      expect(text).toContain('Expecting')

      // Source and copy button survive the failure, unaffected by the new notice.
      await expect(page.locator('.code-block-wrapper').first()).toBeVisible()
      await expect(page.locator('.code-copy-btn').first()).toBeVisible()
    })

    // SPEC: chat:mermaid-failure-notice
    test('an unsupported diagram type reports a reason distinct from a syntax error', async ({
      page,
    }) => {
      await mockSSE(page, 'events/mermaid-unsupported-type.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const notice = page.locator('.mermaid-failure-notice')
      await expect(notice).toBeVisible()
      const text = await notice.locator('.mermaid-failure-text').textContent()
      expect(text).toContain('Diagram failed to draw - No diagram type detected')
      // Distinct failure category from a grammar-level parse error (see the sibling test above).
      expect(text).not.toContain('Parse error')
    })

    // SPEC: chat:mermaid-failure-notice
    test('a corrected diagram in a later message draws with no notice carried over', async ({
      page,
    }) => {
      await mockSSE(page, 'events/mermaid-recover.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await disableAutoCollapse(page)

      await expect(page.locator('.mermaid-failure-notice')).toBeVisible()
      await expect(page.locator('.mermaid-diagram svg').first()).toBeVisible()
      // The second (corrected) diagram carries no notice, even though the first still shows one.
      await expect(page.locator('.mermaid-failure-notice')).toHaveCount(1)
    })
  })
})
