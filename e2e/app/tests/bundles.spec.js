/** Session bundles: starting a session under one, and seeing which one a session started under. */

import { expect, test } from '@playwright/test'
import { captureSends, openSession, openSessionsPanel, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const WELCOME_URL = `/#/workspaces/${DEFAULT_WORKSPACE_ID}`

const TWO_BUNDLES = {
  bundle_names: ['research', 'ops'],
  bundles: {
    research: {
      declared: { model: 'claude-opus-5-5', effort_level: 'max' },
      keys: ['effort_level', 'env', 'model'],
    },
    ops: { declared: {}, keys: ['env', 'mounts'] },
  },
}

/** Serve the attached session's status from `current()`, so a test can change it mid-flight. */
function statusHandler(current) {
  return async route => {
    await route.fulfill({
      json: { ...loadFixture('status/default.json'), rate_limits: [], ...current() },
    })
  }
}

async function mockBundles(page) {
  const bodies = []
  await mockAPI(page, {
    sessionDefaults: TWO_BUNDLES,
    handlers: { newSession: recordingNewSession(bodies) },
  })

  return bodies
}

async function openResearchSession(page, status = {}) {
  await mockAPI(page, {
    sessionDefaults: TWO_BUNDLES,
    handlers: {
      getSessionStatus: statusHandler(() => ({
        bundle: 'research',
        model: 'claude-opus-5-5',
        effort_level: 'max',
        ...status,
      })),
    },
  })
  await openSession(page)
}

/** Record every create request body; answer with a fresh session in the default container. */
function recordingNewSession(bodies) {
  return async route => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      json: { session_id: 'new-session-id', container_id: DEFAULT_CONTAINER_ID, name: null },
    })
  }
}

/** Create under a bundle opening with `messages`; `gate`, when given, holds the answer until it resolves. */
async function mockOpeningBundle(page, messages, gate = null) {
  await mockAPI(page, {
    sessionDefaults: TWO_BUNDLES,
    handlers: {
      newSession: async route => {
        await gate
        await route.fulfill({
          json: {
            session_id: DEFAULT_SESSION_ID,
            container_id: DEFAULT_CONTAINER_ID,
            name: null,
            undelivered_messages: [],
            bundle_messages: messages,
          },
        })
      },
    },
  })
}

async function pickResearch(page) {
  await page.locator('[data-testid="footer-bundle-picker"]').click()
  await page.locator('[data-testid="bundle-dropdown"]').getByText('research').click()
}

async function menuRows(page) {
  return page.locator('.new-session-dropdown-portal .dropdown-option').allTextContents()
}

