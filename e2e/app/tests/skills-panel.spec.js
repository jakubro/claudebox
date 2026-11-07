/** E2E tests for Skills panel including tabs, filtering, counts, and empty/resume states. */

import { expect, test } from '@playwright/test'
import { openResumingSession, openSkillsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

async function mockCommands(page, commands) {
  await mockAPI(page, {
    handlers: {
      getSessionStatus: async route => {
        await route.fulfill({
          json: { session_id: 'test-001', workspace: '/home/user/project', commands },
        })
      },
    },
  })
}

async function openSkills(page) {
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await openSkillsPanel(page)

  return page.locator('[data-testid="panel-skills"]')
}

test.describe('Skills Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockSSE(page)
  })

  // SPEC: layout:panel-order-right
  test('opens via icon click in right icon bar', async ({ page }) => {
    await mockAPI(page)
    await openSkills(page)
    const commandsPanel = page.locator('[data-testid="panel-skills"]')
    await expect(commandsPanel).toBeVisible()

    const box = await commandsPanel.boundingBox()
    const viewport = page.viewportSize()
    expect(box.x).toBeGreaterThan(viewport.width / 2)
  })

  // SPEC: layout:panel-tab-name
  test('its tab reads Skills, also when a layout saved under Commands reopens it', async ({
    page,
  }) => {
    const uiState = { global: {}, sessions: {} }
    await mockAPI(page, { uiState })
    await openSkills(page)
    const tabs = page.locator('.icon-tab')
    await expect(tabs.filter({ hasText: 'Skills' })).toHaveCount(1)
    const saved = () => uiState.sessions[DEFAULT_SESSION_ID]?.layout?.panels?.commands
    await expect.poll(() => saved()?.title).toBe('Skills')

    saved().title = 'Commands'
    await page.reload()
    await waitForAppReady(page)

    await expect(tabs.filter({ hasText: 'Skills' })).toHaveCount(1)
    await expect(tabs.filter({ hasText: 'Commands' })).toHaveCount(0)
  })

  // SPEC: layout:icon-tooltip
  test('commands icon button exists with Command icon', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const iconBtn = page.locator('[data-testid="icon-commands"]')
    await expect(iconBtn).toBeVisible()
    await expect(iconBtn).toHaveAttribute('title', 'Skills')

    const svg = iconBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('no Alt+digit toggles the Skills panel; its icon does', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    const skills = page.locator('[data-testid="panel-skills"]')

    for (const digit of '1234567890') {
      await page.keyboard.press(`Alt+${digit}`)
      await expect(skills, `after Alt+${digit}`).not.toBeVisible()
      await page.keyboard.press(`Alt+${digit}`)
    }

    await page.locator('[data-testid="icon-commands"]').click()
    await expect(skills).toBeVisible()
  })

  // SPEC: panel-command:tabs
  test('shows three tabs: Custom, MCP, All', async ({ page }) => {
    await mockAPI(page)
    const panel = await openSkills(page)
    await expect(panel.getByRole('button', { name: /Custom/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^MCP/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^All/ })).toBeVisible()
  })

  // SPEC: panel-command:tabs (default tab)
  test('defaults to Custom tab', async ({ page }) => {
    await mockAPI(page)
    const panel = await openSkills(page)
    const customBtn = panel.getByRole('button', { name: /Custom/ })
    await expect(customBtn).toHaveClass(/active/)
  })

  // SPEC: panel-command:custom-filter
  test('Custom tab shows non-MCP commands only', async ({ page }) => {
    await mockCommands(page, {
      custom: [{ name: 'deploy' }, { name: 'test' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [],
    })
    const panel = await openSkills(page)
    await expect(panel.getByText('/deploy')).toBeVisible()
    await expect(panel.getByText('/test')).toBeVisible()
    await expect(panel.getByText('/mcp__slack__send')).not.toBeVisible()
  })

  // SPEC: panel-command:mcp-filter
  test('MCP tab shows only mcp__ commands', async ({ page }) => {
    await mockCommands(page, {
      custom: [{ name: 'deploy' }],
      mcp: [{ name: 'mcp__slack__send' }, { name: 'mcp__github__pr' }],
      builtin: [],
    })
    const panel = await openSkills(page)
    await panel.getByRole('button', { name: /^MCP/ }).click()

    await expect(panel.getByText('/mcp__slack__send')).toBeVisible()
    await expect(panel.getByText('/mcp__github__pr')).toBeVisible()
    await expect(panel.getByText('/deploy')).not.toBeVisible()
  })

  // SPEC: panel-command:all-filter
  test('All tab shows all commands', async ({ page }) => {
    await mockCommands(page, {
      custom: [{ name: 'deploy' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [],
    })
    const panel = await openSkills(page)
    await panel.getByRole('button', { name: /^All/ }).click()

    await expect(panel.getByText('/deploy')).toBeVisible()
    await expect(panel.getByText('/mcp__slack__send')).toBeVisible()
  })

  // SPEC: panel-command:tab-counts
  test('tab badges show count per category', async ({ page }) => {
    await mockCommands(page, {
      custom: [{ name: 'deploy' }, { name: 'test' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [],
    })
    const panel = await openSkills(page)
    await expect(panel.getByRole('button', { name: /Custom.*2/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /MCP.*1/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /All.*3/ })).toBeVisible()
  })

  // SPEC: panel-command:slash-prefix
  test('commands displayed with / prefix', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: { custom: [{ name: 'compact' }], mcp: [], builtin: [] },
            },
          })
        },
      },
    })
    const panel = await openSkills(page)
    await expect(panel.getByText('/compact')).toBeVisible()
  })

  // SPEC: panel-command:empty
  test('shows "No skills" when empty', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: { custom: [], mcp: [], builtin: [] },
            },
          })
        },
      },
    })
    await openSkills(page)

    await expect(page.getByText('No skills')).toBeVisible()
  })

  // SPEC: panel-command:resume
  test('shows "Resuming..." during replay', async ({ page }) => {
    await mockAPI(page)
    // Fixture triggers isReplaying (replay_started without replay_ended).
    await openResumingSession(page)

    await page.locator('[data-testid="icon-commands"]').click()

    await expect(page.locator('[data-testid="panel-skills"]')).toContainText('Resuming...')
  })
})
