/** E2E tests for hiding one MCP tool from the Focused view by hand, remembered per workspace. */

import { devices, expect, test } from '@playwright/test'
import {
  disableAutoCollapse,
  openSessionWithAPI,
  waitForAppReady,
  waitForMobileReady,
} from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5']

const FIXTURE = 'events/focused-hide-tool.jsonl'
const READ_URL = 'mcp__docs__read_url'
const READ_URL_CALLS = ['tu_url_1', 'tu_url_2']

const block = (page, id) => page.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)
const hideButton = (page, id) =>
  block(page, id).locator(':scope > .tool-header-area [data-testid="tool-focus-hide-btn"]')
const eye = page => page.getByTestId('right-slot-view-everything')

test.describe('Hiding a tool from Focused', () => {
  // SPEC: chat:focused-hide-tool-button
  test("an MCP tool's block offers the button on hover; a tool Focused hides on its own does not", async ({
    page,
  }) => {
    await openWithSharedUi(page, sharedUiState(), { view: 'everything' })

    await block(page, 'tu_url_1').locator('.tool-header').first().hover()
    const button = hideButton(page, 'tu_url_1')
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('title', 'Hide in Focused')
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(
      await button.evaluate(el =>
        el.previousElementSibling?.classList.contains('tool-bookmark-btn'),
      ),
    ).toBe(true)

    await expect(hideButton(page, 'tu_spawn')).toHaveCount(1)
    for (const id of ['tu_sr', 'tu_ro', 'tu_bash', 'tu_task']) {
      await expect(hideButton(page, id), id).toHaveCount(0)
    }
  })

  // SPEC: chat:focused-hide-tool-mark
  // SPEC: tool:work-block-parity
  test('marking a tool presses its button on every block of that tool, at rest and in the work column', async ({
    page,
  }) => {
    const ui = sharedUiState()
    await openWithSharedUi(page, ui, { view: 'everything' })

    await markReadUrl(page)
    await page.mouse.move(5, 5)
    const button = hideButton(page, 'tu_url_1')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(button).toHaveAttribute('title', 'Show in Focused')
    await expect(button).toHaveCSS('opacity', '1')
    await expect(hideButton(page, 'tu_url_2')).toHaveAttribute('aria-pressed', 'true')
    await expect(hideButton(page, 'tu_search')).toHaveAttribute('aria-pressed', 'false')
    expect(ui.global.focusedHiddenTools).toEqual([READ_URL])

    await page.getByTestId('right-slot-view-work').click()
    const workBlock = page.locator(
      `.chat-right-slot [data-testid="tool-block"][data-tool-use-id="tu_url_1"]`,
    )
    await expect(
      workBlock.locator(':scope > .tool-header-area [data-testid="tool-focus-hide-btn"]'),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  // SPEC: chat:focused-hide-tool-mark
  test('clicking the button neither folds nor opens the block', async ({ page }) => {
    await openWithSharedUi(page, sharedUiState(), { view: 'everything' })
    const expanded = () => block(page, 'tu_url_1').getAttribute('data-expanded')
    const before = await expanded()

    await markReadUrl(page)

    await expect(hideButton(page, 'tu_url_1')).toHaveAttribute('aria-pressed', 'true')
    expect(await expanded()).toBe(before)
  })

  // SPEC: chat:focused-hide-tool-hidden
  // SPEC: chat:focused-hide-tool-one-tool
  test("Focused hides every call of a marked tool, a subagent's included; its other tools stay", async ({
    page,
  }) => {
    await openWithSharedUi(page, sharedUiState({ marks: [READ_URL] }))

    for (const id of READ_URL_CALLS) {
      await expect(block(page, id), id).toHaveCount(0)
    }
    await expect(block(page, 'tu_url_failed')).toHaveAttribute('data-tool-status', 'error')
    await expect(block(page, 'tu_search')).toBeVisible()
    await expect(block(page, 'tu_spawn')).toBeVisible()

    const task = block(page, 'tu_task')
    await task.locator('.tool-header-area').first().click()
    await expect(task).toContainText('Both links work.')
    await expect(task.locator('[data-tool-use-id="tu_sub_url"]')).toHaveCount(0)

    await eye(page).click()
    for (const id of READ_URL_CALLS) {
      await expect(hideButton(page, id), id).toHaveAttribute('aria-pressed', 'true')
    }
    if ((await task.getAttribute('data-expanded')) !== 'true') {
      await task.locator('.tool-header-area').first().click()
    }
    await expect(task.locator('[data-tool-use-id="tu_sub_url"]')).toBeVisible()
  })

  // SPEC: chat:focused-hide-tool-hidden
  test('a bookmarked call of a marked tool stays in Focused, its button pressed', async ({
    page,
  }) => {
    await openWithSharedUi(
      page,
      sharedUiState({ marks: [READ_URL], bookmarks: ['turn_002:tool-tu_url_2'] }),
    )

    await expect(block(page, 'tu_url_1')).toHaveCount(0)
    await expect(block(page, 'tu_url_2')).toBeVisible()
    await expect(hideButton(page, 'tu_url_2')).toHaveAttribute('aria-pressed', 'true')
  })

  // SPEC: chat:focused-hide-tool-unmark
  test('clicking a pressed button removes the mark; Focused shows the tool again', async ({
    page,
  }) => {
    const ui = sharedUiState({ marks: [READ_URL] })
    await openWithSharedUi(page, ui, { view: 'everything' })

    await hideButton(page, 'tu_url_1').click()
    await expect(hideButton(page, 'tu_url_1')).toHaveAttribute('aria-pressed', 'false')
    expect(ui.global.focusedHiddenTools).toEqual([])

    await eye(page).click()
    await expect(block(page, 'tu_url_1')).toBeVisible()
  })

  // SPEC: chat:focused-hide-tool-workspace
  test('marks are kept after a reload and shared by another browser and another tab', async ({
    page,
    browser,
  }) => {
    const ui = sharedUiState()
    await openWithSharedUi(page, ui, { view: 'everything' })
    const sameBrowserTab = await page.context().newPage()
    await openWithSharedUi(sameBrowserTab, ui)
    await expect(block(sameBrowserTab, 'tu_url_1')).toBeVisible()

    await markReadUrl(page)
    await expect(block(sameBrowserTab, 'tu_url_1')).toHaveCount(0)

    await page.reload()
    await waitForAppReady(page)
    await expect(hideButton(page, 'tu_url_1')).toHaveAttribute('aria-pressed', 'true')

    const otherBrowser = await browser.newContext()
    const other = await otherBrowser.newPage()
    await openWithSharedUi(other, ui)
    await expect(block(other, 'tu_search')).toBeVisible()
    await expect(block(other, 'tu_url_1')).toHaveCount(0)
    await otherBrowser.close()
  })

  // SPEC: chat:focused-hide-tool-runtimes
  test('a mark matches the same tool in a session that names no server, both ways', async ({
    page,
  }) => {
    const ui = sharedUiState({ marks: [READ_URL] })
    await openWithSharedUi(page, ui, {
      fixture: 'events/langgraph-focused-hide-tool.jsonl',
      langGraph: true,
    })

    await expect(block(page, 'lg_search')).toBeVisible()
    await expect(block(page, 'lg_url')).toHaveCount(0)

    await eye(page).click()
    await expect(hideButton(page, 'lg_url')).toHaveAttribute('aria-pressed', 'true')
    await expect(hideButton(page, 'lg_read')).toHaveCount(0)
    await hideButton(page, 'lg_search').click()
    await expect.poll(() => ui.global.focusedHiddenTools).toEqual([READ_URL, 'search_web'])
    await hideButton(page, 'lg_url').click()
    await expect(hideButton(page, 'lg_url')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => ui.global.focusedHiddenTools).toEqual(['search_web'])

    const claude = await page.context().newPage()
    const claudeUi = sharedUiState({ marks: ['read_url'] })
    await openWithSharedUi(claude, claudeUi)
    await expect(block(claude, 'tu_url_1')).toHaveCount(0)
    await expect(block(claude, 'tu_search')).toBeVisible()
    await eye(claude).click()
    await hideButton(claude, 'tu_url_1').click()
    await expect(hideButton(claude, 'tu_url_2')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => claudeUi.global.focusedHiddenTools).toEqual([])
  })
})

test.describe('Hiding a tool from Focused on a phone', () => {
  test.use({ ...PIXEL_5, hasTouch: true })

  // SPEC: chat:focused-hide-tool-phone
  test("no block shows the button; a marked tool's calls stay hidden", async ({ page }) => {
    const ui = sharedUiState({ marks: [READ_URL] })
    await mockAPI(page, ui.optionsFor('everything'))
    await mockSSE(page, FIXTURE)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(block(page, 'tu_url_failed')).toBeVisible()
    await expect(block(page, 'tu_url_2')).toHaveCount(0)
    await expect(page.getByTestId('tool-focus-hide-btn')).toHaveCount(0)
  })
})

async function openWithSharedUi(
  page,
  ui,
  { view = null, fixture = FIXTURE, langGraph = false } = {},
) {
  await openSessionWithAPI(page, fixture, {
    ...ui.optionsFor(view),
    ...(langGraph && { statusFixture: 'status/langgraph-anthropic.json' }),
  })
  await disableAutoCollapse(page)
}

async function markReadUrl(page) {
  await block(page, 'tu_url_1').locator('.tool-header').first().hover()
  await hideButton(page, 'tu_url_1').click()
}

function sharedUiState({ marks = [], bookmarks = [] } = {}) {
  const global = {
    focusedHiddenTools: [...marks],
    bookmarkedTurns: bookmarks.length ? { [DEFAULT_SESSION_ID]: [...bookmarks] } : {},
  }
  return {
    global,
    optionsFor: view => ({
      handlers: {
        getUIState: route => {
          const named = new URL(route.request().url()).searchParams.get('session_id')
          const session = named && view ? { rightSlotView: view } : {}
          return route.fulfill({ json: { global, session } })
        },
        patchUIState: async route => {
          for (const op of route.request().postDataJSON().global ?? []) {
            const list = global[op.path] ?? []
            if (op.op === 'add' && !list.includes(op.value)) {
              global[op.path] = [...list, op.value]
            } else if (op.op === 'remove') {
              global[op.path] = list.filter(v => v !== op.value)
            }
          }
          await route.fulfill({ json: { global, session: {} } })
        },
      },
    }),
  }
}
