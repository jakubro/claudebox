/** Shared E2E test helpers. */

import { expect } from '@playwright/test'
import { PINS_CHANGE_SIGNAL_KEY } from '../../src/claudebox_frontend/src/config/storage.js'
import { SCROLL_SETTLE_STILL_FRAMES } from '../../src/claudebox_frontend/src/config/timing.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
} from './mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from './mocks/sse.js'

const READY_TIMEOUT_MS = 15000

/**
 * Wait for app to be ready and return the input locator.
 *
 * Font loading is awaited too - without it, element heights vary by a few pixels between
 * runs, which breaks visual regression stability.
 */
export async function waitForAppReady(page) {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('[data-testid="footer"]')).toBeVisible({ timeout: READY_TIMEOUT_MS })
  await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project', {
    timeout: READY_TIMEOUT_MS,
  })
  await waitForShortcutsReady(page)

  const input = page.locator('[data-testid="chat-input"]')
  await expect(input).toBeEnabled()

  await page.evaluate(() => document.fonts.ready)

  return input
}

export async function openSession(page, events) {
  if (Array.isArray(events)) {
    await mockSSEDynamic(page, () => events)
  } else {
    await mockSSE(page, events)
  }
  await page.goto(DEFAULT_SESSION_URL)

  return waitForAppReady(page)
}

export async function openWithDraft(page, text) {
  const input = await openSession(page)
  await input.fill(text)

  return input
}

export async function captureSends(page) {
  const sends = []
  await page.route('**/api/send*', async route => {
    sends.push(await route.request().postDataJSON())
    await route.fulfill({ status: 200, json: { success: true } })
  })

  return sends
}

export async function captureLastSend(page) {
  const sent = { payload: null }
  await page.route('**/api/send*', async route => {
    sent.payload = await route.request().postDataJSON()
    await route.fulfill({ status: 200, json: { success: true } })
  })

  return sent
}

export async function acceptSends(page) {
  await page.route('**/api/send*', async route => {
    await route.fulfill({ status: 200, json: { success: true } })
  })
}

export function sessionsHandler(sessions) {
  return async route => {
    await route.fulfill({ json: { sessions } })
  }
}

export async function serveSessionList(page, sessionsFrom, workspaceId = DEFAULT_WORKSPACE_ID) {
  await page.route(`**/api/workspaces/${workspaceId}/sessions`, async route => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const base = loadFixture('sessions/default.json').sessions[0]
    await route.fulfill({ json: { sessions: sessionsFrom(base) } })
  })
}

export async function resumeNamedSession(route) {
  const [, sessionId] = route
    .request()
    .url()
    .match(/\/sessions\/([^/]+)\/resume/)
  await route.fulfill({ json: { session_id: sessionId, container_id: DEFAULT_CONTAINER_ID } })
}

export async function openLiveSessionWithAPI(page, apiOptions) {
  // Controller must be created BEFORE mockAPI so addInitScript runs first
  const controller = await createSSEController(page)
  await mockAPI(page, apiOptions)
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)

  return controller
}

export async function sendAtFixedTime(page, content) {
  const sent = Date.parse('2026-03-01T12:00:00Z')
  await page.clock.setFixedTime(sent)
  const controller = await openLiveSessionWithAPI(page)
  await expect(page.getByTestId('footer-status')).toHaveAttribute('data-status', 'ready')
  const input = page.locator('[data-testid="chat-input"]')
  await input.fill(content)
  await input.press('Enter')
  const at = ms => ({ timestamp: sent + ms, ts: new Date(sent + ms).toISOString() })

  return { controller, sent, at }
}

export async function openSessionWithAPI(page, events, apiOptions) {
  await mockAPI(page, apiOptions)

  return openSession(page, events)
}

export async function openWithNoSession(page, events) {
  await mockAPI(page, {
    handlers: {
      getSessionStatus: async route => {
        await route.fulfill({ json: { session_id: null, workspace: '/home/user/project' } })
      },
    },
  })

  return openSession(page, events)
}

export async function openResumingSession(page) {
  await mockSSE(page, 'events/resuming.jsonl')
  await page.goto(DEFAULT_SESSION_URL)
  // Footer indicates app ready without depending on chat input.
  await expect(page.locator('[data-testid="footer"]')).toBeVisible()
}

export async function openLiveSession(page) {
  const controller = await createSSEController(page)
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)

  return controller
}

