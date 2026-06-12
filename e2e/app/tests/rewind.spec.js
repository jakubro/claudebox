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
      // Wait for turns to render
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      // Button should be hidden by default (opacity: 0)
      const rewindBtn = userMessage.locator('.message-rewind-btn')
      await expect(rewindBtn).toBeAttached()

      // Hover to reveal button
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

      // Verify wrapper position is absolute and near top-right
      const position = await rewindSplit.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('absolute')

      const top = await rewindSplit.evaluate(el => getComputedStyle(el).top)
      expect(parseInt(top, 10)).toBeLessThanOrEqual(8)
    })
  })

  test.describe('Rewind Modal (agent responding)', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      // Use responding fixture so isResponding=true - modal appears for fork-here
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

      // Click cancel
      await modal.locator('.rewind-modal-cancel').click()

      // Modal should close
      await expect(modal).not.toBeVisible()

      // Fork API should not be called
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

      // Click overlay (outside modal)
      await overlay.click({ position: { x: 10, y: 10 } })

      // Modal should close
      await expect(modal).not.toBeVisible()
    })

    // SPEC: chat:rewind-modal-spinner
    test('modal confirm button shows spinner while forking', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            // Delay to keep spinner visible
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

      // Click confirm - spinner should appear
      await modal.locator('.rewind-modal-confirm').click()

      // Confirm button should be disabled with spinner
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

      // No modal should appear
      await expect(page.locator('.rewind-modal')).not.toBeVisible()

      // Fork API should be called directly
      await expect.poll(() => forkCalled).toBe(true)
      // Fork-here passes reuse_container=true so the running session moves
      // to the new fork; "fork in new tab" omits the flag (fresh container).
      // Both behaviours surface to the user as the running indicator moving
      // (or not) on the original session row.
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

      // Rewind button should show spinner and be disabled
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

      // Click rewind on second turn (turn_002) - agent idle, executes directly
      const userMessages = page.locator('[data-testid="message-user"]')
      await expect(userMessages).toHaveCount(3)

      const secondMessage = userMessages.nth(1)
      await secondMessage.hover()
      await secondMessage.locator('.message-rewind-btn').click()

      // Verify API was called directly (no modal)
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

      // URL should switch to the new forked session
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

      // Initially only root sessions visible (children collapsed)
      // 2 root sessions: test-session-001 and test-session-003
      const treeNodes = page.locator('.sessions-tree-node')
      await expect(treeNodes).toHaveCount(2)

      // Expand parent to show child
      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expandBtn.click()

      // Now all 3 sessions visible
      await expect(treeNodes).toHaveCount(3)
    })

    // SPEC: chat:rewind-tree
    test('parent sessions with children have expand button', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Parent session (test-session-001) should have expand button
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

      // Expand parent to show child
      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expandBtn.click()

      // Find tree nodes - now 3 visible
      const treeNodes = page.locator('.sessions-tree-node')
      await expect(treeNodes).toHaveCount(3)

      // Child node has pass-through gutter divs for indentation (one per ancestor depth)
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

      // Initially collapsed - child should be hidden
      await expect(childSession).not.toBeVisible()

      // Click expand button to expand
      await expandBtn.click()

      // Child should be visible
      await expect(childSession).toBeVisible()

      // Click again to collapse
      await expandBtn.click()
      await expect(childSession).not.toBeVisible()
    })
  })

  test.describe('Button Visibility During Fork', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            // Delay so forking state is visible before resolution
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

      // Click rewind button to start fork
      await userMessage.locator('.message-rewind-btn').click()

      // User message should have forking class (keeps buttons visible without hover)
      await expect(userMessage).toHaveClass(/forking/)
    })
  })
})
