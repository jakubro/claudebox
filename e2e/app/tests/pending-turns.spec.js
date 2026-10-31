/** E2E tests for pending turn functionality. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openLiveSessionWithAPI, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

test.describe('Pending Turns', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Pending Message Display', () => {
    // SPEC: turn:pending-show
    test('shows pending message immediately after send', async ({ page }) => {
      await openLiveSession(page)
      const input = await waitForAppReady(page)

      await input.fill('Test pending message')
      await input.press('Enter')

      // Pending message should appear immediately (before SSE confirmation)
      await expect(page.getByText('Test pending message')).toBeVisible()

      await expect(page.locator('.turn-container.pending')).toBeVisible()
    })

    // SPEC: turn:pending-remove
    test('pending message removed when SSE confirms', async ({ page }) => {
      const controller = await openLiveSession(page)
      const input = await waitForAppReady(page)

      await input.fill('Confirm this message')
      await input.press('Enter')

      await expect(page.locator('.turn-container.pending')).toBeVisible()

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Confirm this message',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
      ])

      // Pending should be removed (replaced by real message)
      await expect(page.locator('.turn-container.pending')).not.toBeVisible()
      await expect(page.getByText('Confirm this message')).toBeVisible()
    })

    // SPEC: turn:pending-no-duplicate
    test('no duplicate pending messages on rapid send attempts', async ({ page }) => {
      await openLiveSession(page)
      const input = await waitForAppReady(page)

      await input.fill('Test message')
      await input.press('Enter')
      // Input is cleared after the first Enter, so the second should not send again.
      await input.press('Enter')

      await expect
        .poll(() => page.locator('.turn-container.pending').count())
        .toBeLessThanOrEqual(1)
    })
  })

  test.describe('Session Scoping', () => {
    // SPEC: chat:pending-session-scoped
    test('pending messages clear when switching to another session', async ({ page }) => {
      // Single-session mode switches sessions via SessionsPanel resume click or URL navigation, not an in-app tab.
      const controller = await openLiveSessionWithAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: async route => {
            await route.fulfill({
              json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
            })
          },
        },
      })

      // Send SSE events so the session is active (not resuming)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Earlier message',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Response',
          timestamp: Date.now() + 100,
        },
      ])

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Pending in session 1')
      await input.press('Enter')

      await expect(page.locator('.turn-container.pending')).toBeVisible()

      // URL hash change is the single-session-mode replacement for the in-app tab click.
      await page.evaluate(wsId => {
        window.location.hash = `#/workspaces/${wsId}/sessions/test-session-002`
      }, DEFAULT_WORKSPACE_ID)

      // Pending message from old session should no longer be visible
      await expect(page.locator('.turn-container.pending')).not.toBeVisible()
    })

    // SPEC: chat:pending-session-scoped
    // SPEC: chat:pending-no-foreign-stop
    test('a message waiting in A never shows or arms Stop in B once B has loaded', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      const interrupts = []
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: async route => {
            await route.fulfill({
              json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
            })
          },
          interrupt: async route => {
            interrupts.push(route.request().url())
            await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // A is mid-turn, so the message sent now stays unechoed.
      await controller.sendEvents([
        { type: 'user', subtype: 'text', content: 'Go', is_human: true, turn_id: 'turn_001' },
        { type: 'assistant', subtype: 'text', content: 'Working', turn_id: 'turn_001' },
      ])
      await input.fill('typed in A')
      await input.press('Enter')
      await expect(page.locator('.turn-container.pending')).toBeVisible()

      await page.evaluate(wsId => {
        window.location.hash = `#/workspaces/${wsId}/sessions/test-session-002`
      }, DEFAULT_WORKSPACE_ID)
      await expect.poll(() => page.evaluate(() => window.__sseConnectionCount)).toBeGreaterThan(1)
      await controller.sendEvents([
        { type: 'system', subtype: 'replay_started', count: 0 },
        { type: 'system', subtype: 'replay_ended' },
      ])
      await expect(page.locator('.chat-replay-overlay')).not.toBeVisible()

      await expect(page.locator('.turn-container.pending')).toHaveCount(0)
      await page.locator('[data-testid="chat-input"]').press('Control+Period')
      await expect
        .poll(() => interrupts.length, { timeout: 1000, message: 'Stop reached the session' })
        .toBe(0)
    })

    // SPEC: chat:first-message-own-session
    test("a new session's first message is not sent into a session opened before it connects", async ({
      page,
    }) => {
      // Streams connect only when told to, so the new session is left waiting to connect.
      const controller = await createSSEController(page, { autoConnect: false })
      const sends = []
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          newSession: async route => {
            await route.fulfill({
              json: { session_id: 'created-c', container_id: DEFAULT_CONTAINER_ID, name: null },
            })
          },
          resumeSession: async route => {
            await route.fulfill({
              json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
            })
          },
          send: async route => {
            sends.push(route.request().url())
            await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
          },
        },
      })
      await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
      await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('first message for C')
      await input.press('Enter')
      await expect.poll(() => page.url()).toContain('created-c')

      // The reader opens B before the new session's stream connects; B's stream connects first.
      await page.evaluate(wsId => {
        window.location.hash = `#/workspaces/${wsId}/sessions/test-session-002`
      }, DEFAULT_WORKSPACE_ID)
      await expect.poll(() => controller.hasChatStreamFor('test-session-002')).toBe(true)
      // B's own settings are read once its data has attached - the moment the message would go out.
      const bAttached = page.waitForRequest(/ui-state\?session_id=test-session-002/)
      await controller.connectSession('test-session-002')
      await bAttached

      await expect
        .poll(() => sends.filter(url => url.includes('test-session-002')), {
          timeout: 2000,
          message: 'the first message went to B',
        })
        .toEqual([])
    })

    // SPEC: chat:first-message-failed-queued
    test('a first message that fails to send while its session opens leaves no working turn', async ({
      page,
    }) => {
      const controller = await createSSEController(page, { autoConnect: false })
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            await route.fulfill({
              json: { session_id: 'created-c', container_id: DEFAULT_CONTAINER_ID, name: null },
            })
          },
          send: route => route.fulfill({ status: 500, body: 'refused' }),
        },
      })
      await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
      await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('say hi')
      await input.press('Enter')
      await expect.poll(() => page.url()).toContain('created-c')
      await expect.poll(() => controller.hasChatStreamFor('created-c')).toBe(true)
      await controller.connectSession('created-c')

      await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveClass(/paused/)
      await page.waitForTimeout(2000)
      await expect(page.locator('.turn-container.pending')).toHaveCount(0)
    })
  })
})
