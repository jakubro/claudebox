/** E2E tests for opening a new session from a link carrying its first message(s). */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_WORKSPACE_ID,
  mockAPI,
} from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

// Test-only stand-in for the real allowlist: messages starting with "/scope" are allowed.
const ALLOWED_PREFIX = '/scope'

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
        const allAllowed = messages.every(m => m.startsWith(ALLOWED_PREFIX))

        await route.fulfill({
          json: {
            session_id: DEFAULT_SESSION_ID,
            container_id: DEFAULT_CONTAINER_ID,
            name: null,
            undelivered_messages: allAllowed ? [] : messages,
          },
        })
      },
    },
  }).then(() => () => callCount)
}

test.describe('New Session From a Link', () => {
  test.beforeEach(async ({ page }) => {
    await mockSSE(page)
  })

  // SPEC: url:link-new-session
  test('opening a link submits its carried message as the session first turn', async ({ page }) => {
    const requests = []
    await mockNewSessionAllowlist(page, { onRequest: m => requests.push(m) })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/scope+claudebox`)
    await waitForAppReady(page)

    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)
    expect(requests).toEqual([['/scope claudebox']])
  })

  // SPEC: url:link-send-order
  test('a link carrying two allowed messages submits both in URL order', async ({ page }) => {
    const requests = []
    await mockNewSessionAllowlist(page, { onRequest: m => requests.push(m) })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/scope+first&send=/scope+second`)
    await waitForAppReady(page)

    await expect.poll(() => requests.length).toBeGreaterThan(0)
    expect(requests[0]).toEqual(['/scope first', '/scope second'])
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

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/scope+claudebox&send=/danger`)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue(
      '/scope claudebox\n\n/danger',
    )
  })

  // SPEC: url:link-consumed-once
  test('reloading the URL the link produced does not create a second session', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}?send=/scope+claudebox`)
    await waitForAppReady(page)
    await expect.poll(() => page.url()).toContain(`/sessions/${DEFAULT_SESSION_ID}`)
    await expect.poll(getCallCount).toBe(1)

    await page.reload()
    await waitForAppReady(page)

    expect(getCallCount()).toBe(1)
  })

  test('a link naming an unregistered workspace creates no session', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto('/#/workspaces/no-such-workspace?send=/scope+claudebox')
    await waitForAppReady(page)

    expect(getCallCount()).toBe(0)
  })

  test('carried text on a session URL is ignored', async ({ page }) => {
    const getCallCount = await mockNewSessionAllowlist(page)

    await page.goto(
      `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}?send=/scope+claudebox`,
    )
    await waitForAppReady(page)

    expect(getCallCount()).toBe(0)
  })
})
