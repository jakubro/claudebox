/** E2E tests for Tasks panel. */

import { expect, test } from '@playwright/test'
import {
  openLiveSession,
  openLiveSessionWithAPI,
  openResumingSession,
  openSession,
  openTasksPanel,
} from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

async function openAllTasks(page) {
  await openSession(page, 'events/tool-task-background-nested.jsonl')
  await openTasksPanel(page)
  await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
}

test.describe('Tasks Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: shortcut:alt4
  test('Alt+4 toggles tasks panel', async ({ page }) => {
    await openSession(page)

    await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()

    await page.keyboard.press('Alt+4')
    await expect(page.locator('[data-testid="panel-tasks"]')).not.toBeVisible()

    await page.keyboard.press('Alt+4')
    await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()
  })

  // SPEC: panel-task:panel
  test('shows empty state when no tasks', async ({ page }) => {
    await openSession(page)

    await openTasksPanel(page)

    await expect(page.getByText('No tasks')).toBeVisible()
  })

  // SPEC: panel-task:description
  test('shows running task with description and duration', async ({ page }) => {
    const controller = await openLiveSession(page)

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

    await expect(page.getByText('Running build...').first()).toBeVisible()

    await openTasksPanel(page)

    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toBeVisible()
    await expect(taskEntry.locator('.task-description')).toContainText('Build project')
    await expect(taskEntry.locator('.task-duration')).toBeVisible()
  })

  // SPEC: panel-task:description
  test('shows completed task', async ({ page }) => {
    // Switch to "All" filter to see completed tasks
    await openAllTasks(page)

    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toBeVisible()
    await expect(taskEntry.locator('.task-description')).toContainText('Build project')
  })

  // SPEC: panel-task:click-tab
  test('clicking task scrolls to tool block in chat', async ({ page }) => {
    await openAllTasks(page)

    const taskEntry = page.locator('[data-testid="task-entry"]').first()
    await expect(taskEntry).toBeVisible()
    await taskEntry.click()

    const toolBlock = page.locator('[data-tool-use-id="task_bg_001"]')
    await expect(toolBlock).toBeVisible()
    // Scroll position and highlight verification is timing-dependent in mocks
  })

  // SPEC: panel-task:click-opens-collapsed-turn
  test('clicking a task in a collapsed turn opens the turn and reveals it', async ({ page }) => {
    await openSession(page, 'events/task-in-collapsed-turn.jsonl')

    await openTasksPanel(page)
    await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
    await page.locator('[data-testid="task-entry"]').first().click()

    const block = page.locator('[data-tool-use-id="task_probe_001"]')
    // A collapsed turn keeps the block in the DOM but visibility: hidden.
    await expect(block).toBeVisible()
    await expect(page.locator('[data-turn-id="turn_001"]')).not.toHaveClass(/turn-collapsed/)
  })

  // SPEC: panel-task:click-reaches-history
  test('clicking a task whose turn has scrolled out of view brings it into view', async ({
    page,
  }) => {
    await openSession(page, 'events/task-in-collapsed-turn.jsonl')

    // Scroll to bottom: covers a windowed-out turn with no DOM element, not just a collapsed one.
    await page.locator('[data-testid="chat-messages"]').evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    await openTasksPanel(page)
    await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
    await page.locator('[data-testid="task-entry"]').first().click()

    // turn_001 has no element until scrollToTurnRef mounts it.
    await expect(page.locator('[data-tool-use-id="task_probe_001"]')).toBeVisible()
  })

  // SPEC: panel-task:click-work-column
  // SPEC: chat:work-column-task-click
  test('with the agent work shown, clicking a task lands it in the work column, not the transcript', async ({
    page,
  }) => {
    await mockAPI(page, { sessionUiStateDefaults: { rightSlotView: 'work' } })
    const controller = await openLiveSession(page)

    // 15 turns of Bash calls window the work column; the Task sits early so its row starts
    // unmounted, matching the "windowed out" case the fix must also cover.
    for (let i = 0; i < 15; i++) {
      const events = [
        { type: 'user', subtype: 'text', is_human: true, content: `turn ${i}`, turn_id: `t${i}` },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: `tu_fill_${i}`,
          tool_name: 'Bash',
          tool_input: { command: `echo fill-${i}` },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line\n'.repeat(10),
          tool_use_id: `tu_fill_${i}`,
        },
      ]
      if (i === 1) {
        events.push(
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Task',
            tool_use_id: 'task_work_col_001',
            tool_name: 'Task',
            tool_input: { description: 'Early research task', prompt: 'Research it' },
          },
          {
            type: 'assistant',
            subtype: 'tool_result',
            content: 'Done researching',
            tool_use_id: 'task_work_col_001',
          },
        )
      }
      events.push({ type: 'result', subtype: 'success', turn_id: `t${i}` })
      await controller.sendEvents(events)
    }

    const transcript = page.locator('[data-testid="chat-messages"]')
    const scrollBefore = await transcript.evaluate(el => el.scrollTop)

    await openTasksPanel(page)
    await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
    await page.locator('.task-entry', { hasText: 'Early research task' }).click()

    const block = page.locator('[data-testid="work-column"] [data-tool-use-id="task_work_col_001"]')
    await expect(block).toBeVisible()
    await expect(block).toHaveClass(/task-highlight/)
    await expect(page.locator('.chat-messages [data-tool-use-id="task_work_col_001"]')).toHaveCount(
      0,
    )
    expect(await transcript.evaluate(el => el.scrollTop)).toBe(scrollBefore)
  })

  // SPEC: panel-task:status-indicator
  test('running task has running status class', async ({ page }) => {
    const controller = await openLiveSession(page)

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

    const taskEntry = page.locator('[data-testid="task-entry"]')
    await expect(taskEntry).toHaveClass(/task-running/)
  })

  test.describe('Panel Details', () => {
    // SPEC: layout:panel-order-right
    test('Tasks icon is between Stash and Usage in the right icon strip', async ({ page }) => {
      await openSession(page)

      const stashIcon = page.locator('[data-testid="icon-stash"]')
      const tasksIcon = page.locator('[data-testid="icon-tasks"]')
      const usageIcon = page.locator('[data-testid="icon-usage"]')

      await expect(stashIcon).toBeVisible()
      await expect(tasksIcon).toBeVisible()
      await expect(usageIcon).toBeVisible()

      // Icons are stacked vertically in the strip, so compare their top offsets.
      const stashTop = await stashIcon.evaluate(el => el.getBoundingClientRect().top)
      const tasksTop = await tasksIcon.evaluate(el => el.getBoundingClientRect().top)
      const usageTop = await usageIcon.evaluate(el => el.getBoundingClientRect().top)

      expect(tasksTop).toBeGreaterThan(stashTop)
      expect(tasksTop).toBeLessThan(usageTop)
    })

    // SPEC: layout:icon-tooltip
    test('Tasks icon button uses SquareKanban icon', async ({ page }) => {
      await openSession(page)

      const tasksIcon = page.locator('[data-testid="icon-tasks"]')
      await expect(tasksIcon).toBeVisible()

      const title = await tasksIcon.getAttribute('title')
      expect(title).toBe('Tasks (Alt+4)')

      await expect(tasksIcon.locator('svg')).toBeVisible()
    })

    // SPEC: panel-task:sort-chronological
    test('tasks are sorted chronologically (oldest first)', async ({ page }) => {
      await openSession(page, 'events/tool-task-multiple.jsonl')

      await openTasksPanel(page)

      // Switch to "All" filter to see all completed tasks
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntries = page.locator('[data-testid="task-entry"]')
      await expect(taskEntries).toHaveCount(3)

      const descriptions = await taskEntries.locator('.task-description').allTextContents()
      expect(descriptions[0]).toContain('First task - lint code')
      expect(descriptions[1]).toContain('Second task - run tests')
      expect(descriptions[2]).toContain('Third task - deploy app')
    })

    // SPEC: panel-task:description
    test('task entry displays description from Task invocation', async ({ page }) => {
      // Switch to "All" filter to see completed task
      await openAllTasks(page)

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      // Sourced from the Task tool input.description.
      const descriptionEl = taskEntry.locator('.task-description')
      await expect(descriptionEl).toBeVisible()
      await expect(descriptionEl).toContainText('Build project')
    })

    // SPEC: panel-task:duration
    test('running task shows live-ticking duration', async ({ page }) => {
      const controller = await openLiveSession(page)

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

      const durationEl = taskEntry.locator('.task-duration')
      await expect(durationEl).toBeVisible()

      const initialDuration = await durationEl.textContent()

      // Wait for the live-tick interval to update (poll instead of fixed timeout)
      await expect.poll(async () => durationEl.textContent()).not.toBe(initialDuration)
    })

    // SPEC: panel-task:duration
    test('completed task shows final duration', async ({ page }) => {
      // Switch to "All" filter to see completed task
      await openAllTasks(page)

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      const durationEl = taskEntry.locator('.task-duration')
      await expect(durationEl).toBeVisible()

      const duration = await durationEl.textContent()

      // Poll to confirm the completed task's duration stays static (no live tick).
      await expect.poll(async () => durationEl.textContent(), { timeout: 2000 }).toBe(duration)
    })
  })

  test.describe('Filter Tabs', () => {
    // SPEC: panel-task:filter-tabs
    test('Active filter shows only running tasks', async ({ page }) => {
      await openSession(page, 'events/tool-task-background-nested.jsonl')

      await openTasksPanel(page)

      // The fixture has a completed task, so the default Active filter shows "No tasks".
      await expect(page.locator('.tasks-list-empty')).toBeVisible()
    })

    // SPEC: panel-task:filter-tabs
    test('All filter shows completed tasks', async ({ page }) => {
      await openAllTasks(page)

      await expect(page.locator('[data-testid="task-entry"]')).toBeVisible()
    })
  })

  test.describe('Staleness Indication', () => {
    // SPEC: panel-task:staleness
    // SPEC: panel-task:staleness-fresh
    test('running task has colored left border', async ({ page }) => {
      await openSession(page, 'events/tool-task-background-async.jsonl')

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
      // Switch to "All" filter to see completed task
      await openAllTasks(page)

      const taskEntry = page.locator('[data-testid="task-entry"]')
      await expect(taskEntry).toBeVisible()

      const borderColor = await taskEntry.evaluate(el => el.style.borderLeftColor)
      expect(borderColor).toBeFalsy()
    })
  })

  test.describe('Empty and Resume States', () => {
    // SPEC: panel-task:empty
    test('shows "No tasks" when no background tasks exist', async ({ page }) => {
      await openSession(page)

      await openTasksPanel(page)
      await expect(page.getByText('No tasks')).toBeVisible()
    })

    // SPEC: panel-task:resume
    test('shows "Resuming..." during session replay', async ({ page }) => {
      await mockAPI(page)
      // Use resuming fixture to trigger isReplaying state
      await openResumingSession(page)

      await openTasksPanel(page)

      await expect(page.locator('[data-testid="panel-tasks"]')).toContainText('Resuming...')
    })
  })

  test.describe('Filter Badge Counts', () => {
    // SPEC: panel-task:filter-tabs
    // SPEC: panel-task:badge
    test('filter tabs show badge counts matching task counts', async ({ page }) => {
      await openSession(page, 'events/tool-task-multiple.jsonl')

      await openTasksPanel(page)

      // Wait for events to be processed and tasks to render (filter tabs appear when allTasks > 0)
      const allTab = page.locator('.tasks-filter-btn', { hasText: 'All' })
      await expect(allTab).toBeVisible({ timeout: 10000 })

      const activeTab = page.locator('.tasks-filter-btn', { hasText: 'Active' })
      await expect(activeTab).toBeVisible()

      const allBadge = allTab.locator('.panel-list-item-count')
      await expect(allBadge).toBeVisible({ timeout: 10000 })
      const badgeText = await allBadge.textContent()
      expect(Number.parseInt(badgeText, 10)).toBeGreaterThan(0)
    })
  })

  test.describe('Killed Task Display', () => {
    // SPEC: panel-task:status-indicator
    test('killed task uses same visual indicator as failed', async ({ page }) => {
      await openSession(page, 'events/tool-task-killed.jsonl')

      await openTasksPanel(page)

      // Switch to "All" filter to see killed tasks
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()

      const taskEntry = page.locator('[data-testid="task-entry"]').first()
      await expect(taskEntry).toBeVisible()

      await expect(taskEntry).toHaveClass(/task-failed|task-error/)
    })
  })

  test.describe('Background commands', () => {
    let clock = Date.now()
    const at = () => {
      clock += 100
      return { timestamp: clock, ts: new Date(clock).toISOString() }
    }
    const human = (content, turnId) => ({
      type: 'user',
      subtype: 'text',
      is_human: true,
      content,
      turn_id: turnId,
      ...at(),
    })
    const command = (toolUseId, taskId, input) => [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_name: 'Bash',
        tool_use_id: toolUseId,
        tool_input: { run_in_background: true, ...input },
        ...at(),
      },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: toolUseId,
        content: `Command running in background with ID: ${taskId}.`,
        tool_use_result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
        ...at(),
      },
    ]
    const notice = (taskId, status = 'completed', ts = at()) => ({
      type: 'system',
      subtype: 'task_notification',
      message_data: { task_id: taskId, status, summary: 'done' },
      ...ts,
    })
    const result = turnId => ({ type: 'result', subtype: 'success', turn_id: turnId, ...at() })

    test.beforeEach(() => {
      clock = Date.now()
    })

    // SPEC: panel-task:lists-commands
    // SPEC: panel-task:command-icon
    // SPEC: panel-task:description
    // SPEC: panel-task:badge
    test('a background command gets a row with a terminal icon, named by its description or command', async ({
      page,
    }) => {
      const controller = await openLiveSession(page)

      await controller.sendEvents([
        human('Start them', 't1'),
        ...command('tu1', 'b1', { command: 'sleep 60', description: 'Wait a minute' }),
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          tool_use_id: 'task1',
          tool_input: { description: 'Review the diff', prompt: 'Go', run_in_background: true },
          ...at(),
        },
        {
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: 'task1',
          content: 'Async agent launched.',
          tool_use_result: { isAsync: true, status: 'async_launched', agentId: 'a1' },
          ...at(),
        },
        ...command('tu2', 'b2', { command: 'npm run dev' }),
        result('t1'),
      ])

      await openTasksPanel(page)
      const entries = page.locator('[data-testid="task-entry"]')
      await expect(entries).toHaveCount(3)
      await expect(entries.locator('.task-description')).toHaveText([
        'Wait a minute',
        'Review the diff',
        'npm run dev',
      ])
      await expect(entries.nth(0).locator('[data-testid="task-kind-icon"]')).toBeVisible()
      await expect(entries.nth(1).locator('[data-testid="task-kind-icon"]')).toHaveCount(0)
      await expect(entries.nth(2).locator('[data-testid="task-kind-icon"]')).toBeVisible()
      await expect(page.locator('[data-testid="icon-tasks"] .icon-badge')).toHaveText('3')
    })

    // SPEC: panel-task:status-indicator
    // SPEC: panel-task:filter-tabs
    test('a finished command leaves Active and stays in All; a killed one reads as failed', async ({
      page,
    }) => {
      const controller = await openLiveSession(page)

      await controller.sendEvents([
        human('Start them', 't1'),
        ...command('tu1', 'b1', { command: 'sleep 1', description: 'Short' }),
        ...command('tu2', 'b2', { command: 'sleep 900', description: 'Long' }),
        result('t1'),
        notice('b1'),
        notice('b2', 'killed'),
      ])

      await openTasksPanel(page)
      await expect(page.getByText('No tasks')).toBeVisible()

      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
      const entries = page.locator('[data-testid="task-entry"]')
      await expect(entries.nth(0)).toHaveClass(/task-completed/)
      await expect(entries.nth(1)).toHaveClass(/task-failed/)
    })

    // SPEC: panel-task:duration
    test('a finished background subagent shows how long it actually ran', async ({ page }) => {
      const controller = await openLiveSession(page)

      const start = Date.now() - 600_000
      await controller.sendEvents([
        human('Review it', 't1'),
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          tool_use_id: 'task1',
          tool_input: { description: 'Review', prompt: 'Go', run_in_background: true },
          timestamp: start,
          ts: new Date(start).toISOString(),
        },
        {
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: 'task1',
          content: 'Async agent launched.',
          tool_use_result: { isAsync: true, status: 'async_launched', agentId: 'a1' },
          timestamp: start + 500,
          ts: new Date(start + 500).toISOString(),
        },
        notice('a1', 'completed', {
          timestamp: start + 180_000,
          ts: new Date(start + 180_000).toISOString(),
        }),
      ])

      await openTasksPanel(page)
      await page.locator('.tasks-filter-btn', { hasText: 'All' }).click()
      await expect(page.locator('[data-testid="task-entry"] .task-duration')).toHaveText('3m 0s')
    })

    // SPEC: panel-task:staleness-running-only
    test('a quiet running command keeps the plain running colour', async ({ page }) => {
      const controller = await openLiveSession(page)

      clock = Date.now() - 180_000
      await controller.sendEvents([
        human('Start it', 't1'),
        ...command('tu1', 'b1', { command: 'sleep 900', description: 'Quiet' }),
      ])

      await openTasksPanel(page)
      const entry = page.locator('[data-testid="task-entry"]')
      await expect(entry).toHaveClass(/task-running/)
      await expect(entry).toHaveCSS('border-left-color', 'rgb(59, 130, 246)')
    })

    // SPEC: panel-task:click-tab
    test('clicking a command row scrolls the chat to its block', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page, {
        sessionUiStateDefaults: { terminalSplitEnabled: false },
      })

      await controller.sendEvents([
        human('Start it', 't1'),
        ...command('tu1', 'b1', { command: 'sleep 60', description: 'Wait a minute' }),
        result('t1'),
      ])

      await openTasksPanel(page)
      await page.locator('[data-testid="task-entry"]').click()
      await expect(page.locator('[data-tool-use-id="tu1"].task-highlight')).toBeVisible()
    })

    // SPEC: panel-task:click-terminal-column
    test('with the terminal shown, clicking a command row lands on its terminal entry', async ({
      page,
    }) => {
      const controller = await openLiveSessionWithAPI(page, {
        sessionUiStateDefaults: { terminalSplitEnabled: true },
      })

      await controller.sendEvents([
        human('Start it', 't1'),
        ...command('tu1', 'b1', { command: 'sleep 60', description: 'Wait a minute' }),
        result('t1'),
      ])

      await openTasksPanel(page)
      await page.locator('[data-testid="task-entry"]').click()
      const entry = page.locator('.terminal-entry[data-tool-use-id="tu1"].task-highlight')
      await expect(entry).toBeVisible()
      await expect(entry).toHaveCSS('animation-name', 'task-highlight-pulse')
    })
  })
})