export async function sendFinishedTurn(controller, reply) {
  await controller.sendEvents([
    {
      type: 'user',
      subtype: 'text',
      content: 'Hello',
      is_human: true,
      timestamp: Date.now(),
      turn_id: 'turn_001',
    },
    { type: 'assistant', subtype: 'text', content: reply, timestamp: Date.now() + 100 },
    { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
  ])
}

export async function openRunningTask(page, taskId) {
  const controller = await openLiveSession(page)
  await controller.sendEvents([
    {
      type: 'user',
      subtype: 'text',
      is_human: true,
      content: 'Investigate the flaky test',
      timestamp: Date.now(),
      ts: new Date().toISOString(),
      turn_id: 'turn_001',
    },
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      ts: new Date().toISOString(),
      tool_use_id: taskId,
      tool_name: 'Task',
      tool_input: {
        description: 'Investigate',
        prompt: 'Find the flaky test.',
        subagent_type: 'Explore',
      },
    },
  ])

  return controller
}

/**
 * Wait until a global keyboard shortcut will actually be received.
 *
 * Anything that paints (footer included) is a poor proxy: the app shell attaches its keydown
 * listener after paint, in a gap that widens on a loaded machine. A press landing there is
 * dropped silently with no retry, burning the whole budget on a panel that never opens.
 * Call this before any `page.keyboard.press` of a global shortcut.
 */
export async function waitForShortcutsReady(page) {
  await page.waitForSelector('body[data-shortcuts-ready="true"]', { timeout: READY_TIMEOUT_MS })
}

/**
 * Turn off auto-collapse (idempotent) so every turn renders expanded.
 *
 * Auto-collapse defaults on and collapses all turns except the last; tests that
 * assert on content inside earlier turns disable it first to see full turns.
 */
