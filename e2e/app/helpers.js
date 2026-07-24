/** Shared E2E test helpers. */

import { expect } from '@playwright/test'

/**
 * Wait for app to be ready and return the input locator.
 *
 * Waits for footer, workspace label, input field, and font loading to complete.
 * Font loading is critical for visual regression stability — without it, element
 * heights vary by a few pixels between runs.
 */
export async function waitForAppReady(page) {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('[data-testid="footer"]')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')

  const input = page.locator('[data-testid="chat-input"]')
  await expect(input).toBeEnabled()

  // Wait for all fonts to finish loading before any screenshots
  await page.evaluate(() => document.fonts.ready)

  return input
}

/**
 * Turn off auto-collapse so every turn renders expanded.
 *
 * Auto-collapse defaults on and collapses all turns except the last; tests that
 * assert on content inside earlier turns disable it first to see full turns.
 * Idempotent — only clicks when auto-collapse is currently on.
 */
export async function disableAutoCollapse(page) {
  const toggle = page.locator('[data-testid="autocollapse-toggle"]')
  if ((await toggle.getAttribute('aria-pressed')) === 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
}

/**
 * Wait for mobile layout to be ready and return the input locator.
 *
 * Waits for mobile layout root, top bar, input field, and font loading.
 */
export async function waitForMobileReady(page) {
  await expect(page.locator('.mobile-layout')).toBeVisible()
  await expect(page.locator('.mobile-top-bar')).toBeVisible()

  const input = page.locator('[data-testid="chat-input"]')
  await expect(input).toBeEnabled()

  await page.evaluate(() => document.fonts.ready)

  return input
}

// Panel button and content selectors
const PANELS = {
  sessions: { button: 'button[title="Sessions (Alt+1)"]', content: '.sessions-panel' },
  todos: { button: 'button[title="Todos (Alt+2)"]', content: '.todos-panel' },
  stash: { button: 'button[title="Stash (Alt+3)"]', content: '.stash-panel' },
  tasks: { button: 'button[title="Tasks (Alt+4)"]', content: '.tasks-panel' },
  bookmarks: { button: 'button[title="Bookmarks (Alt+5)"]', content: '.bookmarks-panel' },
  boards: { button: 'button[title="Boards (Alt+6)"]', content: '.boards-panel' },
  usage: { button: 'button[title="Usage (Alt+7)"]', content: '.usage-panel' },
  mcp: { button: 'button[title="MCP Servers (Alt+8)"]', content: '.mcp-panel' },
  commands: { button: 'button[title="Skills (Alt+9)"]', content: '.skills-panel' },
  help: { button: 'button[title="Help"]', content: '.help-panel' },
  logs: { button: 'button[title="Logs (Alt+0)"]', content: '.logs-panel' },
}

/**
 * Toggle panel (always clicks button).
 */
async function togglePanel(page, panel) {
  await page.locator(panel.button).click()
}

/**
 * Open panel if not already visible.
 */
async function openPanel(page, panel) {
  const content = page.locator(panel.content)
  // Wait for content to be attached before checking visibility
  try {
    await content.waitFor({ state: 'attached', timeout: 500 })
  } catch {
    // Content not attached, need to click to open
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
 * Iterates the PANELS map, checks each panel's content visibility, and clicks
 * its toggle button only when visible. State-aware (vs blind toggling) so the
 * end state is deterministic regardless of the layout's default-open set.
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

/** Extract RGB channels from a computed CSS color property. */
async function parseComputedColor(locator, cssProp) {
  const color = await locator.evaluate((el, prop) => getComputedStyle(el)[prop], cssProp)
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  expect(match, `Expected valid rgb() value for ${cssProp}, got: ${color}`).toBeTruthy()
  const [, r, g, b] = match.map(Number)
  return { r, g, b }
}

/**
 * Assert a CSS color property matches expected RGB channels within tolerance.
 *
 * @param {import('@playwright/test').Locator} locator - Element to check
 * @param {string} cssProp - CSS property name (e.g., 'color', 'borderLeftColor', 'backgroundColor')
 * @param {object} expected - Expected RGB channels: {r, g, b} (0-255)
 * @param {number} [tolerance=50] - Allowed deviation per channel
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

/**
 * Assert a color is red-dominant (high red, low green, low blue).
 *
 * @param {import('@playwright/test').Locator} locator - Element to check
 * @param {string} cssProp - CSS property name
 */
export async function assertRedColor(locator, cssProp) {
  const { r, g, b } = await parseComputedColor(locator, cssProp)
  expect(r, `Red channel should be dominant (>150), got ${r}`).toBeGreaterThan(150)
  expect(g, `Green channel should be low (<100), got ${g}`).toBeLessThan(100)
  expect(b, `Blue channel should be low (<100), got ${b}`).toBeLessThan(100)
}

/**
 * Resolve an operation-based PATCH payload into a plain object.
 *
 * The ui-state PATCH protocol sends arrays of {op, path, value} per scope.
 * This helper converts back to a nested object for test assertions.
 *
 * @param {object} payload - PATCH payload with `global` and/or `session` arrays
 * @returns {object} Resolved payload with plain objects
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
 * Wait for a scrollable element's scrollTop to stop changing — i.e. the
 * scroll has finished animating. Polls until two consecutive reads (≥80ms
 * apart) return the same value, then returns it.
 *
 * Use this before reading scrollTop into a test-time variable that subsequent
 * assertions compare against; without it, the variable may capture an
 * in-flight position and the next user action will race the residual
 * animation.
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

/**
 * Set a value at a dot-separated path in an object.
 */
function setPath(obj, path, value) {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      current[parts[i]] = {}
    }
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}
