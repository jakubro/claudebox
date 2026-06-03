/** E2E tests for message queue functionality. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, loadFixture, mockAPI } from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

test.describe('Message Queue', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Queue Send', () => {
    // SPEC: input:queue-send
    test('Alt+Enter queues message as dimmed bubble', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('queued message')
      await input.press('Alt+Enter')

      // Queued bubble should appear
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()
      await expect(page.getByText('queued message')).toBeVisible()

      // Input should be cleared
      await expect(input).toHaveValue('')
    })

    // SPEC: chat:queue-bubble
    test('queued messages appear as dimmed inline bubbles', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('first queued')
      await input.press('Alt+Enter')
      await input.fill('second queued')
      await input.press('Alt+Enter')

      // Both queued bubbles visible
      const bubbles = page.locator('[data-testid="queued-message-bubble"]')
      await expect(bubbles).toHaveCount(2)
      await expect(page.getByText('first queued')).toBeVisible()
      await expect(page.getByText('second queued')).toBeVisible()

      // Bubbles have dimmed styling
      const bubble = bubbles.first()
      await expect(bubble).toHaveClass(/queued-message-bubble/)
    })
  })

  test.describe('Queue Actions', () => {
    // SPEC: chat:queue-actions
    test('queued bubbles show edit and cancel on hover', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('hoverable message')
      await input.press('Alt+Enter')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()

      await expect(bubble.locator('button[title="Edit"]')).toBeVisible()
      await expect(bubble.locator('button[title="Cancel"]')).toBeVisible()
    })

    // SPEC: chat:queue-cancel
    test('cancel removes message from queue', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('cancel me')
      await input.press('Alt+Enter')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()
      await bubble.locator('button[title="Cancel"]').click()

      await expect(bubble).not.toBeVisible()
    })

    // SPEC: chat:queue-edit
    test('edit returns message content to input', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('edit me')
      await input.press('Alt+Enter')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()
      await bubble.locator('button[title="Edit"]').click()

      // Bubble removed from queue
      await expect(bubble).not.toBeVisible()

      // Content loaded into textarea
      await expect(input).toHaveValue('edit me')
    })
  })

  test.describe('Queue Drain', () => {
    // SPEC: chat:queue-drain
    test('queued message auto-sends when response completes', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Simulate Claude responding
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'first message',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 100,
        },
      ])

      // Queue a message while Claude is responding
      await input.fill('queued follow-up')
      await input.press('Alt+Enter')

      // Queued bubble should be visible
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()

      // Complete response cycle
      await controller.sendEvents([
        { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
      ])

      // Queued bubble should be consumed (auto-sent)
      await expect(page.locator('[data-testid="queued-message-bubble"]')).not.toBeVisible({
        timeout: 5000,
      })
    })
  })

  test.describe('Queue Bypass', () => {
    // SPEC: chat:queue-bypass
    test('Enter sends immediately even with queued messages', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Queue a message
      await input.fill('queued first')
      await input.press('Alt+Enter')

      // Send another immediately with Enter
      await input.fill('immediate send')
      await input.press('Enter')

      // Queued bubble should still be present
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()

      // Immediate message should appear as pending turn
      await expect(page.getByText('immediate send')).toBeVisible()
    })
  })

  test.describe('Queue Pause', () => {
    // SPEC: chat:queue-pause-interrupt
    test('interrupt pauses queued messages', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Start a response so interrupt is available
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'trigger response',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_002',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Responding...',
          timestamp: Date.now() + 100,
        },
      ])

      // Queue a message
      await input.fill('will be paused')
      await input.press('Alt+Enter')

      // Interrupt
      await input.press('Control+.')

      // Queued bubble should still exist but be paused
      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await expect(bubble).toBeVisible()
      await expect(bubble).toHaveClass(/paused/)
    })

    // SPEC: chat:queue-pause-actions
    test('paused bubbles show re-queue and cancel buttons', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Start response, queue message, then interrupt
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'msg',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_003',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      await input.fill('paused msg')
      await input.press('Alt+Enter')
      await input.press('Control+.')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()

      await expect(bubble.locator('button[title="Re-queue"]')).toBeVisible()
      await expect(bubble.locator('button[title="Cancel"]')).toBeVisible()
    })

    // SPEC: chat:queue-pause-error
    test('error pauses queued messages', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('will pause on error')
      await input.press('Alt+Enter')

      // Override send to return error (triggers setError → pauseAll)
      await page.route('**/api/send', route =>
        route.fulfill({ status: 500, json: { error: 'Server error' } }),
      )

      await input.fill('trigger error')
      await input.press('Enter')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await expect(bubble).toBeVisible()
      await expect(bubble).toHaveClass(/paused/)
    })

    // SPEC: chat:queue-requeue
    test('re-queue returns paused message to active queue', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Start response, queue, interrupt
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'msg',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_004',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      await input.fill('requeue me')
      await input.press('Alt+Enter')
      await input.press('Control+.')

      // Bubble should be paused
      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await expect(bubble).toHaveClass(/paused/)

      // Click re-queue
      await bubble.hover()
      await bubble.locator('button[title="Re-queue"]').click()

      // Bubble should no longer be paused
      await expect(bubble).not.toHaveClass(/paused/)
    })
  })

  test.describe('Queue Send Now', () => {
    // SPEC: chat:queue-send-now
    test('send now button sends message immediately, skipping queue order', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Queue three messages
      await input.fill('first queued')
      await input.press('Alt+Enter')
      await input.fill('second queued')
      await input.press('Alt+Enter')
      await input.fill('third queued')
      await input.press('Alt+Enter')

      const bubbles = page.locator('[data-testid="queued-message-bubble"]')
      await expect(bubbles).toHaveCount(3)

      // Hover the second bubble and click "Send now"
      const secondBubble = bubbles.nth(1)
      await secondBubble.hover()
      await expect(secondBubble.locator('button[title="Send now"]')).toBeVisible()
      await secondBubble.locator('button[title="Send now"]').click()

      // Second bubble removed, first and third remain
      await expect(bubbles).toHaveCount(2)
      await expect(page.getByText('first queued')).toBeVisible()
      await expect(page.getByText('third queued')).toBeVisible()
    })

    // SPEC: chat:queue-actions
    test('queued bubbles show send-now, edit, and cancel on hover', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('hover me')
      await input.press('Alt+Enter')

      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()

      await expect(bubble.locator('button[title="Send now"]')).toBeVisible()
      await expect(bubble.locator('button[title="Edit"]')).toBeVisible()
      await expect(bubble.locator('button[title="Cancel"]')).toBeVisible()
    })
  })

  test.describe('Queue Persistence', () => {
    // SPEC: chat:queue-persist
    test('queued messages survive page refresh', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('survives refresh')
      await input.press('Alt+Enter')
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()

      // Refresh the page
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Queued bubble should reappear from localStorage
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()
      await expect(page.getByText('survives refresh')).toBeVisible()
    })
  })

  test.describe('Queue Lifecycle', () => {
    // SPEC: chat:queue-session-clear
    test('session switch clears queued messages', async ({ page }) => {
      // Override session routes so sessionId actually changes on new session (LIFO wins)
      const statusFixture = loadFixture('status/default.json')
      let currentSessionId = statusFixture.session_id
      await page.route('**/api/sessions/current', async route => {
        await route.fulfill({ json: { ...statusFixture, session_id: currentSessionId } })
      })
      await page.route('**/sessions/new', async route => {
        currentSessionId = 'new-session-id'
        await route.fulfill({ json: { session_id: 'new-session-id' } })
      })

      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('will be cleared')
      await input.press('Alt+Enter')
      await expect(page.locator('[data-testid="queued-message-bubble"]')).toBeVisible()

      // Create new session (triggers session switch → clearAll)
      await page.locator('[data-testid="header-new-session-btn"]').click()

      await expect(page.locator('[data-testid="queued-message-bubble"]')).not.toBeVisible()
    })

    // SPEC: chat:queue-attachments
    test('queued messages preserve attachments through edit', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Add attachment via drop
      await page.evaluate(() => {
        const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const wrapper = document.querySelector('.chat-input-wrapper')
        wrapper.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }))
        wrapper.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
      })

      // Wait for attachment to process
      await expect(page.locator('[data-testid="attachment-preview"]')).toBeVisible()

      // Queue message with attachment
      await input.fill('message with attachment')
      await input.press('Alt+Enter')

      // Attachment preview should clear from input
      await expect(page.locator('[data-testid="attachment-preview"]')).not.toBeVisible()

      // Edit the queued bubble
      const bubble = page.locator('[data-testid="queued-message-bubble"]')
      await bubble.hover()
      await bubble.locator('button[title="Edit"]').click()

      // Attachment should reappear in input
      await expect(page.locator('[data-testid="attachment-preview"]')).toBeVisible()
      await expect(input).toHaveValue('message with attachment')
    })
  })
})
