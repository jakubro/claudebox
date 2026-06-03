/** E2E tests for Skills panel including tabs, filtering, counts, and empty/resume states. */

import { expect, test } from '@playwright/test'
import { openSkillsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Skills Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockSSE(page)
  })

  // SPEC: layout:panel-order-right
  // SPEC: tool:skill-content-folds
  // SPEC: tool:skill-content-tool-result-intervening
  test('opens via icon click in right icon bar', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)
    const commandsPanel = page.locator('[data-testid="panel-skills"]')
    await expect(commandsPanel).toBeVisible()

    // Panel should be on the right side of the viewport
    const box = await commandsPanel.boundingBox()
    const viewport = page.viewportSize()
    expect(box.x).toBeGreaterThan(viewport.width / 2)
  })

  // SPEC: layout:icon-tooltip
  test('commands icon button exists with Command icon', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const iconBtn = page.locator('[data-testid="icon-commands"]')
    await expect(iconBtn).toBeVisible()
    await expect(iconBtn).toHaveAttribute('title', 'Skills (Alt+9)')

    // Command icon from lucide-react renders as SVG
    const svg = iconBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  // SPEC: shortcut:alt9
  test('Alt+9 toggles commands panel', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Title should include shortcut
    const iconBtn = page.locator('[data-testid="icon-commands"]')
    await expect(iconBtn).toHaveAttribute('title', 'Skills (Alt+9)')

    // Toggle via keyboard shortcut
    await expect(page.locator('[data-testid="panel-skills"]')).not.toBeVisible()
    await page.keyboard.press('Alt+9')
    await expect(page.locator('[data-testid="panel-skills"]')).toBeVisible()
    await page.keyboard.press('Alt+9')
    await expect(page.locator('[data-testid="panel-skills"]')).not.toBeVisible()
  })

  // SPEC: panel-command:tabs
  test('shows three tabs: Custom, MCP, All', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    await expect(panel.getByRole('button', { name: /Custom/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^MCP/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^All/ })).toBeVisible()
  })

  // SPEC: panel-command:tabs (default tab)
  test('defaults to Custom tab', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    const customBtn = panel.getByRole('button', { name: /Custom/ })
    await expect(customBtn).toHaveClass(/active/)
  })

  // SPEC: panel-command:custom-filter
  test('Custom tab shows non-MCP commands only', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: {
                custom: [{ name: 'deploy' }, { name: 'test' }],
                mcp: [{ name: 'mcp__slack__send' }],
                builtin: [],
              },
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    // Custom tab (default) - only non-MCP commands
    await expect(panel.getByText('/deploy')).toBeVisible()
    await expect(panel.getByText('/test')).toBeVisible()
    await expect(panel.getByText('/mcp__slack__send')).not.toBeVisible()
  })

  // SPEC: panel-command:mcp-filter
  test('MCP tab shows only mcp__ commands', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: {
                custom: [{ name: 'deploy' }],
                mcp: [{ name: 'mcp__slack__send' }, { name: 'mcp__github__pr' }],
                builtin: [],
              },
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    // Switch to MCP tab
    await panel.getByRole('button', { name: /^MCP/ }).click()

    await expect(panel.getByText('/mcp__slack__send')).toBeVisible()
    await expect(panel.getByText('/mcp__github__pr')).toBeVisible()
    await expect(panel.getByText('/deploy')).not.toBeVisible()
  })

  // SPEC: panel-command:all-filter
  test('All tab shows all commands', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: {
                custom: [{ name: 'deploy' }],
                mcp: [{ name: 'mcp__slack__send' }],
                builtin: [],
              },
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    // Switch to All tab
    await panel.getByRole('button', { name: /^All/ }).click()

    await expect(panel.getByText('/deploy')).toBeVisible()
    await expect(panel.getByText('/mcp__slack__send')).toBeVisible()
  })

  // SPEC: panel-command:tab-counts
  test('tab badges show count per category', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-001',
              workspace: '/home/user/project',
              commands: {
                custom: [{ name: 'deploy' }, { name: 'test' }],
                mcp: [{ name: 'mcp__slack__send' }],
                builtin: [],
              },
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    // Custom: 2 (deploy, test), MCP: 1 (mcp__slack__send), All: 3
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
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    const panel = page.locator('[data-testid="panel-skills"]')
    // Command should be displayed with / prefix
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
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)

    await expect(page.getByText('No skills')).toBeVisible()
  })

  // SPEC: panel-command:resume
  test('shows "Resuming..." during replay', async ({ page }) => {
    await mockAPI(page)
    // Use an events fixture that triggers isReplaying state (replay_started without replay_ended)
    await mockSSE(page, 'events/resuming.jsonl')
    await page.goto(DEFAULT_SESSION_URL)

    // Wait for footer to appear (app ready indicator that doesn't depend on chat input)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    // Open commands panel via icon click
    await page.locator('[data-testid="icon-commands"]').click()

    await expect(page.locator('[data-testid="panel-skills"]')).toContainText('Resuming...')
  })
})