test.describe('Session bundles', () => {
  // SPEC: bundle:menu-rows
  test('both "+" menus list one row per bundle after a divider, in declaration order', async ({
    page,
  }) => {
    await mockAPI(page, { sessionDefaults: TWO_BUNDLES })
    await openSession(page)

    const expected = [
      'New session',
      'New session in new browser tab',
      'New session - research',
      'New session - ops',
    ]

    await page.locator('[data-testid="header-new-session-chevron"]').click()
    await expect(page.locator('.new-session-dropdown-divider')).toBeVisible()
    expect(await menuRows(page)).toEqual(expected)
    await page.keyboard.press('Escape')

    await openSessionsPanel(page)
    await page.locator('[data-testid="session-new-session-chevron"]').click()
    await expect(page.locator('.new-session-dropdown-divider')).toBeVisible()
    expect(await menuRows(page)).toEqual(expected)
  })

  // SPEC: bundle:menu-start
  test('a bundle row starts a session under that bundle', async ({ page }) => {
    const bodies = await mockBundles(page)
    await openSession(page)

    await page.locator('[data-testid="header-new-session-chevron"]').click()
    await page.locator('[data-testid="header-new-session-bundle-research"]').click()

    await expect.poll(() => bodies).toEqual([{ bundle: 'research' }])
  })

  // SPEC: bundle:welcome-picker
  // SPEC: container:welcome-input
  test('a bundle picked on the welcome screen shows at once and starts the next session', async ({
    page,
  }) => {
    const bodies = await mockBundles(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)

    const picker = page.locator('[data-testid="footer-bundle-picker"]')
    await expect(picker).toHaveText('No bundle')
    await picker.click()
    await page.locator('[data-testid="bundle-dropdown"]').getByText('research').click()
    await expect(picker).toHaveText('research')

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('Hello')
    await input.press('Enter')

    await expect.poll(() => bodies).toEqual([{ bundle: 'research' }])
  })

  // SPEC: bundle:opening-messages-queued
  test("a bundle's first opening message is sent and the rest wait in the queue", async ({
    page,
  }) => {
    await mockOpeningBundle(page, ['delta', 'echo'])
    const sends = await captureSends(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)

    await pickResearch(page)
    await page.locator('[data-testid="header-new-session-btn"]').click()

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['delta'])
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveText([/^echo/])
  })

  // SPEC: bundle:opening-messages-queued
  test("a message typed on the welcome screen goes first and the bundle's messages queue after it", async ({
    page,
  }) => {
    await mockOpeningBundle(page, ['delta', 'echo'])
    const sends = await captureSends(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)

    await pickResearch(page)
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('typed first')
    await input.press('Enter')

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['typed first'])
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveText([
      /^delta/,
      /^echo/,
    ])
  })

  // SPEC: bundle:opening-messages-queued
  test("a message sent while the session is created goes before the bundle's messages", async ({
    page,
  }) => {
    let answer
    const gate = new Promise(resolve => {
      answer = resolve
    })
    await mockOpeningBundle(page, ['delta', 'echo'], gate)
    const sends = await captureSends(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)

    await pickResearch(page)
    await page.locator('[data-testid="header-new-session-btn"]').click()
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('sent while creating')
    await input.press('Enter')
    answer()

    await expect.poll(() => sends.map(s => s.prompt)).toEqual(['sent while creating'])
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveText([
      /^delta/,
      /^echo/,
    ])
  })

  // SPEC: bundle:welcome-picker
  test('the "+" button starts the next session under the bundle picked on the welcome screen', async ({
    page,
  }) => {
    const bodies = await mockBundles(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)

    await page.locator('[data-testid="footer-bundle-picker"]').click()
    await page.locator('[data-testid="bundle-dropdown"]').getByText('research').click()
    await page.locator('[data-testid="header-new-session-btn"]').click()

    await expect.poll(() => bodies).toEqual([{ bundle: 'research' }])
  })

  // SPEC: bundle:none-declared
  test('a workspace declaring no bundles shows no rows, no picker and no bundle name', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(WELCOME_URL)
    await expect(page.locator('[data-testid="footer-model"]')).toBeVisible()
    await expect(page.locator('[data-testid="footer-bundle-picker"]')).toHaveCount(0)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="footer-bundle"]')).toHaveCount(0)

    await page.locator('[data-testid="header-new-session-chevron"]').click()
    expect(await menuRows(page)).toEqual(['New session', 'New session in new browser tab'])
    await expect(page.locator('.new-session-dropdown-divider')).toHaveCount(0)
  })

  // SPEC: bundle:pill
  // SPEC: bundle:pill-read-only
  test('a bundled session names its bundle in the footer, and clicking it opens nothing', async ({
    page,
  }) => {
    await openResearchSession(page)

    const pill = page.locator('[data-testid="footer-bundle"]')
    await expect(pill).toHaveText('research')
    await expect(page.locator('[data-testid="footer-bundle-picker"]')).toHaveCount(0)

    await pill.click()
    await expect(page.locator('.footer-picker-dropdown')).toHaveCount(0)
  })

  // SPEC: bundle:tooltip
  test('the bundle name lists what the bundle set', async ({ page }) => {
    await openResearchSession(page)

    await expect(page.locator('[data-testid="footer-bundle"]')).toHaveAttribute(
      'title',
      'Bundle — research\nmodel: claude-opus-5-5\neffort_level: max\nalso sets: env',
    )
  })

  // SPEC: bundle:drift
  test('the dot appears when a value the bundle set changes and clears when set back', async ({
    page,
  }) => {
    let model = 'claude-opus-5-5'
    await mockAPI(page, {
      sessionDefaults: TWO_BUNDLES,
      handlers: {
        getSessionStatus: statusHandler(() => ({ bundle: 'research', model, effort_level: 'max' })),
      },
    })
    await mockSSE(page)
    await page.route('**/api/model*', async route => {
      model = route.request().postDataJSON().model
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const dot = page.locator('[data-testid="footer-bundle-drift"]')
    await expect(page.locator('[data-testid="footer-bundle"]')).toBeVisible()
    await expect(dot).toHaveCount(0)

    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Sonnet 5').click()
    await expect(dot).toBeVisible()

    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Opus 5.5').click()
    await expect(dot).toHaveCount(0)
  })

  // SPEC: bundle:drift-from-welcome
  test('a model picked on the welcome screen over the bundle shows the dot from the start', async ({
    page,
  }) => {
    let attached = false
    await mockAPI(page, {
      sessionDefaults: TWO_BUNDLES,
      handlers: {
        newSession: async route => {
          attached = true
          await route.fulfill({
            status: 200,
            json: {
              session_id: 'new-session-id',
              container_id: DEFAULT_CONTAINER_ID,
              bundle: 'research',
              model: 'claude-opus-5-5',
              effort_level: 'max',
            },
          })
        },
        getSessionStatus: statusHandler(() => ({
          session_id: 'new-session-id',
          bundle: 'research',
          model: attached ? 'claude-sonnet-5' : 'claude-opus-5-5',
          effort_level: 'max',
        })),
      },
    })
    await mockSSE(page)
    await page.route('**/api/model*', route =>
      route.fulfill({ status: 200, body: 'null', contentType: 'application/json' }),
    )
    await page.goto(WELCOME_URL)

    await page.locator('[data-testid="footer-bundle-picker"]').click()
    await page.locator('[data-testid="bundle-dropdown"]').getByText('research').click()
    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Sonnet 5').click()

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('Hello')
    await input.press('Enter')

    await expect(page.locator('[data-testid="footer-bundle"]')).toContainText('research')
    await expect(page.locator('[data-testid="footer-bundle-drift"]')).toBeVisible()
  })

  // SPEC: bundle:no-drift-possible
  test('a bundle that set nothing a session can change never shows the dot', async ({ page }) => {
    await mockAPI(page, {
      sessionDefaults: TWO_BUNDLES,
      handlers: {
        getSessionStatus: statusHandler(() => ({ bundle: 'ops', model: 'claude-sonnet-5' })),
      },
    })
    await openSession(page)

    await expect(page.locator('[data-testid="footer-bundle"]')).toHaveText('ops')
    await expect(page.locator('[data-testid="footer-bundle-drift"]')).toHaveCount(0)
  })

  // SPEC: bundle:side-thread
  test('a side thread opened on its own shows the bundle it came from', async ({ page }) => {
    await openResearchSession(page, { is_side_thread: true, parent_session_id: 'parent-session' })

    await expect(page.locator('[data-testid="footer-bundle"]')).toHaveText('research')
    await expect(page.locator('[data-testid="footer-bundle-picker"]')).toHaveCount(0)
  })
})
