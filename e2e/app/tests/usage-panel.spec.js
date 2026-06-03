/** E2E tests for Usage panel. */

import { expect, test } from '@playwright/test'
import { openUsagePanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_CONTAINER_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createDaemonSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Usage Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockSSE(page)
  })

  // SPEC: layout:panel-order-right
  test('opens via icon click', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)
    const usagePanel = page.locator('[data-testid="panel-usage"]')
    await expect(usagePanel).toBeVisible()

    // Panel should be on the right side of the viewport
    const box = await usagePanel.boundingBox()
    const viewport = page.viewportSize()
    expect(box.x).toBeGreaterThan(viewport.width / 2)
  })

  // SPEC: shortcut:alt7
  test('Alt+7 toggles usage panel', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Usage is hidden by default.
    await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()

    // Press Alt+7 to open
    await page.keyboard.press('Alt+7')
    await expect(page.locator('[data-testid="panel-usage"]')).toBeVisible()

    // Press Alt+7 again to close
    await page.keyboard.press('Alt+7')
    await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()
  })

  // SPEC: panel-usage:content
  test('shows 4 cost interval rows', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    await expect(page.getByText('24 hours')).toBeVisible()
    await expect(page.getByText('7 days')).toBeVisible()
    await expect(page.getByText('30 days')).toBeVisible()
    await expect(page.getByText('All time')).toBeVisible()
  })

  // SPEC: panel-usage:format
  test('costs formatted as $X.XX', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // All time should aggregate all sessions ($0 + $0.12 + $0.75 = $0.87)
    const allTimeCost = page.locator('.usage-cost').last()
    await expect(allTimeCost).toContainText(/\$\d+\.\d{2}/)
  })

  // SPEC: panel-usage:zero
  test('shows $0.00 when no sessions have cost', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'zero-cost-001',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 3,
                  total_cost_usd: 0,
                  started_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // All rows should show $0.00
    const costs = page.locator('.usage-cost')
    const count = await costs.count()
    for (let i = 0; i < count; i++) {
      await expect(costs.nth(i)).toContainText('$0.00')
    }
  })

  // SPEC: panel-usage:zero
  test('shows $0.00 when sessions list has no cost', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'placeholder',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  num_turns: 0,
                  total_cost_usd: 0,
                  started_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    const costs = page.locator('.usage-cost')
    const count = await costs.count()
    for (let i = 0; i < count; i++) {
      await expect(costs.nth(i)).toContainText('$0.00')
    }
  })

  // SPEC: panel-usage:content
  test('recent sessions aggregate into shorter intervals', async ({ page }) => {
    const now = new Date()
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString()

    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'recent-001',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.1,
                  started_at: twoHoursAgo,
                  updated_at: twoHoursAgo,
                },
                {
                  session_id: 'week-001',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 2,
                  total_cost_usd: 0.2,
                  started_at: threeDaysAgo,
                  updated_at: threeDaysAgo,
                },
                {
                  session_id: 'month-001',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 3,
                  total_cost_usd: 0.5,
                  started_at: fifteenDaysAgo,
                  updated_at: fifteenDaysAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // 24h: $0.10, 7d: $0.30, 30d: $0.80, All time: $0.80
    const costs = page.locator('.usage-cost')
    await expect(costs.nth(0)).toContainText('$0.10') // 24h
    await expect(costs.nth(1)).toContainText('$0.30') // 7d
    await expect(costs.nth(2)).toContainText('$0.80') // 30d
    await expect(costs.nth(3)).toContainText('$0.80') // all time
  })

  // SPEC: layout:icon-tooltip
  test('usage panel icon is TrendingUp in icon strip', async ({ page }) => {
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The usage icon button should exist with correct title and contain an SVG
    const iconBtn = page.locator('[data-testid="icon-usage"]')
    await expect(iconBtn).toBeVisible()
    await expect(iconBtn).toHaveAttribute('title', 'Usage (Alt+7)')

    // TrendingUp from lucide-react renders as an SVG element
    const svg = iconBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  // SPEC: panel-usage:24h
  test('shows "24 hours" row with correct cost', async ({ page }) => {
    const now = new Date()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()

    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'h24-001',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.25,
                  started_at: oneHourAgo,
                  updated_at: oneHourAgo,
                },
                {
                  session_id: 'old-001',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 5,
                  total_cost_usd: 1.5,
                  started_at: tenDaysAgo,
                  updated_at: tenDaysAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // "Past 24 hours" row should only include the recent session ($0.25)
    const row24h = page.locator('tr').filter({ hasText: '24 hours' })
    await expect(row24h).toBeVisible()
    await expect(row24h.locator('.usage-cost')).toContainText('$0.25')
  })

  // SPEC: panel-usage:7d
  test('shows "7 days" row with correct cost', async ({ page }) => {
    const now = new Date()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
    const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString()
    const fiftyDaysAgo = new Date(now - 50 * 24 * 60 * 60 * 1000).toISOString()

    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'recent-7d',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.1,
                  started_at: oneHourAgo,
                  updated_at: oneHourAgo,
                },
                {
                  session_id: 'mid-7d',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 2,
                  total_cost_usd: 0.3,
                  started_at: fourDaysAgo,
                  updated_at: fourDaysAgo,
                },
                {
                  session_id: 'old-7d',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 3,
                  total_cost_usd: 2.0,
                  started_at: fiftyDaysAgo,
                  updated_at: fiftyDaysAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // "Past 7 days" row includes recent + mid sessions ($0.10 + $0.30 = $0.40)
    const row7d = page.locator('tr').filter({ hasText: '7 days' })
    await expect(row7d).toBeVisible()
    await expect(row7d.locator('.usage-cost')).toContainText('$0.40')
  })

  // SPEC: panel-usage:30d
  test('shows "30 days" row with correct cost', async ({ page }) => {
    const now = new Date()
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString()
    const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString()

    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'recent-30d',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.15,
                  started_at: twoDaysAgo,
                  updated_at: twoDaysAgo,
                },
                {
                  session_id: 'mid-30d',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 2,
                  total_cost_usd: 0.45,
                  started_at: twentyDaysAgo,
                  updated_at: twentyDaysAgo,
                },
                {
                  session_id: 'old-30d',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 4,
                  total_cost_usd: 3.0,
                  started_at: sixtyDaysAgo,
                  updated_at: sixtyDaysAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // "Past 30 days" row includes recent + mid sessions ($0.15 + $0.45 = $0.60)
    const row30d = page.locator('tr').filter({ hasText: '30 days' })
    await expect(row30d).toBeVisible()
    await expect(row30d.locator('.usage-cost')).toContainText('$0.60')
  })

  // SPEC: panel-usage:all
  test('shows "All time" row with total cost of all sessions', async ({ page }) => {
    const now = new Date()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()

    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'all-recent',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.5,
                  started_at: oneHourAgo,
                  updated_at: oneHourAgo,
                },
                {
                  session_id: 'all-old',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 10,
                  total_cost_usd: 4.5,
                  started_at: ninetyDaysAgo,
                  updated_at: ninetyDaysAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // "All time" row includes every session regardless of age ($0.50 + $4.50 = $5.00)
    const rowAll = page.locator('tr').filter({ hasText: 'All time' })
    await expect(rowAll).toBeVisible()
    await expect(rowAll.locator('.usage-cost')).toContainText('$5.00')
  })

  // SPEC: panel-usage:update
  test('usage values auto-update when session cost changes via SSE', async ({ page }) => {
    // SSE refetch chain: send → SessionsContext.sessionsChanged → 2 s debounce →
    // fetchSessions → UsagePanel re-render. Under full-suite concurrency the
    // total can exceed the default 5 s expect timeout; budget extra wall time.
    test.setTimeout(15000)
    const now = new Date()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()

    let returnUpdatedCost = false
    const daemonSSE = await createDaemonSSEController(page)
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          // Flag is flipped by the test after verifying initial state
          const cost = returnUpdatedCost ? 0.85 : 0.1
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'update-001',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: returnUpdatedCost ? 5 : 1,
                  total_cost_usd: cost,
                  started_at: oneHourAgo,
                  updated_at: new Date().toISOString(),
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)

    // Initially should show $0.10
    const rowAll = page.locator('tr').filter({ hasText: 'All time' })
    await expect(rowAll.locator('.usage-cost')).toContainText('$0.10')

    // Flip flag so subsequent fetches return updated cost
    returnUpdatedCost = true

    // Send sessions_changed SSE event to trigger refetch
    await daemonSSE.sendEvent({ type: 'sessions_changed', workspace_id: 'test-ws' })

    // SessionsContext refetches and UsagePanel updates
    const updatedRow = page.locator('tr').filter({ hasText: 'All time' })
    await expect(updatedRow.locator('.usage-cost')).toContainText('$0.85', { timeout: 10000 })
  })

  // SPEC: panel-usage:update
  test('usage panel refetches on SSE sessions_changed event', async ({ page }) => {
    // See "usage values auto-update…" above — same SSE → debounce → refetch
    // chain that can exceed the default 5 s expect window under load.
    test.setTimeout(15000)
    const now = new Date()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()

    let fetchCount = 0
    const daemonSSE = await createDaemonSSEController(page)
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          fetchCount++
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'sse-001',
                  container_id: DEFAULT_CONTAINER_ID,
                  workspace: '/home/user/project',
                  model: 'claude-sonnet',
                  num_turns: 1,
                  total_cost_usd: 0.1,
                  started_at: oneHourAgo,
                  updated_at: oneHourAgo,
                },
              ],
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)
    await expect(page.getByText('All time')).toBeVisible()

    // Record initial fetch count after panel opens
    const initialCount = fetchCount

    // Send SSE event to trigger refetch
    await daemonSSE.sendEvent({ type: 'sessions_changed', workspace_id: 'test-ws' })

    // Verify sessions were refetched
    await expect.poll(() => fetchCount, { timeout: 10000 }).toBeGreaterThan(initialCount)
  })
})
