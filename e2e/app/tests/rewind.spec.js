/** E2E tests for conversation rewind (fork). */

import { expect, test } from '@playwright/test'
import { openSession, openSessionsPanel, openSessionWithAPI } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

async function mockSlowFork(page) {
  await mockAPI(page, {
    handlers: {
      forkSession: async route => {
        await new Promise(resolve => setTimeout(resolve, 500))
        await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
      },
    },
  })
}

async function openWithRecordedFork(page) {
  const fork = { called: false, payload: null, url: null }
  await openSessionWithAPI(page, 'events/multi-turn.jsonl', {
    handlers: {
      forkSession: async route => {
        fork.called = true
        fork.url = route.request().url()
        fork.payload = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
      },
    },
  })

  return fork
}

async function openRewindModal(page) {
  const userMessage = page.locator('[data-testid="message-user"]').first()
  await userMessage.hover()
  await userMessage.locator('.message-rewind-btn').click()
  const modal = page.locator('.rewind-modal')
  await expect(modal).toBeVisible()

  return modal
}

test.describe('Conversation Rewind', () => {
  test.describe('Rewind Button', () => {
    test.beforeEach(async ({ page }) => {
      await openSessionWithAPI(page, 'events/multi-turn.jsonl')
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

      const bubble = await userMessage.boundingBox()
      const rewind = await rewindSplit.boundingBox()
      expect(rewind.y - bubble.y).toBeLessThanOrEqual(8)
      expect(rewind.x).toBeGreaterThan(bubble.x + bubble.width / 2)
    })
  })

  test.describe('Rewind Modal (agent responding)', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      // isResponding=true from this fixture is what makes the modal appear for fork-here.
      await openSession(page, 'events/responding.jsonl')
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
      const modal = await openRewindModal(page)
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

      const modal = await openRewindModal(page)

      await modal.locator('.rewind-modal-cancel').click()

      await expect(modal).not.toBeVisible()
      expect(forkCalled).toBe(false)
    })

    // SPEC: chat:rewind-modal
    test('clicking overlay closes modal', async ({ page }) => {
      const modal = await openRewindModal(page)
      const overlay = page.locator('.rewind-overlay')

      // Position targets the overlay backdrop, outside the modal content.
      await overlay.click({ position: { x: 10, y: 10 } })

      await expect(modal).not.toBeVisible()
    })

    // SPEC: chat:rewind-modal-spinner
    test('modal confirm button shows spinner while forking', async ({ page }) => {
      // Delay keeps the spinner visible long enough to assert on.
      await mockSlowFork(page)

      const modal = await openRewindModal(page)

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
      const fork = await openWithRecordedFork(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      await expect(page.locator('.rewind-modal')).not.toBeVisible()
      await expect.poll(() => fork.called).toBe(true)
      // reuse_container=true moves the running-session indicator to the new fork; fork-in-new-tab omits it.
      expect(fork.payload?.reuse_container).toBe(true)
    })

    // SPEC: chat:fork-missing-history
    test('a fork the daemon refuses leaves the current conversation open with its failure message', async ({
      page,
    }) => {
      await mockAPI(page, {
        handlers: {
          forkSession: route =>
            route.fulfill({
              status: 409,
              json: { error: 'session_transcript_missing', session_id: 'test-session-001' },
            }),
        },
      })
      await openSession(page, 'events/multi-turn.jsonl')
      const urlBefore = page.url()

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-btn').click()

      await expect(page.locator('[data-testid="footer"]')).toContainText('Rewind failed')
      expect(page.url()).toBe(urlBefore)
      await expect(page.locator('[data-testid="message-user"]').first()).toBeVisible()
    })

    // SPEC: chat:fork-spinner
    test('fork button shows spinner while forking', async ({ page }) => {
      await mockSlowFork(page)
      await openSession(page, 'events/multi-turn.jsonl')

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
      await openSessionWithAPI(page, 'events/multi-turn.jsonl')
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
      await openSessionWithAPI(page, 'events/responding.jsonl')

      const modal = await openRewindModal(page)
      await expect(modal.locator('.rewind-modal-title')).toHaveText('Rewind here?')
      await expect(modal.locator('.rewind-modal-detail')).toContainText('same container')
    })

    // SPEC: chat:fork-browser-tab
    test('fork-browser-tab executes directly without modal', async ({ page }) => {
      const fork = await openWithRecordedFork(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await userMessage.hover()
      await userMessage.locator('.message-rewind-chevron').click()
      await page.locator('.dropdown-option', { hasText: 'Rewind in new browser tab' }).click()

      await expect(page.locator('.rewind-modal')).not.toBeVisible()
      await expect.poll(() => fork.called).toBe(true)
    })
  })

  test.describe('Fork Action', () => {
    // SPEC: chat:rewind-fork
    test('fork-here sends correct API parameters', async ({ page }) => {
      const fork = await openWithRecordedFork(page)

      // Second message (index 1) corresponds to turn_002.
      const userMessages = page.locator('[data-testid="message-user"]')
      await expect(userMessages).toHaveCount(3)

      const secondMessage = userMessages.nth(1)
      await secondMessage.hover()
      await secondMessage.locator('.message-rewind-btn').click()

      await expect.poll(() => fork.payload !== null).toBe(true)
      expect(fork.url).toContain('/sessions/')
      expect(fork.url).toContain('/fork')
      expect(fork.payload).toHaveProperty('turn_id', 'turn_002')
    })

    // SPEC: chat:rewind-fork
    test('successful fork navigates to new session', async ({ page }) => {
      await openSessionWithAPI(page, 'events/multi-turn.jsonl')

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
      await openSession(page, 'events/multi-turn.jsonl')

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
      await openSession(page, 'events/multi-turn.jsonl')

      await openSessionsPanel(page)

      // First expand button belongs to the parent, test-session-001.
      const expandBtn = page.locator('.sessions-expand-btn').first()
      await expect(expandBtn).toBeVisible()
    })

    // SPEC: chat:rewind-tree
    test('child sessions are indented', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
      await openSession(page, 'events/multi-turn.jsonl')

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
      await openSession(page, 'events/multi-turn.jsonl')

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
      // Delay keeps forking state visible before resolution.
      await mockSlowFork(page)
      await openSession(page, 'events/multi-turn.jsonl')
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
