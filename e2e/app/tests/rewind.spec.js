/** E2E tests for conversation rewind (fork). */

import { expect, test } from '@playwright/test'
import { openSessionsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Conversation Rewind', () => {
  test.describe('Rewind Button', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:rewind
    // SPEC: chat:rewind-button
    // SPEC: chat:fork-metadata-inherit
    test('rewind button appears on human messages on hover', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      // Hidden via opacity: 0, so it's attached but not visible until hover.
      const rewindBtn = userMessage.locator('.message-rewind-btn')
      await expect(rewindBtn).toBeAttached()

      await userMessage.hover()
      await expect(rewindBtn).toBeVisible()
    })

    // SPEC: chat:rewind-button
    test('rewind button has correct title', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      const rewindBtn = userMessage.locator('.message-rewind-btn')
      await expect(rewindBtn).toHaveAttribute(
        'title',
        'Rewind to before this message (Alt+Click or middle-click for new browser tab)',
      )
    })

    // SPEC: chat:rewind-button
    test('rewind button positioned top-right of user message', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()
      await userMessage.hover()

      const rewindSplit = userMessage.locator('.message-rewind-split')
      await expect(rewindSplit).toBeVisible()

      const position = await rewindSplit.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('absolute')

      const top = await rewindSplit.evaluate(el => getComputedStyle(el).top)
      expect(parseInt(top, 10)).toBeLessThanOrEqual(8)
    })
  })

  test.describe('Rewind Modal (agent responding)', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      // isResponding=true from this fixture is what makes the modal appear for fork-here.
      await mockSSE(page, 'events/responding.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:rewind-modal
    test('clicking rewind button shows modal when agent is responding', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()
      await expect(modal).toContainText('Rewind here?')
      await expect(modal).toContainText(
        'Creates a new session from this point in the same container.',
      )
    })

    // SPEC: chat:rewind-modal
    test('modal has cancel and confirm buttons', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const modal = page.locator('.rewind-modal')
      await expect(modal.locator('.rewind-modal-cancel')).toBeVisible()
      await expect(modal.locator('.rewind-modal-confirm')).toBeVisible()
    })

    // SPEC: chat:rewind-modal
    test('cancel button closes modal without action', async ({ page }) => {
      let forkCalled = false
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            forkCalled = true
            await route.fulfill({ status: 200, json: { session_id: 'new-id' } })
          },
        },
      })

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()

      await modal.locator('.rewind-modal-cancel').click()

      await expect(modal).not.toBeVisible()
      expect(forkCalled).toBe(false)
    })

    // SPEC: chat:rewind-modal
    test('clicking overlay closes modal', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const overlay = page.locator('.rewind-overlay')
      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()

      // Position targets the overlay backdrop, outside the modal content.
      await overlay.click({ position: { x: 10, y: 10 } })

      await expect(modal).not.toBeVisible()
    })

    // SPEC: chat:rewind-modal-spinner
    test('modal confirm button shows spinner while forking', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            // Delay keeps the spinner visible long enough to assert on.
            await new Promise(resolve => setTimeout(resolve, 500))
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()

      await modal.locator('.rewind-modal-confirm').click()

      const confirmBtn = modal.locator('.rewind-modal-confirm')
      await expect(confirmBtn).toBeDisabled()
      await expect(confirmBtn.locator('.spin')).toBeVisible()
    })
  })

  test.describe('Direct Fork (agent idle)', () => {
    // SPEC: chat:rewind-modal
    // SPEC: chat:fork-here-ownership-transfer
    // SPEC: chat:fork-new-tab-fresh-container
    // SPEC: panel-session:fork-here-running-indicator
    test('fork-here executes immediately without modal when agent is idle', async ({ page }) => {
      let forkCalled = false
      let forkPayload = null
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            forkCalled = true
            forkPayload = route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      await expect(page.locator('.rewind-modal')).not.toBeVisible()
      await expect.poll(() => forkCalled).toBe(true)
      // reuse_container=true moves the running-session indicator to the new fork; fork-in-new-tab omits it.
      expect(forkPayload?.reuse_container).toBe(true)
    })

    // SPEC: chat:fork-spinner
    test('fork button shows spinner while forking', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            await new Promise(resolve => setTimeout(resolve, 500))
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const rewindBtn = userMessage.locator('.message-rewind-btn')
      await expect(rewindBtn).toBeDisabled()
      await expect(rewindBtn.locator('.spin')).toBeVisible()
    })
  })

  test.describe('Rewind Split Button', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:rewind-split
    test('rewind button has chevron for fork options', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()

      const chevron = userMessage.locator('.message-rewind-chevron')
      await expect(chevron).toBeVisible()
      await expect(chevron).toHaveAttribute('title', 'Rewind options')
    })

    // SPEC: chat:rewind-split
    // SPEC: chat:fork-variants
    test('chevron opens dropdown with fork variants', async ({ page }) => {
      // The dropdown lists fork-here and fork-browser-tab - no third option.
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()

      await userMessage.locator('.message-rewind-chevron').click()

      const dropdown = page.locator('.rewind-dropdown')
      await expect(dropdown).toBeVisible()

      const options = dropdown.locator('.dropdown-option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveText('Rewind here')
      await expect(options.nth(1)).toHaveText('Rewind in new browser tab')
    })
  })

  test.describe('Fork Variants', () => {
    // SPEC: chat:fork-here
    test('fork-here modal shows correct text when agent responding', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/responding.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('.rewind-modal-title')).toHaveText('Rewind here?')
      await expect(modal.locator('.rewind-modal-detail')).toContainText('same container')
    })

    // SPEC: chat:fork-browser-tab
    test('fork-browser-tab executes directly without modal', async ({ page }) => {
      let forkCalled = false
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            forkCalled = true
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-chevron').click()
      await page.locator('.dropdown-option', { hasText: 'Rewind in new browser tab' }).click()

      await expect(page.locator('.rewind-modal')).not.toBeVisible()
      await expect.poll(() => forkCalled).toBe(true)
    })
  })

  test.describe('Fork Action', () => {
    // SPEC: chat:rewind-fork
    test('fork-here sends correct API parameters', async ({ page }) => {
      let forkPayload = null
      let forkUrl = null
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            forkUrl = route.request().url()
            forkPayload = await route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Second message (index 1) corresponds to turn_002.
      const userMessages = page.locator('[data-testid="message-user"]')
      await expect(userMessages).toHaveCount(3)

      const secondMessage = userMessages.nth(1)
      await secondMessage.hover()
      await secondMessage.locator('.message-rewind-btn').click()

      await expect.poll(() => forkPayload !== null).toBe(true)
      expect(forkUrl).toContain('/sessions/')
      expect(forkUrl).toContain('/fork')
      expect(forkPayload).toHaveProperty('turn_id', 'turn_002')
    })

    // SPEC: chat:rewind-fork
    test('successful fork navigates to new session', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      await expect.poll(() => page.url()).toContain('forked-session-001')
    })
  })

  test.describe('Session Tree', () => {
    // SPEC: chat:rewind-tree
    test('forked sessions appear nested under parent', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Fixture has 2 root sessions (test-session-001, test-session-003); children collapsed.
      const treeNodes = page.locator('.sessions-tree-node')
      await expect(treeNodes).toHaveCount(2)

      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expandBtn.click()

      await expect(treeNodes).toHaveCount(3)
    })

    // SPEC: chat:rewind-tree
    test('parent sessions with children have expand button', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // First expand button belongs to the parent, test-session-001.
      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expect(expandBtn).toBeVisible()
    })

    // SPEC: chat:rewind-tree
    test('child sessions are indented', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expandBtn.click()

      const treeNodes = page.locator('.sessions-tree-node')
      await expect(treeNodes).toHaveCount(3)

      // Pass-through gutter divs provide indentation, one per ancestor depth.
      const childNode = treeNodes.nth(1)
      const gutterCount = await childNode.evaluate(
        el =>
          el.querySelectorAll(
            '.sessions-tree-gutter-passthrough, .sessions-tree-gutter-passthrough-empty',
          ).length,
      )
      expect(gutterCount).toBeGreaterThan(0)
    })

    // SPEC: chat:rewind-tree
    test('clicking expand button toggles children visibility', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const childSession = page.getByText('Forked Session')
      const expandBtn = page.locator('.sessions-expand-btn').first()

      await expect(childSession).not.toBeVisible()

      await expandBtn.click()
      await expect(childSession).toBeVisible()

      await expandBtn.click()
      await expect(childSession).not.toBeVisible()
    })
  })

  test.describe('Button Visibility During Fork', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            // Delay keeps forking state visible before resolution.
            await new Promise(resolve => setTimeout(resolve, 500))
            await route.fulfill({
              status: 200,
              json: { session_id: 'forked-session-001' },
            })
          },
        },
      })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:rewind-button
    test('user message gets forking class when fork is in progress', async ({ page }) => {
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()

      await userMessage.locator('.message-rewind-btn').click()

      // The forking class keeps buttons visible without needing hover.
      await expect(userMessage).toHaveClass(/forking/)
    })
  })
})
