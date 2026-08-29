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
      await expect(page.locator('.mermaid-zoom-inner svg')).toBeVisible()
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

  test.describe('Zoom Pan Controls', () => {
    test.beforeEach(async ({ page }) => {
      await mockSSE(page, 'events/mermaid-zoom-diagram.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      // The fixture's two diagrams render async and the wide one takes longer, so without this
      // .mermaid-diagram.first() can resolve to the small one alone.
      await expect(page.locator('.mermaid-diagram')).toHaveCount(2)
      await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
    })

    // .mermaid-zoom-inner starts visibility:hidden until the fit effect sets its transform -
    // waiting for visible avoids racing that effect on a freshly opened (or reopened) overlay.
    async function contentBox(page) {
      const inner = page.locator('.mermaid-zoom-inner')
      await inner.waitFor({ state: 'visible' })
      return page.locator('.mermaid-zoom-inner svg').boundingBox()
    }

    // SPEC: chat:mermaid-zoom-whole
    test('a wide diagram opens fitted inside the viewport on both axes', async ({ page }) => {
      await page.locator('.mermaid-diagram').first().click()

      const viewport = await page.locator('.mermaid-zoom-content').boundingBox()
      const box = await contentBox(page)
      const naturalWidth = await page
        .locator('.mermaid-zoom-inner svg')
        .evaluate(el => el.viewBox.baseVal.width)

      // The fixture is wide enough that only fitting keeps it inside on the x axis - a box near
      // the natural width would mean the overlay cropped it instead.
      expect(naturalWidth).toBeGreaterThan(viewport.width * 1.5)
      expect(box.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(box.x).toBeGreaterThanOrEqual(viewport.x - 1)
      expect(box.y).toBeGreaterThanOrEqual(viewport.y - 1)
    })

    // SPEC: chat:mermaid-zoom-whole
    test('a diagram smaller than the viewport opens at its natural size, not enlarged', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').nth(1).click()

      const viewport = await page.locator('.mermaid-zoom-content').boundingBox()
      const box = await contentBox(page)

      expect(box.width).toBeLessThan(viewport.width * 0.6)
      expect(box.height).toBeLessThan(viewport.height * 0.6)
    })

    // SPEC: chat:mermaid-zoom-controls
    test('the corner offers zoom in, zoom out, fit, and four directional controls', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()

      const controls = page.locator('.mermaid-zoom-controls')
      await expect(controls).toBeVisible()
      for (const title of [
        'Zoom out',
        'Zoom in',
        'Fit to view',
        'Pan left',
        'Pan up',
        'Pan down',
        'Pan right',
      ]) {
        await expect(page.getByTitle(title)).toBeVisible()
      }
    })

    // SPEC: chat:mermaid-zoom-keys
    test('zoom in then zoom out returns the diagram to the same rendered size', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      const before = await contentBox(page)

      await page.getByTitle('Zoom in').click()
      const zoomed = await contentBox(page)
      expect(zoomed.width).toBeGreaterThan(before.width * 1.1)

      await page.getByTitle('Zoom out').click()
      const after = await contentBox(page)
      expect(after.width).toBeCloseTo(before.width, 0)
      expect(after.height).toBeCloseTo(before.height, 0)
    })

    // SPEC: chat:mermaid-zoom-keys
    test('+, =, and - zoom the same way the buttons do; page behind stays put', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      const before = await contentBox(page)
      const scrollBefore = await page.evaluate(() => window.scrollY)

      await page.keyboard.press('+')
      const afterPlus = await contentBox(page)
      expect(afterPlus.width).toBeGreaterThan(before.width)

      await page.keyboard.press('=')
      const afterEquals = await contentBox(page)
      expect(afterEquals.width).toBeGreaterThan(afterPlus.width)

      await page.keyboard.press('-')
      await page.keyboard.press('-')
      const afterMinus = await contentBox(page)
      expect(afterMinus.width).toBeLessThan(afterEquals.width)

      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
    })

    // SPEC: chat:mermaid-zoom-keys
    test('arrow keys pan the same way the directional controls do; page behind stays put', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()
      const before = await contentBox(page)
      const scrollBefore = await page.evaluate(() => window.scrollY)

      await page.keyboard.press('ArrowRight')
      const afterKey = await contentBox(page)
      expect(afterKey.x).not.toBeCloseTo(before.x, 0)

      await page.getByTitle('Pan left').click()
      const afterButton = await contentBox(page)
      expect(afterButton.x).toBeCloseTo(before.x, 0)

      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
    })

    // SPEC: chat:mermaid-zoom-wheel
    test('the wheel zooms about the pointer - the node under it stays under it', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      const before = await contentBox(page)
      // The box's own centre, not the viewport's - the wide fixture fits by width, so its box
      // isn't necessarily centred vertically in a taller viewport.
      const anchorX = before.x + before.width / 2
      const anchorY = before.y + before.height / 2

      await page.mouse.move(anchorX, anchorY)
      await page.mouse.wheel(0, -400)

      // The wheel handler's re-render can lag the dispatched event under load - poll for the
      // widened box rather than reading it once the wheel resolves.
      await expect
        .poll(async () => (await contentBox(page)).width)
        .toBeGreaterThan(before.width * 1.1)

      const after = await contentBox(page)
      const afterCenterX = after.x + after.width / 2
      const afterCenterY = after.y + after.height / 2
      expect(afterCenterX).toBeCloseTo(anchorX, 0)
      expect(afterCenterY).toBeCloseTo(anchorY, 0)
    })

    // SPEC: chat:mermaid-zoom-wheel
    test('pressing and dragging pans the diagram, following the pointer', async ({ page }) => {
      await page.locator('.mermaid-diagram').first().click()
      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()
      const before = await contentBox(page)

      const viewport = await page.locator('.mermaid-zoom-content').boundingBox()
      const startX = viewport.x + viewport.width / 2
      const startY = viewport.y + viewport.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX - 80, startY - 40, { steps: 8 })
      await page.mouse.up()

      const after = await contentBox(page)
      expect(after.x).toBeCloseTo(before.x - 80, -1)
      expect(after.y).toBeCloseTo(before.y - 40, -1)
    })

    // SPEC: chat:mermaid-zoom-close
    test('a drag that ends over the backdrop leaves the overlay open; a plain backdrop click still closes it', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()

      const viewport = await page.locator('.mermaid-zoom-content').boundingBox()
      // Start inside the zoomed, viewport-filling diagram and drag out into the backdrop margin.
      await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
      await page.mouse.down()
      await page.mouse.move(10, 10, { steps: 8 })
      await page.mouse.up()

      await expect(page.locator('.zoom-overlay')).toBeVisible()

      await page.locator('.zoom-overlay').click({ position: { x: 10, y: 10 } })
      await expect(page.locator('.zoom-overlay')).not.toBeVisible()
    })

    // SPEC: chat:mermaid-zoom-reset
    test('fit returns to the opening view in one action', async ({ page }) => {
      await page.locator('.mermaid-diagram').first().click()
      const opening = await contentBox(page)

      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Pan right').click()
      expect((await contentBox(page)).width).toBeGreaterThan(opening.width * 1.1)

      await page.getByTitle('Fit to view').click()
      const fitted = await contentBox(page)
      expect(fitted.width).toBeCloseTo(opening.width, 0)
      expect(fitted.x).toBeCloseTo(opening.x, 0)
      expect(fitted.y).toBeCloseTo(opening.y, 0)
    })

    // SPEC: chat:mermaid-zoom-bounded
    test('zoom stops at a bound; the control at that bound reads unavailable', async ({ page }) => {
      await page.locator('.mermaid-diagram').first().click()

      const zoomOut = page.getByTitle('Zoom out')
      const zoomIn = page.getByTitle('Zoom in')
      for (let i = 0; i < 15 && !(await zoomOut.isDisabled()); i++) {
        await zoomOut.click()
      }
      await expect(zoomOut).toBeDisabled()

      for (let i = 0; i < 30 && !(await zoomIn.isDisabled()); i++) {
        await zoomIn.click()
      }
      await expect(zoomIn).toBeDisabled()
    })

    // SPEC: chat:mermaid-zoom-reset
    test('reopening the overlay starts fitted again, not wherever it was left', async ({
      page,
    }) => {
      await page.locator('.mermaid-diagram').first().click()
      const opening = await contentBox(page)

      await page.getByTitle('Zoom in').click()
      await page.getByTitle('Zoom in').click()
      await page.keyboard.press('Escape')
      // Detached, not just hidden - the reopened overlay is a fresh mount (fresh fit state), and a
      // still-unmounting previous one would let the next click's own visibility wait resolve early.
      await page.locator('.zoom-overlay').waitFor({ state: 'detached' })

      await page.locator('.mermaid-diagram').first().click()
      const reopened = await contentBox(page)
      expect(reopened.width).toBeCloseTo(opening.width, 0)
    })

    // SPEC: chat:mermaid-zoom-keys
    test('with the overlay closed, arrows and + in the composer behave as they do today', async ({
      page,
    }) => {
      const composer = page.locator('[data-testid="chat-input"]')
      await composer.click()
      await composer.fill('a + b test')

      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowRight')

      await expect(composer).toHaveValue('a + b test')
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
