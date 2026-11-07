/** E2E tests for opening a new session from a link carrying its first message(s). */

import { expect, test } from '@playwright/test'
import { captureSends, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_WORKSPACE_ID,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

// Test-only stand-in for the real allowlist: messages starting with "/greet" are allowed.
const ALLOWED_PREFIX = '/greet'

/** Mock POST /sessions/new under the same all-or-nothing contract the daemon enforces. */
function mockNewSessionAllowlist(page, { onRequest } = {}) {
  let callCount = 0

  return mockAPI(page, {
    handlers: {
      newSession: async route => {
        callCount++
        const body = route.request().postDataJSON()
        const messages = body?.messages ?? []
        onRequest?.(messages)
        const survivors = messages.filter(m => m.trim())
        const allAllowed = survivors.every(m => m.startsWith(ALLOWED_PREFIX))

        await route.fulfill({
          json: {
            session_id: DEFAULT_SESSION_ID,
            container_id: DEFAULT_CONTAINER_ID,
            name: null,
            undelivered_messages: allAllowed ? [] : survivors,
            bundle_messages: [],
          },
        })
      },
    },
  }).then(() => () => callCount)
}

/** The stream's echo of `prompt` and the end of its reply, as the agent sends them. */
function answered(prompt) {
  const ts = Date.now()
  return [
    {
      type: 'user',
      subtype: 'text',
      content: prompt,
      is_human: true,
      turn_id: 'turn_link_1',
      timestamp: ts,
    },
    {
      type: 'assistant',
      subtype: 'text',
      content: 'ok',
      turn_id: 'turn_link_1',
      timestamp: ts + 50,
    },
    { type: 'result', subtype: 'success', turn_id: 'turn_link_1', timestamp: ts + 100 },
  ]
}

test.describe('New Session From a Link', () => {
  test.beforeEach(async ({ page }) => {
    await mockSSE(page)
  })

  // SPEC: url:link-new-session
  test('opening a link sends its carried message as the session first message', async ({
    page,
  }) => {
    const requests = []
    await mockNewSessionAllowlist(page, { onRequest: m => requests.push(m) })
    const sends = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+ada`)
    await waitForAppReady(page)

    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)
    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet ada'])
    expect(requests).toEqual([['/greet ada']])
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveCount(0)
  })

  // SPEC: url:link-send-order
  test('a link carrying two allowed messages sends them in URL order, each on its own', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await mockNewSessionAllowlist(page)
    const sends = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+first&send=/greet+second`)
    await waitForAppReady(page)

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet first'])
    await controller.sendEvents(answered('/greet first'))
    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet first', '/greet second'])
  })

  // SPEC: url:link-queued
  test('every carried message after the first waits in the queue with its controls', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await mockNewSessionAllowlist(page)
    const sends = await captureSends(page)

    await page.goto(
      `/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+a&send=/greet+b&send=/greet+c`,
    )
    await waitForAppReady(page)

    const bubbles = page.locator('[data-testid="queued-message-bubble"]')
    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet a'])
    await expect(bubbles).toHaveText([/^\/greet b/, /^\/greet c/])
    for (const title of ['Send now', 'Edit', 'Cancel']) {
      await expect(bubbles.locator(`button[title="${title}"]`)).toHaveCount(2)
    }

    await page.reload()
    await waitForAppReady(page)
    await expect(bubbles).toHaveText([/^\/greet b/, /^\/greet c/])
    expect(sends.map(s => s.prompt)).toEqual(['/greet a'])

    await controller.sendEvents(answered('/greet a'))
    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet a', '/greet b'])
    await expect(bubbles).toHaveText([/^\/greet c/])
  })

  // SPEC: url:link-queued
  test('interrupting the first reply pauses the carried messages waiting behind it', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await mockNewSessionAllowlist(page)
    const sends = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+a&send=/greet+b`)
    await waitForAppReady(page)
    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet a'])
    const [echo, reply] = answered('/greet a')
    await controller.sendEvents([echo, reply])

    await page.locator('[data-testid="chat-input"]').press('Control+.')

    const bubble = page.locator('[data-testid="queued-message-bubble"]')
    await expect(bubble).toHaveClass(/paused/)
    await expect(bubble.locator('button[title="Re-queue"]')).toHaveCount(1)
    await expect(bubble.locator('button[title="Cancel"]')).toHaveCount(1)
  })

  // SPEC: url:link-allowlist-multiline
  test('a link carrying a multi-line message sends it whole and submits it', async ({ page }) => {
    const requests = []
    await mockNewSessionAllowlist(page, { onRequest: m => requests.push(m) })

    await page.goto(
      `/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=${encodeURIComponent('/greet ada\nand a second line')}`,
    )
    await waitForAppReady(page)

    await expect.poll(() => requests.length).toBeGreaterThan(0)
    expect(requests[0]).toEqual(['/greet ada\nand a second line'])
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('')
  })

  // SPEC: url:link-empty-skipped
  test('a link carrying only an empty message opens a session that sends nothing', async ({
    page,
  }) => {
    const requests = []
    await mockNewSessionAllowlist(page, { onRequest: m => requests.push(m) })
    const sends = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=`)
    const input = await waitForAppReady(page)
    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)

    await input.fill('/greet typed')
    await input.press('Enter')

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet typed'])
    expect(requests).toEqual([[]])
  })

  // SPEC: url:link-empty-skipped
  test('an empty message ahead of carried text is skipped, so the text goes first', async ({
    page,
  }) => {
    await mockNewSessionAllowlist(page)
    const sends = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=&send=/greet+ada`)
    await waitForAppReady(page)

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['/greet ada'])
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveCount(0)
  })

  // SPEC: url:link-allowlist
  // SPEC: url:link-blocked-to-input
  test('a link carrying a disallowed message creates the session but submits nothing', async ({
    page,
  }) => {
    await mockNewSessionAllowlist(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/danger`)
    await waitForAppReady(page)

    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('/danger')
    await expect(page.locator('.footer-error-text')).toContainText(
      'Message not allowed by workspace settings',
    )
  })

  test('one disallowed message in a sequence blocks the whole sequence, in order', async ({
    page,
  }) => {
    await mockNewSessionAllowlist(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+ada&send=/danger`)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('/greet ada\n\n/danger')
  })

  // SPEC: url:link-consumed-once
  test('reloading the URL the link produced does not create a second session', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/greet+ada`)
    await waitForAppReady(page)
    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)
    await expect.poll(getCallCount).toBe(1)

    await page.reload()
    await waitForAppReady(page)

    expect(getCallCount()).toBe(1)
  })

  // SPEC: url:link-unregistered-workspace
  test('a link naming an unregistered workspace creates no session', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto('/#/workspaces/no-such-workspace?send=/greet+ada')
    await waitForAppReady(page)

    expect(getCallCount()).toBe(0)
  })

  test('carried text on a session URL is ignored', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto(
      `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}?send=/greet+ada`,
    )
    await waitForAppReady(page)

    expect(getCallCount()).toBe(0)
  })
})
