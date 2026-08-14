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
      await expect(page.locator('.stash-footer')).not.toBeVisible()
    })
  })

  test.describe('Stash Push', () => {
    // SPEC: shortcut:ctrl-s
    test('Ctrl+S stashes text from input', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('Test stash content')
      await input.press('Control+s')

      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()
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

      await input.fill('First item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(1)

      await input.fill('Second item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(2)

      // Stack order: most recently pushed item is first.
      const items = page.locator('[data-testid="stash-item"]')
      await expect(items.first()).toContainText('Second item')
      await expect(items.nth(1)).toContainText('First item')
    })
  })

  test.describe('Stash Pop', () => {
    // SPEC: panel-stash:remove-button
    test('pop button inserts text and removes item', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('Stashed text')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Pop button is the last button in the item (CornerRightUp icon).
      const popButton = page.locator('[data-testid="stash-item"]').first().locator('button').last()
      await popButton.click()

      await expect(input).toHaveValue('Stashed text')
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })
  })

  test.describe('Stash Copy', () => {
    // SPEC: panel-stash:copy-button
    test('copy button copies text to clipboard without removing item', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])

      const input = await waitForAppReady(page)

      await input.fill('Copied text')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      // Copy button is the first button in the item, distinct from the pop button.
      const copyButton = page
        .locator('[data-testid="stash-item"]')
        .first()
        .locator('button')
        .first()
      await copyButton.click()

      await expect(copyButton).toHaveAttribute('title', 'Copied!')

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Copied text')

      // Copy leaves the item in the stash, unlike pop.
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()
    })
  })

  test.describe('Stash Footer', () => {
    // SPEC: panel-stash:footer
    test('shows keyboard shortcuts when stash has items', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('Item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]').first()).toBeVisible()

      await expect(page.getByText('Ctrl+S to stash')).toBeVisible()
      await expect(page.getByText('Ctrl+Shift+S to pop')).toBeVisible()
    })
  })

  test.describe('Stash Badge', () => {
    // SPEC: layout:badges
    // SPEC: panel-stash:badge
    test('badge shows item count', async ({ page }) => {
      const input = await waitForAppReady(page)

      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')

      await input.fill('First item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(1)

      await expect(badge).toBeVisible()
      await expect(badge).toHaveText('1')

      await input.fill('Second item')
      await input.press('Control+s')
      await expect(page.locator('[data-testid="stash-item"]')).toHaveCount(2)

      await expect(badge).toHaveText('2')
    })

    // SPEC: layout:badges
    test('badge updates on pop', async ({ page }) => {
      const input = await waitForAppReady(page)
      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')

      await input.fill('First')
      await input.press('Control+s')
      await input.fill('Second')
      await input.press('Control+s')
      await expect(badge).toHaveText('2')

      await page.getByTitle('Insert into input and remove').first().click()
      await expect(badge).toHaveText('1')

      await page.getByTitle('Insert into input and remove').first().click()
      await expect(badge).not.toBeVisible()
    })

    // SPEC: layout:badges
    test('no badge when stash is empty', async ({ page }) => {
      const badge = page.locator('[data-testid="icon-stash"] .icon-badge')
      await expect(badge).not.toBeVisible()
    })
  })

  test.describe('Stash Tooltips', () => {
    // SPEC: panel-stash:tooltip
    test('stash item has tooltip with full text', async ({ page }) => {
      const input = await waitForAppReady(page)

      await input.fill('This is a long stashed message that shows in tooltip')
      await input.press('Control+s')

      // title attribute drives the native browser tooltip.
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

      // Layout, panelGroups, and stash PATCH calls fire in rapid succession; find the one carrying the
      // stash key, since the last call is often the layout PATCH.
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
