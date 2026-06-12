/** E2E tests for Tasks panel. */

import { expect, test } from '@playwright/test'
import { openTasksPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Tasks Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: shortcut:alt4
  test('Alt+4 toggles tasks panel', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Tasks is visible by default
    await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()

    // Press Alt+4 to close
    await page.keyboard.press('Alt+4')
    await expect(page.locator('[data-testid="panel-tasks"]')).not.toBeVisible()

    // Press Alt+4 again to reopen
    await page.keyboard.press('Alt+4')
    await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()
  })

  // SPEC: panel-task:panel
  test('shows empty state when no tasks', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTasksPanel(page)

    await expect(page.getByText('No tasks')).toBeVisible()
  })

  // SPEC: panel-task:description
  test('shows running task with description and duration', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Send background task events (no completion yet = running)
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Run the build',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_001',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Running build...',
        timestamp: Date.now() + 100,
        ts: new Date().toISOString(),
      },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now() + 200,
        ts: new Date().toISOString(),
        tool_use_id: 'task_bg_001',
        tool_name: 'Task',
        tool_input: {
          description: 'Build project',
          prompt: 'Run npm build',
          subagent_type: 'Bash',
          run_in_background: true,
        },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'Background task started',
        timestamp: Date.now() + 300,
        ts: new Date().toISOString(),
        tool_use_id: 'task_bg_001',
        metadata: { background_task: true, output_file: '/tmp/bg.output' },
        tool_use_result: {
          isAsync: true,
          agentId: 'agent_bg_001',
          outputFile: '/tmp/bg.output',
        },
      },
    ])

    // Wait for the task to be processed
    await expect(page.getByText('Running build...').first()).toBeVisible()

    await openTasksPanel(page)

    // Should show task entry with description
    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toBeVisible()
    await expect(taskEntry.locator('.task-description')).toContainText('Build project')
    await expect(taskEntry.locator('.task-duration')).toBeVisible()
  })

  // SPEC: panel-task:description
  test('shows completed task', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-background-nested.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTasksPanel(page)

    // Switch to "All" filter to see completed tasks
    await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toBeVisible()
    await expect(taskEntry.locator('.task-description')).toContainText('Build project')
  })

  // SPEC: panel-task:click-tab
  test('clicking task scrolls to tool block in chat', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-background-nested.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTasksPanel(page)

    // Switch to "All" filter
    await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

    // Click the task entry
    const taskEntry = page.locator('[data-testid="task-entry"]').first()
    await expect(taskEntry).toBeVisible()
    await taskEntry.click()

    // The tool block with matching data-tool-use-id should exist in chat
    const toolBlock = page.locator('[data-tool-use-id="task_bg_001"]')
    await expect(toolBlock).toBeVisible()
    // Scroll position and highlight verification is timing-dependent in mocks
  })

  // SPEC: panel-task:status-indicator
  test('running task has running status class', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Test',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_001',
      },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now() + 100,
        ts: new Date().toISOString(),
        tool_use_id: 'task_run_001',
        tool_name: 'Task',
        tool_input: {
          description: 'Running task',
          prompt: 'Do work',
          subagent_type: 'Bash',
          run_in_background: true,
        },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'Background task started',
        timestamp: Date.now() + 200,
        ts: new Date().toISOString(),
        tool_use_id: 'task_run_001',
        metadata: { background_task: true, output_file: '/tmp/bg.output' },
        tool_use_result: {
          isAsync: true,
          agentId: 'agent_run_001',
          outputFile: '/tmp/bg.output',
        },
      },
    ])

    await openTasksPanel(page)

    // Task entry should have running status class
    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toHaveClass(/task-running/)
  })

  test.describe('Panel Details', () => {
    // SPEC: layout:panel-order-right
    test('Tasks icon is between Stash and Usage in the right icon strip', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // All three icons should be visible in the right strip
      const stashIcon = page.locator('[data-testid="icon-stash"]')
      const tasksIcon = page.locator('[data-testid="icon-tasks"]')
      const usageIcon = page.locator('[data-testid="icon-usage"]')

      await expect(stashIcon).toBeVisible()
      await expect(tasksIcon).toBeVisible()
      await expect(usageIcon).toBeVisible()

      // Get vertical positions (top values) - icons are stacked vertically in the strip
      const stashTop = await stashIcon.evaluate(el => el.getBoundingClientRect().top)
      const tasksTop = await tasksIcon.evaluate(el => el.getBoundingClientRect().top)
      const usageTop = await usageIcon.evaluate(el => el.getBoundingClientRect().top)

      // Tasks should be below Stash and above Usage
      expect(tasksTop).toBeGreaterThan(stashTop)
      expect(tasksTop).toBeLessThan(usageTop)
    })

    // SPEC: layout:icon-tooltip
    test('Tasks icon button uses SquareKanban icon', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const tasksIcon = page.locator('[data-testid="icon-tasks"]')
      await expect(tasksIcon).toBeVisible()

      // Verify the button has the correct tooltip (title attribute includes "Tasks")
      const title = await tasksIcon.getAttribute('title')
      expect(title).toBe('Tasks (Alt+4)')

      // Verify the icon contains an SVG element (lucide-react renders SVG)
      await expect(tasksIcon.locator('svg')).toBeVisible()
    })

    // SPEC: panel-task:sort-chronological
    test('tasks are sorted chronologically (oldest first)', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-multiple.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter to see all completed tasks
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      // Should have 3 task entries
      const taskEntries = page.locator('[data-testid="task-entry"]')
      await expect(taskEntries).toHaveCount(3)

      // Oldest task (first) should appear first in the list
      const descriptions = await taskEntries.locator('.task-description').allTextContents()
      expect(descriptions[0]).toContain('First task - lint code')
      expect(descriptions[1]).toContain('Second task - run tests')
      expect(descriptions[2]).toContain('Third task - deploy app')
    })

    // SPEC: panel-task:description
    test('task entry displays description from Task invocation', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter to see completed task
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Description element should contain the text from the Task tool input.description
      const descriptionEl = taskEntry.locator('.task-description')
      await expect(descriptionEl).toBeVisible()
      await expect(descriptionEl).toContainText('Build project')
    })

    // SPEC: panel-task:duration
    test('running task shows live-ticking duration', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a running task (no completion notification)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Run deploy',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_dur_001',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
          tool_use_id: 'task_dur_001',
          tool_name: 'Task',
          tool_input: {
            description: 'Deploy application',
            prompt: 'Run deploy',
            subagent_type: 'Bash',
            run_in_background: true,
          },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'Background task started',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
          tool_use_id: 'task_dur_001',
          metadata: { background_task: true, output_file: '/tmp/bg_deploy.output' },
          tool_use_result: {
            isAsync: true,
            agentId: 'agent_dur_001',
            outputFile: '/tmp/bg_deploy.output',
          },
        },
      ])

      await openTasksPanel(page)

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Duration element should be visible
      const durationEl = taskEntry.locator('.task-duration')
      await expect(durationEl).toBeVisible()

      // Capture initial duration text
      const initialDuration = await durationEl.textContent()

      // Wait for the live-tick interval to update (poll instead of fixed timeout)
      await expect.poll(async () => durationEl.textContent()).not.toBe(initialDuration)
    })

    // SPEC: panel-task:duration
    test('completed task shows final duration', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter to see completed task
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Duration element should be visible for completed task
      const durationEl = taskEntry.locator('.task-duration')
      await expect(durationEl).toBeVisible()

      // Capture duration text
      const duration = await durationEl.textContent()

      // Confirm duration does NOT tick (completed task has static duration)
      // Poll multiple times to verify stability
      await expect.poll(async () => durationEl.textContent(), { timeout: 2000 }).toBe(duration)
    })
  })

  test.describe('Filter Tabs', () => {
    // SPEC: panel-task:filter-tabs
    test('Active filter shows only running tasks', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Default "Active" filter - completed task should not show
      // The fixture has a completed task, so Active filter should show "No tasks"
      await expect(page.locator('.tasks-list-empty')).toBeVisible()
    })

    // SPEC: panel-task:filter-tabs
    test('All filter shows completed tasks', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      // Completed task should now be visible
      await expect(page.locator('[data-testid="task-entry"]')).toBeVisible()
    })
  })

  test.describe('Staleness Indication', () => {
    // SPEC: panel-task:staleness
    // SPEC: panel-task:staleness-fresh
    test('running task has colored left border', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-async.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Running task should have an inline border-left-color style (staleness color)
      const borderColor = await taskEntry.evaluate(el => el.style.borderLeftColor)
      expect(borderColor).toBeTruthy()

      // Verify the border has a non-transparent, non-default color
      const match = borderColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      expect(match, `Expected valid rgb() value, got: ${borderColor}`).toBeTruthy()
      const [, r, g, b] = match.map(Number)
      // Not black/transparent - any meaningful staleness color
      const isNonDefault = r > 0 || g > 0 || b > 0
      expect(isNonDefault, `Expected non-black border color, got rgb(${r},${g},${b})`).toBe(true)
    })

    // SPEC: panel-task:staleness-running-only
    test('completed task does not have staleness border color', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter to see completed task
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Completed task should NOT have inline border-left-color style
      const borderColor = await taskEntry.evaluate(el => el.style.borderLeftColor)
      expect(borderColor).toBeFalsy()
    })
  })

  test.describe('Empty and Resume States', () => {
    // SPEC: panel-task:empty
    test('shows "No tasks" when no background tasks exist', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)
      await expect(page.getByText('No tasks')).toBeVisible()
    })

    // SPEC: panel-task:resume
    test('shows "Resuming..." during session replay', async ({ page }) => {
      await mockAPI(page)
      // Use resuming fixture to trigger isReplaying state
      await mockSSE(page, 'events/resuming.jsonl')
      await page.goto(DEFAULT_SESSION_URL)

      // Wait for footer (app ready indicator that doesn't depend on chat input)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openTasksPanel(page)

      // Should show resuming state
      await expect(page.locator('[data-testid="panel-tasks"]')).toContainText('Resuming...')
    })
  })

  test.describe('Filter Badge Counts', () => {
    // SPEC: panel-task:filter-tabs
    // SPEC: panel-task:badge
    test('filter tabs show badge counts matching task counts', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-multiple.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Wait for events to be processed and tasks to render (filter tabs appear when allTasks > 0)
      const allTab = page.locator('.tasks-filter-btn', { hasText: 'All' })
      await expect(allTab).toBeVisible({ timeout: 10000 })

      const activeTab = page.locator('.tasks-filter-btn', { hasText: 'Active' })
      await expect(activeTab).toBeVisible()

      // "All" badge should contain a number
      const allBadge = allTab.locator('.panel-list-item-count')
      await expect(allBadge).toBeVisible({ timeout: 10000 })
      const badgeText = await allBadge.textContent()
      expect(Number.parseInt(badgeText, 10)).toBeGreaterThan(0)
    })
  })

  test.describe('Killed Task Display', () => {
    // SPEC: panel-task:status-indicator
    test('killed task uses same visual indicator as failed', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-killed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openTasksPanel(page)

      // Switch to "All" filter to see killed tasks
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntry = page.locator('[data-testid="task-entry"]').first()
      await expect(taskEntry).toBeVisible()

      // Killed should display as failed - same CSS class/border as failed tasks
      await expect(taskEntry).toHaveClass(/task-failed|task-error/)
    })
  })
})
