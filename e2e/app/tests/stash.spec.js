/** E2E tests for stash functionality. */

import { expect, test } from '@playwright/test'
import { openStashPanel, resolveOpsPayload, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Stash', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openStashPanel(page)
  })

  test.describe('Empty State', () => {
    // SPEC: panel-stash:empty-state
    test('shows empty stash message', async ({ page }) => {
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
      await expect(page.getByText('No stashed items')).toBeVisible()
    })

    // SPEC: panel-stash:empty-state
    test('shows stash keyboard hint but no full footer in empty state', async ({ page }) => {
      await expect(page.getByText('Ctrl+S to stash')).toBeVisible()
      // Full footer with both shortcuts should NOT be visible in empty state
      await expect(page.locator('.stash-footer')).not.toBeVisible()
    })
  })

  test.describe('Stash Push', () => {
    // SPEC: shortcut:ctrl-s
    test('Ctrl+S stashes text from input', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Type some text
      await input.fill('Test stash content')

      // Press Ctrl+S to stash
      await input.press('Control+s')

      // Stash item should appear
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Input should be cleared
      await expect(input).toHaveValue('')
    })

    // SPEC: panel-stash:preview
    test('stash item shows first line of content', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('First line of stashed text')
      await input.press('Control+s')

      await expect(page.getByText('First line of stashed text')).toBeVisible()
    })

    // SPEC: panel-stash:stack-order
    test('multiple stash items show in order', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Stash first item
      await input.fill('First item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(1)

      // Stash second item
      await input.fill('Second item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(2)

      // First item (most recent) should be "Second item"
      const items = page.locator('[data-testid="stash-item"]')
      await expect(items.first()).toContainText('Second item')
      await expect(items.nth(1)).toContainText('First item')
    })
  })

  test.describe('Stash Pop', () => {
    // SPEC: panel-stash:remove-button
    test('pop button inserts text and removes item', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Stash an item
      await input.fill('Stashed text')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Click pop button (CornerRightUp icon)
      const popButton = page.locator('[data-testid="stash-item"]').first().locator('button').last()
      await popButton.click()

      // Text should be inserted into input
      await expect(input).toHaveValue('Stashed text')

      // Stash should be empty
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })
  })

  test.describe('Stash Copy', () => {
    // SPEC: panel-stash:copy-button
    test('copy button copies text to clipboard without removing item', async ({
      page,
      context,
    }) => {
      // Grant clipboard permissions for CopyButton to work
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])

      const input = await waitForAppReady(page)

      // Stash an item
      await input.fill('Copied text')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Click copy button (CopyButton - clipboard copy, not textarea insertion)
      const copyButton = page
        .locator('[data-testid="stash-item"]')
        .first()
        .locator('button')
        .first()
      await copyButton.click()

      // CopyButton shows "Copied!" feedback after successful clipboard write
      await expect(copyButton).toHaveAttribute('title', 'Copied!')

      // Verify clipboard actually contains the stashed text
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Copied text')

      // Item should still be in stash (copy keeps the item)
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()
    })
  })

  test.describe('Stash Footer', () => {
    // SPEC: panel-stash:footer
    test('shows keyboard shortcuts when stash has items', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Stash an item to show footer
      await input.fill('Item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Footer should show keyboard hints
      await expect(page.getByText('Ctrl+S to stash')).toBeVisible()
      await expect(page.getByText('Ctrl+Shift+S to pop')).toBeVisible()
    })
  })

  test.describe('Stash Badge', () => {
    // SPEC: layout:badges
    // SPEC: panel-stash:badge
    test('badge shows item count', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Initially no badge (empty stash)
      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')

      // Stash first item
      await input.fill('First item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(1)

      // Badge should show "1"
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText('1')

      // Stash second item
      await input.fill('Second item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(2)

      // Badge should show "2"
      await expect(badge).toHaveText('2')
    })

    // SPEC: layout:badges
    test('badge updates on pop', async ({ page }) => {
      const input = await waitForAppReady(page)
      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')

      // Stash two items
      await input.fill('First')
      await input.press('Control+s')
      await input.fill('Second')
      await input.press('Control+s')
      await expect(badge).toHaveText('2')

      // Pop one item
      await page.getByTitle('Insert into input and remove').first().click()
      await expect(badge).toHaveText('1')

      // Pop second item
      await page.getByTitle('Insert into input and remove').first().click()

      // Badge should disappear (no items)
      await expect(badge).not.toBeVisible()
    })

    // SPEC: layout:badges
    test('no badge when stash is empty', async ({ page }) => {
      // Badge should not be visible initially
      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')
      await expect(badge).not.toBeVisible()
    })
  })

  test.describe('Stash Tooltips', () => {
    // SPEC: panel-stash:tooltip
    test('stash item has tooltip with full text', async ({ page }) => {
      const input = await waitForAppReady(page)

      // Stash a long message
      await input.fill('This is a long stashed message that shows in tooltip')
      await input.press('Control+s')

      // Stash item should have title attribute (native tooltip)
      const stashItem = page.locator('[data-testid="stash-item"]').first()
      await expect(stashItem).toBeVisible()
      await expect(stashItem).toHaveAttribute(
        'title',
        'This is a long stashed message that shows in tooltip',
      )
    })

    // SPEC: panel-stash:copy-tooltip
    test('copy button has tooltip', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('Test content')
      await input.press('Control+s')

      // Copy button should have title
      const copyButton = page
        .locator('[data-testid="stash-item"]')
        .first()
        .locator('button')
        .first()
      await expect(copyButton).toHaveAttribute('title', 'Copy')
    })

    // SPEC: panel-stash:remove-tooltip
    test('remove button has tooltip', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('Test content')
      await input.press('Control+s')

      // Remove button should have title
      const removeButton = page
        .locator('[data-testid="stash-item"]')
        .first()
        .locator('button')
        .last()
      await expect(removeButton).toHaveAttribute('title', 'Insert into input and remove')
    })
  })

  test.describe('Stash Persistence', () => {
    // SPEC: panel-stash:storage
    test('stash persists to server via ui-state API', async ({ page }) => {
      // Track PATCH calls to ui-state endpoint
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          const payload = await route.request().postDataJSON()
          patchCalls.push(payload)
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      const input = await waitForAppReady(page)

      await input.fill('Persisted stash item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Multiple PATCH calls fire in rapid succession (layout, panelGroups,
      // stash). Find the one carrying the stash key - checking only the LAST
      // patch race-conditions with the layout PATCH that frequently wins it.
      let stashPatch
      await expect
        .poll(() => {
          stashPatch = patchCalls.find(p => resolveOpsPayload(p).session?.stash)
          return stashPatch !== undefined
        })
        .toBe(true)

      const resolved = resolveOpsPayload(stashPatch)
      expect(resolved.session.stash[0].text).toBe('Persisted stash item')
      expect(resolved.session.stash[0].timestamp).toBeDefined()
    })
  })
})