export async function disableAutoCollapse(page) {
  const toggle = page.locator('[data-testid="autocollapse-toggle"]')
  if ((await toggle.getAttribute('aria-pressed')) === 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
}

/** Wait for mobile layout to be ready and return the input locator. */
export async function waitForMobileReady(page) {
  await expect(page.locator('.mobile-layout')).toBeVisible()
  await expect(page.locator('.mobile-top-bar')).toBeVisible()

  const input = page.locator('[data-testid="chat-input"]')
  await expect(input).toBeEnabled()

  await page.evaluate(() => document.fonts.ready)

  return input
}

const PANELS = {
  sessions: { button: '[data-testid="icon-sessions"]', content: '.sessions-panel' },
  todos: { button: '[data-testid="icon-todos"]', content: '.todos-panel' },
  stash: { button: '[data-testid="icon-stash"]', content: '.stash-panel' },
  tasks: { button: '[data-testid="icon-tasks"]', content: '.tasks-panel' },
  crons: { button: '[data-testid="icon-crons"]', content: '.crons-panel' },
  bookmarks: { button: '[data-testid="icon-bookmarks"]', content: '.bookmarks-panel' },
  boards: { button: '[data-testid="icon-boards"]', content: '.boards-panel' },
  usage: { button: '[data-testid="icon-usage"]', content: '.usage-panel' },
  mcp: { button: '[data-testid="icon-mcp"]', content: '.mcp-panel' },
  commands: { button: '[data-testid="icon-commands"]', content: '.skills-panel' },
  help: { button: '[data-testid="icon-help"]', content: '.help-panel' },
  logs: { button: '[data-testid="icon-logs"]', content: '.logs-panel' },
}

/** Toggle panel (always clicks button). */
async function togglePanel(page, panel) {
  await page.locator(panel.button).click()
}

/** Open panel if not already visible. */
async function openPanel(page, panel) {
  const content = page.locator(panel.content)
  // If not already attached, click to open before asserting visibility
  try {
    await content.waitFor({ state: 'attached', timeout: 500 })
  } catch {
    await page.locator(panel.button).click()
  }
  await expect(content).toBeVisible()
}

/** Toggle sessions panel visibility. */
export const toggleSessionsPanel = page => togglePanel(page, PANELS.sessions)
/** Toggle todos panel visibility. */
export const toggleTodosPanel = page => togglePanel(page, PANELS.todos)
/** Toggle stash panel visibility. */
export const toggleStashPanel = page => togglePanel(page, PANELS.stash)

/** Open sessions panel if not visible. */
export const openSessionsPanel = page => openPanel(page, PANELS.sessions)
/** Open boards panel if not visible. */
export const openBoardsPanel = page => openPanel(page, PANELS.boards)

/** Open todos panel if not visible. */
export const openTodosPanel = page => openPanel(page, PANELS.todos)
/** Open stash panel if not visible. */
export const openStashPanel = page => openPanel(page, PANELS.stash)
/** Open tasks panel if not visible. */
export const openTasksPanel = page => openPanel(page, PANELS.tasks)
/** Open usage panel if not visible. */
export const openUsagePanel = page => openPanel(page, PANELS.usage)
/** Open help panel if not visible. */
export const openHelpPanel = page => openPanel(page, PANELS.help)
/** Open logs panel if not visible. */
export const openLogsPanel = page => openPanel(page, PANELS.logs)
/** Toggle logs panel visibility. */
export const toggleLogsPanel = page => togglePanel(page, PANELS.logs)
/** Open bookmarks panel if not visible. */
export const openBookmarksPanel = page => openPanel(page, PANELS.bookmarks)
/** Open commands panel if not visible. */
export const openSkillsPanel = page => openPanel(page, PANELS.commands)

/**
 * Close every dockable side panel that is currently open.
 *
 * State-aware (checks visibility before clicking) rather than blind toggling, so the end
 * state is deterministic regardless of the layout's default-open set.
 */
export async function closeAllSidePanels(page) {
  for (const panel of Object.values(PANELS)) {
    const content = page.locator(panel.content).first()
    if (await content.isVisible().catch(() => false)) {
      await page.locator(panel.button).click()
      await page.waitForTimeout(50)
    }
  }
}

/**
 * Extract RGB channels from a computed CSS color property, polling until it settles - a
 * `toBeVisible()` check does not prove a class-driven color has been computed for that frame.
 */
async function parseComputedColor(locator, cssProp) {
  let color = ''
  await expect
    .poll(async () => {
      color = await locator.evaluate((el, prop) => getComputedStyle(el)[prop], cssProp)
      return color
    })
    .toMatch(/rgba?\(\d+,\s*\d+,\s*\d+/)

  const [, r, g, b] = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/).map(Number)
  return { r, g, b }
}

/**
 * Assert a CSS color property matches expected RGB channels within tolerance.
 *
 * @param {string} cssProp - CSS property name (e.g. 'color', 'borderLeftColor', 'backgroundColor')
 * @param {object} expected - Expected RGB channels: {r, g, b} (0-255)
 */
export async function assertColor(locator, cssProp, expected, tolerance = 50) {
  const { r, g, b } = await parseComputedColor(locator, cssProp)
  if (expected.r !== undefined) {
    expect(r, `Red channel: expected ~${expected.r}±${tolerance}, got ${r}`).toBeGreaterThanOrEqual(
      expected.r - tolerance,
    )
    expect(r).toBeLessThanOrEqual(expected.r + tolerance)
  }
  if (expected.g !== undefined) {
    expect(
      g,
      `Green channel: expected ~${expected.g}±${tolerance}, got ${g}`,
    ).toBeGreaterThanOrEqual(expected.g - tolerance)
    expect(g).toBeLessThanOrEqual(expected.g + tolerance)
  }
  if (expected.b !== undefined) {
    expect(
      b,
      `Blue channel: expected ~${expected.b}±${tolerance}, got ${b}`,
    ).toBeGreaterThanOrEqual(expected.b - tolerance)
    expect(b).toBeLessThanOrEqual(expected.b + tolerance)
  }
}

/** Assert a color is red-dominant (high red, low green, low blue). */
export async function assertRedColor(locator, cssProp) {
  const { r, g, b } = await parseComputedColor(locator, cssProp)
  expect(r, `Red channel should be dominant (>150), got ${r}`).toBeGreaterThan(150)
  expect(g, `Green channel should be low (<100), got ${g}`).toBeLessThan(100)
  expect(b, `Blue channel should be low (<100), got ${b}`).toBeLessThan(100)
}

/**
 * Resolve a ui-state PATCH payload (arrays of {op, path, value} per scope) into a nested
 * plain object for test assertions.
 */
export function resolveOpsPayload(payload) {
  const result = {}
  for (const scope of ['global', 'session']) {
    const ops = payload[scope]
    if (!Array.isArray(ops)) {
      continue
    }
    result[scope] = {}
    for (const op of ops) {
      if (op.op === 'set') {
        setPath(result[scope], op.path, op.value)
      }
    }
  }
  return result
}

/**
 * Wait for a scrollable element's scrollTop to stop changing (the scroll finished
 * animating), then return that value.
 *
 * Call this before capturing scrollTop into a variable that later assertions compare against;
 * otherwise the variable may capture an in-flight position and race the residual animation.
 */
export async function waitForStableScroll(locator, { interval = 80, attempts = 20 } = {}) {
  let prev = await locator.evaluate(el => el.scrollTop)
  for (let i = 0; i < attempts; i++) {
    await new Promise(resolve => setTimeout(resolve, interval))
    const curr = await locator.evaluate(el => el.scrollTop)
    if (curr === prev) {
      return curr
    }
    prev = curr
  }
  return prev
}

/** Hold each ui-state save from `page` for `ms` before the mocked API applies it. */
export async function delayUiStateSaves(page, ms) {
  await page.route(/\/ui-state/, async route => {
    if (route.request().method() === 'PATCH') {
      await new Promise(resolve => setTimeout(resolve, ms))
    }
    await route.fallback()
  })
}

/**
 * Start a sessions-list refresh answering `listing` and `uiState` as it stood on arrival, `ms` late.
 * Resolves once the read is out, to a function waiting until the page has received the answer.
 */
export async function startHeldRefresh(page, uiState, ms, listing) {
  const uiStatePattern = /\/ui-state/
  let markOut
  const out = new Promise(resolve => {
    markOut = resolve
  })
  const isWorkspaceRead = request =>
    request.method() === 'GET' && !new URL(request.url()).searchParams.has('session_id')
  const hold = async route => {
    if (!isWorkspaceRead(route.request())) {
      await route.fallback()
      return
    }
    const answer = { global: structuredClone(uiState.global), session: {} }
    markOut()
    await new Promise(resolve => setTimeout(resolve, ms))
    await route.fulfill({ json: answer })
  }
  const relist = route =>
    route.request().method() === 'GET' ? route.fulfill({ json: listing }) : route.fallback()
  await page.route(uiStatePattern, hold)
  await page.route('**/sessions', relist)
  const delivered = page.waitForResponse(response => isWorkspaceRead(response.request()))
  await page.evaluate(
    key => window.dispatchEvent(new StorageEvent('storage', { key })),
    PINS_CHANGE_SIGNAL_KEY,
  )
  await out

  return async () => {
    await delivered
    await page.unroute(uiStatePattern, hold)
    await page.unroute('**/sessions', relist)
  }
}

/**
 * Wait until a scroll container's scrollHeight stops growing (the streamed conversation has
 * finished rendering and the chat's load-time settle has stopped), then return that value.
 *
 * Use before manipulating scroll on a freshly-loaded transcript: a scrollTop write issued
 * while turns still stream in lands inside autoscroll's near-bottom re-engage threshold,
 * which snaps back to the bottom and drifts the position.
 */
export async function waitForStableScrollHeight(locator, { interval = 100, attempts = 30 } = {}) {
  // Each sample spans the settle's still frames plus the frame its last deferred scroll lands in.
  const frames = SCROLL_SETTLE_STILL_FRAMES + 2
  const sample = () =>
    locator.evaluate(
      (el, { interval, frames }) =>
        new Promise(resolve => {
          const start = performance.now()
          let seen = 0
          const tick = () => {
            seen += 1
            if (seen >= frames && performance.now() - start >= interval) {
              resolve(el.scrollHeight)
            } else {
              requestAnimationFrame(tick)
            }
          }
          requestAnimationFrame(tick)
        }),
      { interval, frames },
    )
  let prev = await locator.evaluate(el => el.scrollHeight)
  for (let i = 0; i < attempts; i++) {
    const curr = await sample()
    if (curr === prev && curr > 0) {
      return curr
    }
    prev = curr
  }
  return prev
}

/** Set a value at a dot-separated path in an object; throws on a prototype-polluting segment. */
function setPath(obj, path, value) {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`setPath: unsafe path segment "${key}" in "${path}"`)
    }
    if (i < parts.length - 1) {
      if (!(key in current)) {
        current[key] = {}
      }
      current = current[key]
    } else {
      current[key] = value
    }
  }
}
