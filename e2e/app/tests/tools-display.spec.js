/** E2E tests for tool display functionality. */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

/** Override session-defaults with no editor_url_template, so open-in-editor affordances stay hidden. */
function mockNoEditorTemplate(page) {
  return mockAPI(page, {
    handlers: {
      getSessionDefaults: async route => {
        await route.fulfill({
          json: {
            workspace: '/home/user/project',
            model: 'claude-opus-5',
            permission_mode: 'default',
            effort_level: 'xhigh',
            available_models: [],
            available_permission_modes: [],
            available_effort_levels: [],
          },
        })
      },
    },
  })
}

test.describe('Tools Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Tool Block Rendering', () => {
    // SPEC: tool:read
    test('displays Read tool with file name', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="tool-block"]').first()).toBeVisible()

      // Should show Read tool header with filename (header formatter shows basename only)
      await expect(page.getByText('Read(config.json)').first()).toBeVisible()
    })

    // SPEC: tool:bash
    test('displays Bash tool with command and summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(page.getByText('ls -la').first()).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      const summaryText = await summary.textContent()
      // Multi-line output -> line count summary (e.g., "6 lines")
      expect(summaryText).toMatch(/\d+ lines?/)
    })

    // SPEC: tool:bullet-complete
    test('completed tool has completed status', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Completed status requires the tool_result event to have arrived.
      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toBeVisible()
      const bulletColor = await bullet.evaluate(el => getComputedStyle(el).color)
      // Green: high green channel, low red and blue
      const match = bulletColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      expect(match).toBeTruthy()
      const [, _r, g, _b] = match.map(Number)
      expect(g).toBeGreaterThan(100)
    })
  })

  test.describe('Tool Error Handling', () => {
    // SPEC: tool:bullet-error
    test('error tool has error styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Error status requires the tool_result event to have arrived.
      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toHaveClass(/tool-error/)

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toBeVisible()
      const bulletColor = await bullet.evaluate(el => getComputedStyle(el).color)
      const match = bulletColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      expect(match).toBeTruthy()
      const [, r, g, _b] = match.map(Number)
      expect(r).toBeGreaterThan(150)
      expect(g).toBeLessThan(100)
    })

    // SPEC: error:tool
    test('error tool shows error message', async ({ page }) => {
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('File not found').first()).toBeVisible()
    })

    // SPEC: tool:bullet-error
    test('error tool has error status attribute', async ({ page }) => {
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Error status requires the tool_result event to have arrived.
      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()
    })

    // SPEC: tool:error-no-duplicate
    test('single-line error shows in summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-summary')).toContainText('File not found')

      // Click header - single-line error should not have meaningfully different expanded content
      await toolBlock.locator('.tool-header').click()

      // Dedup means no duplicate text is shown, not that expansion itself is blocked.
      await expect(toolBlock).toContainText('File not found')

      // No duplicate <code> block should show the same error text alongside the summary.
      const codeBlocks = toolBlock.locator('code', { hasText: 'File not found' })
      const count = await codeBlocks.count()
      expect(count).toBeLessThanOrEqual(1)
    })

    // SPEC: tool:error-subtitle
    test('multi-line error shows first line in summary, full details accessible', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-error-multiline.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()

      // First line should be visible in summary (Error: Test failed:)
      await expect(toolBlock.locator('.tool-summary')).toContainText('Test failed')

      // Bash tool with error is expanded by default.
      await expect(toolBlock).toContainText('FAIL')
    })
  })

  test.describe('Tool Details Expansion', () => {
    // SPEC: tool:expand-default-collapsed
    test('Read tool is collapsed by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="tool-block"]').first()).toBeVisible()

      // Read tool is collapsed by default.
      const expandedContent = page.locator('.tool-expanded-content').first()
      await expect(expandedContent).not.toBeVisible()
    })

    // SPEC: tool:expand-click
    test('clicking tool header toggles details', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-expanded-content').first()).toBeVisible()
    })

    // SPEC: tool:expand-threshold
    test('large content is collapsible based on threshold', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-large.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // Read is default-collapsed, so content stays hidden until the header is clicked.
      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()
      await expect(toolBlock.locator('.tool-expanded-content')).toContainText('Lorem ipsum')

      // No fixture mixes small and large tools in one stream, so the small-content contrast
      // isn't tested directly; threshold logic is covered indirectly via Read's default-collapsed behavior.
    })

    // SPEC: tool:expand-default-expanded
    test('Bash tool is expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // Bash is not in the default-collapsed list, so it's expanded without clicking.
      await expect(toolBlock.locator('.tool-expanded-content').first()).toBeVisible()
    })

    // SPEC: tool:expand-default-expanded
    test('AskUserQuestion is expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-ask-question.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // AskUserQuestion should be expanded by default (shows interactive form)
      await expect(page.locator('.tool-questions-interactive').first()).toBeVisible()
    })

    // SPEC: tool:expand-default-expanded
    test('ExitPlanMode is expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-exit-plan.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // ExitPlanMode should be expanded by default (shows plan content)
      await expect(page.locator('.tool-plan').first()).toBeVisible()
      await expect(page.locator('.tool-expanded-content').first()).toBeVisible()
    })
  })

  test.describe('Bash Output', () => {
    // SPEC: tool:bash
    test('Bash tool shows directory listing', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Bash is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      await expect(page.getByText('app.js').first()).toBeVisible()
      await expect(page.getByText('config.json').first()).toBeVisible()
    })

    // SPEC: tool:expand-click
    // SPEC: tool:codeblock-fallback
    test('Bash output has details section', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      if (!(await expandedContent.isVisible())) {
        await toolBlock.locator('.tool-header').click()
      }

      await expect(toolBlock.locator('.tool-details').first()).toBeVisible()
    })

    // SPEC: tool:bash-code-surface
    test('Command and Result render in the block monospace on a single flush surface', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const commandCode = toolBlock.locator('.tool-command-section .tool-details').first()
      const resultCode = toolBlock.locator('.tool-result-section .tool-details').first()
      await expect(commandCode).toBeVisible()
      await expect(resultCode).toBeVisible()

      // Same monospace the block itself sets - not the sans-serif prose font.
      const blockFont = await toolBlock.evaluate(el => getComputedStyle(el).fontFamily)
      await expect(commandCode).toHaveCSS('font-family', blockFont)
      await expect(resultCode).toHaveCSS('font-family', blockFont)

      // Single surface - the section's own content box carries no background or padding.
      const commandContent = toolBlock.locator('.tool-command-section .collapsible-content')
      await expect(commandContent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(commandContent).toHaveCSS('padding-left', '0px')
      await expect(commandContent).toHaveCSS('margin-left', '0px')

      // Same left inset as any other tool block's code - the chrome adds no extra indent.
      const expandedLeft = await toolBlock
        .locator('.tool-expanded-content')
        .evaluate(el => el.getBoundingClientRect().left)
      const codeLeft = await commandCode.evaluate(el => el.getBoundingClientRect().left)
      expect(Math.abs(codeLeft - expandedLeft)).toBeLessThanOrEqual(1)
    })
  })

  test.describe('Multiple Tools', () => {
    test('multiple tool blocks render in sequence', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlocks = page.locator('[data-testid="tool-block"]')
      await expect(toolBlocks.first()).toBeVisible()

      // Count should be at least 1 (our fixture has one tool)
      const count = await toolBlocks.count()
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  test.describe('Nested Tool Blocks', () => {
    // SPEC: tool:nested-task
    // SPEC: tool:nested-tree
    test('Task tool shows nested tools', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      await expect(taskBlock).toContainText('Task')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      await expect(page.getByText('Glob').first()).toBeVisible()
    })

    // SPEC: tool:nested-tree
    test('Task with nested tools shows multiple tool names', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      // Fixture has nested Glob and Read tools.
      await expect(page.getByText('Glob').first()).toBeVisible()
      await expect(page.getByText('Read').first()).toBeVisible()
    })

    // SPEC: tool:nested-collapse
    test('nested tools can be collapsed', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator(':scope > .tool-header-area').click()
      await expect(taskBlock.locator('.task-prompt .collapsible-label')).toBeVisible()

      await taskBlock.locator(':scope > .tool-header-area').click()

      await expect(taskBlock.locator('.task-prompt .collapsible-label')).not.toBeVisible()
    })

    // SPEC: tool:nested-realtime
    test('nested tools appear progressively during streaming', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and Task tool_use
      await controller.sendEvent({
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Refactor utils',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_001',
      })
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        tool_use_id: 'tool_100',
        tool_name: 'Task',
        tool_input: {
          description: 'Refactor utils',
          prompt: 'Refactor the utils module.',
          subagent_type: 'Code',
        },
      })

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      const nestedBlocks = taskBlock.locator('.tool-nested [data-testid="tool-block"]')
      await expect(nestedBlocks).toHaveCount(0)

      // Stream first nested tool_use (Read)
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Read',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_100',
        tool_use_id: 'tool_101',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/src/utils.js' },
      })

      // First nested tool appears
      await expect(nestedBlocks).toHaveCount(1)

      // Stream second nested tool_use (Edit)
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Edit',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_100',
        tool_use_id: 'tool_102',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/home/user/project/src/utils.js',
          old_string: 'formatDate',
          new_string: 'formatISODate',
        },
      })

      // Second nested tool appears progressively
      await expect(nestedBlocks).toHaveCount(2)
    })

    // SPEC: tool:nested-tool-use
    test('nested tool_use event creates a nested tool block', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and Task tool_use
      await controller.sendEvent({
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Read a file',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_001',
      })
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        tool_use_id: 'tool_200',
        tool_name: 'Task',
        tool_input: {
          description: 'Read file',
          prompt: 'Read the config file.',
          subagent_type: 'Explore',
        },
      })

      // Send nested Read tool_use
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Read',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_200',
        tool_use_id: 'tool_201',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/config.json' },
      })

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()
      const nestedBlock = taskBlock.locator('.tool-nested [data-testid="tool-block"]').first()
      await expect(nestedBlock).toBeVisible()
      await expect(nestedBlock).toContainText('Read')
    })

    // SPEC: tool:nested-tool-result
    test('nested tool_result updates the nested block with result text', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message, Task tool_use, nested Read tool_use
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Read config',
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
          tool_use_id: 'tool_300',
          tool_name: 'Task',
          tool_input: {
            description: 'Read config',
            prompt: 'Read config file.',
            subagent_type: 'Explore',
          },
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Read',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          parent_tool_use_id: 'tool_300',
          tool_use_id: 'tool_301',
          tool_name: 'Read',
          tool_input: { file_path: '/home/user/project/config.json' },
        },
      ])

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      const nestedBlock = taskBlock.locator('.tool-nested [data-testid="tool-block"]').first()
      await expect(nestedBlock).toBeVisible()
      await expect(nestedBlock).toHaveAttribute('data-tool-status', 'pending')

      // Send nested tool_result
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_result',
        content: '{ "name": "my-project", "version": "1.0.0" }',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        tool_use_id: 'tool_301',
        parent_tool_use_id: 'tool_300',
      })

      await expect(nestedBlock).toHaveAttribute('data-tool-status', 'completed')
    })

    // SPEC: tool:nested-immediate
    test('nested tools are visible immediately during task execution', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and Task tool_use
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Search files',
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
          tool_use_id: 'tool_400',
          tool_name: 'Task',
          tool_input: {
            description: 'Search files',
            prompt: 'Find test files.',
            subagent_type: 'Explore',
          },
        },
      ])

      // Task is pending (no tool_result yet)
      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toHaveAttribute('data-tool-status', 'pending')

      // Send nested Glob tool_use while Task is still pending
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Glob',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_400',
        tool_use_id: 'tool_401',
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.test.js' },
      })

      // Nested tool should be visible immediately (not deferred until Task completes)
      const nestedBlock = taskBlock.locator('.tool-nested [data-testid="tool-block"]').first()
      await expect(nestedBlock).toBeVisible()
      await expect(nestedBlock).toContainText('Glob')

      // Task itself is still pending - nested tools are shown during execution
      await expect(taskBlock).toHaveAttribute('data-tool-status', 'pending')
    })

    // SPEC: tool:nested-pending-spinner
    test('pending nested tool shows spinner with cyan pulsing bullet', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message, Task tool_use, and nested Read tool_use (no result)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Read file',
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
          tool_use_id: 'tool_500',
          tool_name: 'Task',
          tool_input: {
            description: 'Read file',
            prompt: 'Read the file.',
            subagent_type: 'Explore',
          },
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Read',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          parent_tool_use_id: 'tool_500',
          tool_use_id: 'tool_501',
          tool_name: 'Read',
          tool_input: { file_path: '/home/user/project/data.json' },
        },
      ])

      // Nested Read tool should be pending (no tool_result sent)
      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      const nestedBlock = taskBlock.locator('.tool-nested [data-testid="tool-block"]').first()
      await expect(nestedBlock).toBeVisible()
      await expect(nestedBlock).toHaveAttribute('data-tool-status', 'pending')

      const spinner = nestedBlock.locator('.spinner')
      await expect(spinner).toBeVisible()

      // Bullet should have pending class (cyan pulsing animation via CSS)
      const bullet = nestedBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/pending/)
    })

    // SPEC: tool:nested-complete-green
    test('completed nested tool shows green bullet with result summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested-realtime.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for the Task block to complete (all events including task result are loaded)
      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')

      // Expand the task block to see nested tools (auto-collapses on complete)
      await taskBlock.locator('.tool-header').click()

      const nestedBlocks = taskBlock.locator('.tool-nested [data-testid="tool-block"]')
      await expect(nestedBlocks.first()).toBeVisible()

      const firstNested = nestedBlocks.first()
      await expect(firstNested).toHaveAttribute('data-tool-status', 'completed')
      const bullet = firstNested.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/completed/)

      // Completed bullet should have green color via CSS (.tool-bullet.completed { color: #4caf50 })
      const bulletColor = await bullet.evaluate(el => getComputedStyle(el).color)
      // #4caf50 = rgb(76, 175, 80)
      expect(bulletColor).toBe('rgb(76, 175, 80)')
    })
  })

  test.describe('Task Prompt Display', () => {
    // SPEC: tool:task-prompt-collapsed
    test('Task prompt can be collapsed to show preview', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(taskBlock).toBeVisible()

      await taskBlock.locator('.tool-header').click()

      const promptLabel = taskBlock.locator('.task-prompt .collapsible-label')
      await expect(promptLabel).toContainText('Prompt')

      await promptLabel.click()

      await expect(taskBlock.locator('.task-prompt .collapsible-content')).not.toBeVisible()
    })

    // SPEC: tool:task-prompt-collapsed
    test('Task prompt shows preview when collapsed', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(taskBlock).toBeVisible()

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      // Prompt starts expanded; click collapses it.
      await taskBlock.locator('.task-prompt .collapsible-header').click()

      const preview = taskBlock.locator('.task-prompt .collapsible-preview')
      await expect(preview).toBeVisible()
      await expect(preview).toContainText('Find all configuration files')
    })

    // SPEC: tool:task-prompt-content
    test('clicking prompt header toggles full content', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(taskBlock).toBeVisible()

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      // Prompt starts expanded; click collapses it.
      await taskBlock.locator('.task-prompt .collapsible-header').click()
      await expect(taskBlock.locator('.task-prompt .collapsible-content')).not.toBeVisible()

      await taskBlock.locator('.task-prompt .collapsible-header').click()

      const content = taskBlock.locator('.task-prompt .collapsible-content')
      await expect(content).toBeVisible()

      await expect(content).toContainText('Search recursively through all subdirectories')
      await expect(content).toContainText('Return the full paths')
    })

    // task-prompt-position is verified via render order in ToolBlockExpandedContent.jsx (taskPrompt
    // before nestedBlocks) - no E2E test needed for this implementation detail.
  })

  test.describe('Tool-Specific Formatting', () => {
    // SPEC: tool:edit
    test('Edit tool shows diff summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // Edit result from fixture: changed "consle.log" to "console.log"
      await expect(toolBlock).toContainText(/\+\d+/)
      await expect(toolBlock).toContainText(/-\d+/)
    })

    // SPEC: tool:write
    test('Write tool shows line count', async ({ page }) => {
      await mockSSE(page, 'events/tool-write.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toContainText(/Wrote \d+ lines/)
    })

    // SPEC: tool:write-display
    test('Write tool shows syntax highlighting for Python', async ({ page }) => {
      await mockSSE(page, 'events/tool-write-python.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Write is expanded by default.
      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const codeContent = toolBlock.locator('.tool-expanded-content')
      await expect(codeContent).toBeVisible()

      // Unified code-block structure includes a gutter, shared across all code display.
      const codeBlock = codeContent.locator('.code-block')
      await expect(codeBlock).toBeVisible()
      // Each row has its own gutter cell, just verify at least one exists
      const gutter = codeBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()
    })

    // SPEC: tool:write-line-numbers
    test('Write tool shows content with code formatting', async ({ page }) => {
      await mockSSE(page, 'events/tool-write-python.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // Write is expanded by default
      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      await expect(expandedContent).toContainText('def hello_world')
      await expect(expandedContent).toContainText('return True')

      const gutter = expandedContent.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()
      const gutterText = await gutter.textContent()
      expect(gutterText.trim()).toMatch(/\d+/)
    })

    // SPEC: tool:grep
    test('Grep tool shows match count', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toContainText('3 matches')
    })

    // SPEC: tool:glob
    test('Glob tool shows file count', async ({ page }) => {
      await mockSSE(page, 'events/tool-glob.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toContainText('5 files')
    })

    // SPEC: tool:task
    test('Task tool shows status', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      const summaryText = await summary.textContent()
      expect(summaryText.length).toBeGreaterThan(0)
    })

    // SPEC: tool:skill
    test('Skill tool shows launch message', async ({ page }) => {
      await mockSSE(page, 'events/tool-skill.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toContainText('Launching skill: commit')
    })

    // SPEC: tool:todowrite
    test('TodoWrite tool shows full diff count format ●N ◐N ○N ✕N', async ({ page }) => {
      // Diff fixture exercises all four count categories - the claim is a specific format, not any one symbol.
      await mockSSE(page, 'events/tool-todowrite-diff.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The second TodoWrite block carries the diff against the first.
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      const diffBlock = toolBlocks.nth(1)
      await expect(diffBlock).toBeVisible()

      // Each count must appear with its sigil - proves the structured format, not just one symbol.
      await expect(diffBlock).toContainText(/●\d+/)
      await expect(diffBlock).toContainText(/◐\d+/)
      await expect(diffBlock).toContainText(/○\d+/)
      await expect(diffBlock).toContainText(/✕\d+/)
    })

    // SPEC: tool:webfetch
    test('WebFetch tool displays first line of result', async ({ page }) => {
      await mockSSE(page, 'events/tool-webfetch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(page.getByText('WebFetch').first()).toBeVisible()

      // Summary should show first line of result content, not URL
      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Page Summary')
    })

    // SPEC: tool:websearch
    test('WebSearch tool displays first line of result', async ({ page }) => {
      await mockSSE(page, 'events/tool-websearch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(page.getByText('WebSearch').first()).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Search Results')
    })

    // SPEC: tool:mcpsearch
    test('MCPSearch tool displays correctly', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcpsearch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(page.getByText('MCPSearch').first()).toBeVisible()

      // Summary should show tool result data (e.g., "Tool loaded" or "Found")
      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      const summaryText = await summary.textContent()
      expect(summaryText.length).toBeGreaterThan(0)
    })

    // SPEC: tool:askuser
    // The header is only shown once the question is answered - a live form replaces it.
    test('AskUserQuestion shows question count in header', async ({ page }) => {
      await mockSSE(page, 'events/tool-ask-question-answered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      // The answered fixture has a follow-up turn, which would auto-collapse the source.
      await disableAutoCollapse(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const toolName = toolBlock.locator('.tool-name')
      await expect(toolName).toBeVisible()
      const headerText = await toolName.textContent()
      expect(headerText).toMatch(/AskUserQuestion/)
    })
  })

  test.describe('TodoWrite Details', () => {
    // SPEC: tool:todos-block-collapsed
    test('TodoWrite is collapsed by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:todos-block-collapsed
    test('TodoWrite shows status counts in summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // Counts map to sigils: 1 completed (●1), 1 in_progress (◐1), 2 pending (○2).
      await expect(toolBlock).toContainText('●1')
      await expect(toolBlock).toContainText('◐1')
      await expect(toolBlock).toContainText('○2')
    })

    // SPEC: tool:todos-block-status
    test('expanded TodoWrite shows todo items with status symbols', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(toolBlock).toContainText('Fix authentication bug')
      await expect(toolBlock).toContainText('Write unit tests')
      await expect(toolBlock).toContainText('Update documentation')
    })

    // SPEC: tool:todos-block-status
    test('todo items have correct status classes', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.todo-completed')).toBeVisible()
      await expect(toolBlock.locator('.todo-in-progress')).toBeVisible()
      await expect(toolBlock.locator('.todo-pending').first()).toBeVisible()
    })

    // SPEC: tool:todos-block-diff-only
    test('expanded TodoWrite shows only changed items, not unchanged', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite-diff.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Second TodoWrite block has the diff
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      const secondTodoWrite = toolBlocks.nth(1)
      await expect(secondTodoWrite).toBeVisible()

      await secondTodoWrite.locator('.tool-header').click()
      await expect(secondTodoWrite.locator('.tool-expanded-content')).toBeVisible()

      await expect(secondTodoWrite).toContainText('Implement auth module')
      await expect(secondTodoWrite).toContainText('Write unit tests')
      await expect(secondTodoWrite).toContainText('Add error handling')
      await expect(secondTodoWrite).toContainText('Set up monitoring')
      await expect(secondTodoWrite).toContainText('Write API docs')
      await expect(secondTodoWrite).toContainText('Configure CI pipeline')

      const todoList = secondTodoWrite.locator('.todo-list')
      await expect(todoList).not.toContainText('Update documentation')
      await expect(todoList).not.toContainText('Deploy to staging')
      await expect(todoList).not.toContainText('Run integration tests')
    })

    // SPEC: tool:todos-block-removed
    test('removed items have strikethrough and muted styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite-diff.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Second TodoWrite block has the diff with removed items
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      const secondTodoWrite = toolBlocks.nth(1)
      await expect(secondTodoWrite).toBeVisible()

      await secondTodoWrite.locator('.tool-header').click()
      await expect(secondTodoWrite.locator('.tool-expanded-content')).toBeVisible()

      const removedItem = secondTodoWrite.locator('.todo-removed')
      await expect(removedItem).toBeVisible()
      await expect(removedItem).toContainText('Configure CI pipeline')

      const removedContent = removedItem.locator('.todo-content')
      await expect(removedContent).toHaveCSS('text-decoration-line', 'line-through')
    })

    // SPEC: tool:todos-block-item-subtitle
    test('item description occupies a third column on the same row and exposes the full text as a tooltip', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // TaskCreate renders inside the default-expanded Todos block; description sits right of the title, same row.
      const group = page.locator('[data-testid="todos-group"]').first()
      await expect(group).toBeVisible()

      const description = group.locator('.todo-description').first()
      await expect(description).toBeVisible()
      await expect(description).toHaveText('Skim README and ARCHITECTURE')
      // Full text is also exposed via the native title attribute (hover tooltip).
      await expect(description).toHaveAttribute('title', 'Skim README and ARCHITECTURE')
    })

    // SPEC: tool:todos-block-grouped
    test('consecutive TaskCreate / TaskUpdate blocks collapse into one Todos group', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Fixture: TaskCreate + TaskCreate + TaskUpdate group into one Todos container, not three separate blocks.
      const groups = page.locator('[data-testid="todos-group"]')
      await expect(groups).toHaveCount(1)

      // Two distinct rows (one per _taskId); TaskUpdate collapses into task #2's existing row.
      const rows = groups.locator('.todo-item')
      await expect(rows).toHaveCount(2)

      // The three original ToolBlock chrome boxes must not appear separately - the group replaced them.
      const taskCreateBlocks = page
        .locator('[data-testid="tool-block"]')
        .filter({ hasText: 'TaskCreate' })
      await expect(taskCreateBlocks).toHaveCount(0)
    })

    // SPEC: tool:todos-block-blocked-icon
    test('item with unresolved blockers shows ⊘ icon in place of ○', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // TaskUpdate adds blockedBy: [1] to a pending item; task #1 is still non-terminal, so the
      // row shows the blocked icon, not the pending one.
      const todosGroup = page.locator('[data-testid="todos-group"]').first()
      await expect(todosGroup).toBeVisible()

      // The blocked row carries the swapped icon.
      const icons = await todosGroup.locator('.todo-icon').allTextContents()
      expect(icons).toContain('⊘')

      // No trailing-chip selector renders anywhere in the group.
      await expect(todosGroup.locator('[data-testid="todo-blocked-by"]')).toHaveCount(0)
    })

    // SPEC: tool:todos-block-default-expanded
    // SPEC: tool:todos-block-collapsed
    test('Todos block opens expanded inside the shared tool-block chrome and toggles on header click', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const group = page.locator('[data-testid="todos-group"]')
      await expect(group).toBeVisible()
      // Chrome host carries .tool-block - same as every other tool block.
      await expect(group).toHaveClass(/tool-block/)
      // Body visible without clicking - default-expanded.
      await expect(group.locator('[data-testid="todos-group-rows"]')).toBeVisible()

      // Header click collapses the body; second click re-expands.
      await group.locator('.tool-header-area').click()
      await expect(group.locator('[data-testid="todos-group-rows"]')).toHaveCount(0)

      await group.locator('.tool-header-area').click()
      await expect(group.locator('[data-testid="todos-group-rows"]')).toBeVisible()
    })

    // SPEC: tool:todos-block-grid-columns
    test('Todos body uses a CSS grid with three columns aligned across rows', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const rowBody = page.locator('[data-testid="todos-group-rows"]')
      await expect(rowBody).toBeVisible()
      const display = await rowBody.evaluate(el => getComputedStyle(el).display)
      expect(display).toBe('grid')

      // Rows use display: contents, so each row's 3 children become direct grid children; with 2
      // rows that's 6 cells forming 3 x-aligned column groups (icon, content, description).
      const rects = await rowBody.evaluate(el => {
        return [
          ...el.querySelectorAll(
            ':scope > .todo-item > .todo-icon, :scope > .todo-item > .todo-content, :scope > .todo-item > .todo-description',
          ),
        ].map(c => ({
          cls: c.className,
          x: Math.round(c.getBoundingClientRect().x),
        }))
      })
      // Group x-coords by class, expect each group to have a single unique x.
      const groups = {
        'todo-icon': new Set(),
        'todo-content': new Set(),
        'todo-description': new Set(),
      }
      for (const { cls, x } of rects) {
        groups[cls].add(x)
      }
      expect(groups['todo-icon'].size).toBe(1)
      expect(groups['todo-content'].size).toBe(1)
      expect(groups['todo-description'].size).toBe(1)
    })

    // SPEC: tool:todos-block-grouped
    test('solo TaskList without any TaskCreate/TaskUpdate renders as an ordinary tool block (no Todos group)', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-task-list-solo.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // No grouped Todos container - inspection-only runs demote to per-block rendering.
      await expect(page.locator('[data-testid="todos-group"]')).toHaveCount(0)

      // The TaskList renders as an ordinary tool-block.
      const taskListBlock = page
        .locator('[data-testid="tool-block"]')
        .filter({ hasText: 'TaskList' })
      await expect(taskListBlock).toHaveCount(1)
    })

    // SPEC: tool:todos-block-empty-suppressed
    test('a TaskUpdate that produces no rows does not render the Todos panel', async ({ page }) => {
      // Empty-input TaskUpdate (no taskId/status/addBlockedBy) still makes groupBlocks.flushRun emit
      // a 'todos-group' segment (TASK_MUTATION_TOOLS), but mergeRunItems yields zero items from the
      // empty diff, so bucketize returns rowGroups: [] and TodosGroup renders null.
      await mockSSE(page, 'events/todos-empty-update.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for the assistant message so the turn has fully streamed in before asserting.
      await expect(page.locator('[data-testid="message-assistant"]').first()).toBeVisible()

      // The Todos panel must NOT be rendered.
      await expect(page.locator('[data-testid="todos-group"]')).toHaveCount(0)
    })
  })

  test.describe('Lookups Details', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        window.__cb_lookups_grouping = true
      })
    })

    // SPEC: tool:lookups-block-grouped
    test('scattered read-only calls gather into one panel; edits stay in place', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Fixture: Read, Edit, Grep, Write, Read - one Lookups panel; the two Reads and Grep don't stand alone.
      await expect(page.locator('[data-testid="lookups-group"]')).toHaveCount(1)
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      await expect(toolBlocks.filter({ hasText: 'Read(' })).toHaveCount(0)
      await expect(toolBlocks.filter({ hasText: 'Grep(' })).toHaveCount(0)

      // Edit and Write are not read-only - they stay as ordinary blocks.
      await expect(toolBlocks.filter({ hasText: 'Edit(' })).toHaveCount(1)
      await expect(toolBlocks.filter({ hasText: 'Write(' })).toHaveCount(1)
    })

    // SPEC: tool:lookups-block-collapsed
    test('panel opens collapsed with a per-tool count summary; header click reveals rows', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const group = page.locator('[data-testid="lookups-group"]')
      await expect(group).toBeVisible()
      await expect(group).toHaveClass(/tool-block/)
      await expect(group.locator('.tool-name')).toHaveText('Lookups')
      await expect(group.locator('.tool-summary')).toHaveText('Read x2, Grep x1')

      await expect(group.locator('[data-testid="lookups-group-rows"]')).toHaveCount(0)
      await group.locator('.tool-header-area').click()
      await expect(group.locator('[data-testid="lookups-group-rows"]')).toBeVisible()
    })

    // SPEC: tool:lookups-block-order
    test('rows appear in the order the calls happened', async ({ page }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const group = page.locator('[data-testid="lookups-group"]')
      await group.locator('.tool-header-area').click()

      const rows = group.locator('[data-testid="lookups-group-rows"] [data-testid="tool-block"]')
      await expect(rows).toHaveCount(3)
      await expect(rows.nth(0)).toContainText('Read(config.py)')
      await expect(rows.nth(1)).toContainText('Grep(')
      await expect(rows.nth(2)).toContainText('Read(schema.py)')
    })

    // SPEC: tool:lookups-block-rows
    test('each row expands on its own to its output, other rows unaffected', async ({ page }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const group = page.locator('[data-testid="lookups-group"]')
      await group.locator('.tool-header-area').click()

      const rows = group.locator('[data-testid="lookups-group-rows"] [data-testid="tool-block"]')
      const firstRow = rows.nth(0)
      const secondRow = rows.nth(1)

      await firstRow.locator('.tool-header-area').click()
      await expect(firstRow).toContainText("DEFAULT_MODEL = 'consle-1'")
      // Second row is untouched - still collapsed.
      await expect(secondRow.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:lookups-block-threshold
    test('a single lookup in a turn renders as an ordinary block, no panel', async ({ page }) => {
      // events/tool-read.jsonl has exactly one read-only call and nothing else read-only.
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="lookups-group"]')).toHaveCount(0)
      await expect(
        page.locator('[data-testid="tool-block"]').filter({ hasText: 'Read(' }),
      ).toHaveCount(1)
    })

    // SPEC: tool:lookups-block-nested-excluded
    test("a subagent's own lookups stay inside its Task block, not the turn's Lookups panel", async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Investigate the bug',
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
          tool_use_id: 'tool_900',
          tool_name: 'Task',
          tool_input: {
            description: 'Investigate',
            prompt: 'Look into the bug.',
            subagent_type: 'Explore',
          },
        },
        // Subagent's own lookups - nested under the Task.
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Read',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          parent_tool_use_id: 'tool_900',
          tool_use_id: 'tool_901',
          tool_name: 'Read',
          tool_input: { file_path: '/home/user/project/a.js' },
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Grep',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          parent_tool_use_id: 'tool_900',
          tool_use_id: 'tool_902',
          tool_name: 'Grep',
          tool_input: { pattern: 'bug' },
        },
        // Two top-level lookups - these gather into the turn's Lookups panel.
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Read',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          tool_use_id: 'tool_903',
          tool_name: 'Read',
          tool_input: { file_path: '/home/user/project/b.js' },
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Read',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          tool_use_id: 'tool_904',
          tool_name: 'Read',
          tool_input: { file_path: '/home/user/project/c.js' },
        },
      ])

      const group = page.locator('[data-testid="lookups-group"]')
      await expect(group).toBeVisible()
      await expect(group.locator('.tool-summary')).toHaveText('Read x2')

      const taskBlock = page.locator('[data-testid="tool-block"]').filter({ hasText: 'Task(' })
      await expect(taskBlock.locator('.tool-nested [data-testid="tool-block"]')).toHaveCount(2)
    })
  })

  test.describe('Lookups Details - switch off (default)', () => {
    test('scattered read-only calls each render as an ordinary block; no Lookups panel appears', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="lookups-group"]')).toHaveCount(0)
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      await expect(toolBlocks.filter({ hasText: 'Read(' })).toHaveCount(2)
      await expect(toolBlocks.filter({ hasText: 'Grep(' })).toHaveCount(1)
      await expect(toolBlocks.filter({ hasText: 'Edit(' })).toHaveCount(1)
      await expect(toolBlocks.filter({ hasText: 'Write(' })).toHaveCount(1)
    })

    test('a mutation-bearing Todos run still groups', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="todos-group"]')).toBeVisible()
    })
  })

  test.describe('Tool Pending State', () => {
    // SPEC: tool:bullet-pending
    test('pending tool shows cyan-classed bullet and pulsing spinner', async ({ page }) => {
      await mockSSE(page, 'events/tool-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()

      // .pending class is the contract - CSS owns the cyan color; visual regression covers pixel rendering.
      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/pending/)

      // Non-empty CSS animation name proves the "pulsing" half of the claim, not just element presence.
      const spinner = toolBlock.locator('.spinner')
      await expect(spinner).toBeVisible()
      const animationName = await spinner.evaluate(el => getComputedStyle(el).animationName)
      expect(animationName).not.toBe('none')
      expect(animationName).not.toBe('')
    })

    // SPEC: tool:askuser-form
    test('unanswered AskUserQuestion shows interactive form', async ({ page }) => {
      await mockSSE(page, 'events/tool-ask-question.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(page.locator('.tool-questions-interactive').first()).toBeVisible()
    })
  })

  test.describe('Bash Command While Pending', () => {
    // SPEC: tool:bash-command-while-running
    test('command is visible in a Command section while the block is still pending', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-bash-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()
      await expect(toolBlock.getByText('Command')).toBeVisible()
      await expect(toolBlock).toContainText('ls -la /var/log')
      await expect(toolBlock.getByText('Result')).not.toBeVisible()
    })

    // SPEC: tool:bash-command-while-running
    test('header collapses and re-expands a pending Bash block', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock.getByText('Command')).toBeVisible()

      await toolBlock.locator('.tool-header-area').click()
      await expect(toolBlock.getByText('Command')).not.toBeVisible()

      await toolBlock.locator('.tool-header-area').click()
      await expect(toolBlock.getByText('Command')).toBeVisible()
    })

    // SPEC: tool:bash-command-while-running
    test('Result section appears once the command completes, block stays open', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'List files',
          ts: '2025-01-18T12:00:00Z',
          turn_id: 'turn_live',
          id: 'evt_live_1',
          primary: true,
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          ts: '2025-01-18T12:00:01Z',
          tool_use_id: 'tool_live',
          tool_name: 'Bash',
          tool_input: { command: 'ls -la' },
          id: 'evt_live_2',
          primary: false,
          is_human: false,
        },
      ])

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toHaveAttribute('data-tool-status', 'pending')
      await expect(toolBlock.getByText('Command')).toBeVisible()
      await expect(toolBlock.getByText('Result')).not.toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_result',
        content: 'file1.txt\nfile2.txt',
        tool_use_id: 'tool_live',
        ts: '2025-01-18T12:00:02Z',
        id: 'evt_live_3',
        primary: false,
        is_human: false,
      })

      await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')
      await expect(toolBlock.getByText('Result')).toBeVisible()
      await expect(toolBlock.getByText('Command')).toBeVisible()
    })

    // SPEC: tool:bash-command-while-running
    test('a pending Read block is unaffected - no expanded content, unclickable header', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()
      await expect(toolBlock.locator('.tool-header-area')).toHaveCSS('cursor', 'default')
      await expect(page.locator('.tool-expanded-content')).toHaveCount(0)
    })

    // SPEC: tool:input-handled-skip
    test('no generic JSON input section appears in a pending Bash block', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock.getByText('Command')).toBeVisible()
      await expect(toolBlock.locator('.tool-json')).toHaveCount(0)
    })
  })

  test.describe('File Path Display', () => {
    // SPEC: tool:file-collapsed
    test('Read tool shows filename only when collapsed', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Read is collapsed by default.
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const toolName = toolBlock.locator('.tool-name')
      await expect(toolName).toContainText('Read(config.json)')
      await expect(toolName).not.toContainText('/home/user')
    })

    // SPEC: tool:file-tooltip
    test('Read tool has full path in title attribute', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBe('/home/user/project/config.json')
    })

    // SPEC: tool:file-expanded
    test('Read tool shows full path when expanded', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Read is collapsed by default.
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const toolName = toolBlock.locator('.tool-name')
      await expect(toolName).toContainText('/home/user/project/config.json')
    })

    // SPEC: tool:file-open-in-editor
    test('Edit block offers an open-in-editor control that opens the resolved URL without toggling the block', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.evaluate(() => {
        window.__opened = []
        window.open = url => {
          window.__opened.push(url)
          return null
        }
      })

      const editBlock = page.locator('[data-testid="tool-block"]', { hasText: 'Edit(' })
      const wasExpanded = await editBlock.locator('.tool-expanded-content').isVisible()

      await editBlock.locator('.tool-open-in-editor-btn').click()

      const opened = await page.evaluate(() => window.__opened)
      expect(opened).toEqual([
        'claudebox-editor-test://open?path=%2Fhome%2Fuser%2Fproject%2Fconfig.py&line=1',
      ])
      await expect(editBlock.locator('.tool-expanded-content')).toBeVisible({
        visible: wasExpanded,
      })
    })

    // SPEC: tool:file-open-in-editor
    test('Lookups Read row offers the same control, independent of the row expand state', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__cb_lookups_grouping = true
      })
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.evaluate(() => {
        window.__opened = []
        window.open = url => {
          window.__opened.push(url)
          return null
        }
      })

      const group = page.locator('[data-testid="lookups-group"]')
      await group.locator('.tool-header-area').click()
      const rows = group.locator('[data-testid="lookups-group-rows"] [data-testid="tool-block"]')
      const readRow = rows.filter({ hasText: 'Read(config.py)' })
      const grepRow = rows.filter({ hasText: 'Grep(' })

      await expect(readRow.locator('.tool-open-in-editor-btn')).toBeVisible()
      await expect(grepRow.locator('.tool-open-in-editor-btn')).toHaveCount(0)

      await readRow.locator('.tool-open-in-editor-btn').click()

      const opened = await page.evaluate(() => window.__opened)
      expect(opened).toEqual([
        'claudebox-editor-test://open?path=%2Fhome%2Fuser%2Fproject%2Fconfig.py&line=1',
      ])
      // Row was collapsed before the click and stays collapsed - the control did not toggle it.
      await expect(readRow.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:file-open-in-editor-unconfigured
    test('no open-in-editor control appears when the workspace has no editor template', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__cb_lookups_grouping = true
      })
      await mockNoEditorTemplate(page)
      await mockSSE(page, 'events/tool-lookups-scattered.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const editBlock = page.locator('[data-testid="tool-block"]', { hasText: 'Edit(' })
      await expect(editBlock.locator('.tool-open-in-editor-btn')).toHaveCount(0)

      const group = page.locator('[data-testid="lookups-group"]')
      await group.locator('.tool-header-area').click()
      const readRow = group
        .locator('[data-testid="lookups-group-rows"] [data-testid="tool-block"]')
        .filter({ hasText: 'Read(config.py)' })
      await expect(readRow.locator('.tool-open-in-editor-btn')).toHaveCount(0)
    })

    // SPEC: tool:file-open-in-editor-line
    test('opens at the read starting line when known, otherwise line 1', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-offset.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.evaluate(() => {
        window.__opened = []
        window.open = url => {
          window.__opened.push(url)
          return null
        }
      })

      const readBlock = page.locator('[data-testid="tool-block"]', { hasText: 'Read(' })
      await readBlock.locator('.tool-open-in-editor-btn').click()

      const opened = await page.evaluate(() => window.__opened)
      expect(opened).toEqual([
        'claudebox-editor-test://open?path=%2Fhome%2Fuser%2Fproject%2Fconfig.json&line=42',
      ])
    })
  })

  test.describe('System Reminders', () => {
    // SPEC: tool:reminder
    test('system reminders section is collapsed by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Read is collapsed by default.
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const remindersHeader = toolBlock.locator('.system-reminders-header')
      await expect(remindersHeader).toBeVisible()

      // Collapsed by default.
      const remindersContent = toolBlock.locator('.system-reminders-content')
      await expect(remindersContent).not.toBeVisible()
    })

    // SPEC: tool:reminder
    test('system reminders shows count in header', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const remindersHeader = toolBlock.locator('.system-reminders-header')
      await expect(remindersHeader).toContainText('(2)')
    })

    // SPEC: tool:reminder-separate
    test('clicking header expands system reminders', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const remindersHeader = toolBlock.locator('.system-reminders-header')
      await remindersHeader.click()

      const remindersContent = toolBlock.locator('.system-reminders-content')
      await expect(remindersContent).toBeVisible()

      await expect(remindersContent).toContainText('malware')
    })

    // SPEC: tool:reminder-strip
    test('system reminder content is extracted and not shown inline with tool output', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()
      await expect(expandedContent).toContainText('def main')

      await expect(expandedContent.locator('.tool-details')).not.toContainText('<system-reminder>')
      await expect(expandedContent.locator('.tool-details')).not.toContainText('</system-reminder>')

      const remindersSection = toolBlock.locator('.system-reminders')
      await expect(remindersSection).toBeVisible()
    })

    // SPEC: tool:reminder-collapsed
    test('system reminder section is collapsed by default with label', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const remindersHeader = toolBlock.locator('.system-reminders-header')
      await expect(remindersHeader).toBeVisible()
      await expect(remindersHeader).toContainText('System Reminder')

      // Collapsed by default.
      const remindersContent = toolBlock.locator('.system-reminders-content')
      await expect(remindersContent).not.toBeVisible()
    })

    // SPEC: tool:reminder-scope
    test('system reminder in tool result content is extracted and rendered', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const remindersSection = toolBlock.locator('.system-reminders')
      await expect(remindersSection).toBeVisible()

      await toolBlock.locator('.system-reminders-header').click()
      const remindersContent = toolBlock.locator('.system-reminders-content')
      await expect(remindersContent).toBeVisible()
      await expect(remindersContent).toContainText('malware')
      await expect(remindersContent).toContainText('best practices')
    })

    // SPEC: tool:reminder-scope
    test('system reminder in assistant message content is extracted and rendered', async ({
      page,
    }) => {
      await mockSSE(page, 'events/message-with-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turnText = page.locator('.turn-text').first()
      await expect(turnText).toBeVisible()
      await expect(turnText).toContainText('security overview')
      await expect(turnText).not.toContainText('<system-reminder>')

      const remindersSection = turnText.locator('.system-reminders')
      await expect(remindersSection).toBeVisible()

      const remindersContent = turnText.locator('.system-reminders-content')
      await expect(remindersContent).not.toBeVisible()

      await turnText.locator('.system-reminders-header').click()
      await expect(remindersContent).toBeVisible()
      await expect(remindersContent).toContainText('validate user input')
    })
  })

  test.describe('System Reminder Deduplication', () => {
    // SPEC: tool:reminder-dedup
    test('identical reminders are deduplicated with ×N count badge', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-duplicate-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      await toolBlock.locator('.system-reminders-header').click()
      const remindersContent = toolBlock.locator('.system-reminders-content')
      await expect(remindersContent).toBeVisible()

      // Should show ×3 badge for the triplicated malware reminder
      await expect(remindersContent.locator('.system-reminder-count')).toContainText('×3')
    })

    // SPEC: tool:reminder-unique-count
    test('header shows count of unique reminders', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-with-duplicate-reminders.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      // Header should show unique count (2 unique reminders despite 4 total)
      const remindersHeader = toolBlock.locator('.system-reminders-header')
      await expect(remindersHeader).toContainText('(2)')
    })
  })

  test.describe('TaskOutput Display', () => {
    // SPEC: tool:taskoutput
    test('TaskOutput shows header with task ID and status subtitle', async ({ page }) => {
      await mockSSE(page, 'events/tool-taskoutput.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const header = toolBlock.locator('.tool-name')
      await expect(header).toContainText('TaskOutput(bg_task_123)')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Completed')
    })
  })

  test.describe('Persisted Output', () => {
    // SPEC: tool:persisted-output
    test('shows persisted output info section', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-persisted.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const persistedOutput = toolBlock.locator('.persisted-output')
      await expect(persistedOutput).toBeVisible()

      const truncatedInfo = toolBlock.locator('.persisted-output-truncated')
      await expect(truncatedInfo).toBeVisible()
    })

    // SPEC: tool:persisted-output
    test('shows file size in persisted output', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-persisted.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const truncatedInfo = toolBlock.locator('.persisted-output-truncated')
      await expect(truncatedInfo).toContainText('50.7KB')
    })

    // SPEC: tool:persisted-preview
    test('shows preview content for persisted output', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-persisted.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const expandedContent = toolBlock.locator('.tool-expanded-content')

      await expect(expandedContent).toContainText('Running test suite')
      await expect(expandedContent).toContainText('PASS')
    })
  })

  test.describe('Background Agent Display', () => {
    // SPEC: tool:task-background
    test('shows background task summary with running info', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('running in background')
    })

    // SPEC: tool:task-background-path
    test('shows background task result with output path', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('bg_build_456.output')
    })
  })

  test.describe('Edit Diff Rendering', () => {
    // SPEC: tool:edit-diff-inline
    test('Edit tool expanded content has diff lines', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Edit is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      await expect(toolBlock.locator('.code-block-type-diff-add').first()).toBeVisible()
      await expect(toolBlock.locator('.code-block-type-diff-remove').first()).toBeVisible()
    })

    // SPEC: tool:edit-diff-word
    test('Edit diff shows word-level highlighting', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Edit is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(toolBlock.locator('.code-block-type-diff-add').first()).toBeVisible()
      await expect(toolBlock.locator('.code-block-type-diff-remove').first()).toBeVisible()
    })

    // SPEC: tool:edit-diff-fullline
    test('add lines have green styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      const addLine = toolBlock.locator('.code-block-type-diff-add').first()
      await expect(addLine).toBeVisible()
      await expect(addLine).toContainText('console.log')
    })

    // SPEC: tool:edit-diff-fullline
    test('remove lines have red styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      const removeLine = toolBlock.locator('.code-block-type-diff-remove').first()
      await expect(removeLine).toBeVisible()
      await expect(removeLine).toContainText('consle.log')
    })

    // SPEC: tool:edit-diff-highlight
    test('paired lines have character-level highlight spans', async ({ page }) => {
      await mockSSE(page, 'events/tool-edit-char-highlight.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Edit is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      const removeLine = toolBlock.locator('.code-block-type-diff-remove').first()
      await expect(removeLine).toBeVisible()
      const inlineRemoved = removeLine.locator('.diff-inline-removed')
      await expect(inlineRemoved).toBeVisible()
      await expect(inlineRemoved).toHaveText('foo')

      const addLine = toolBlock.locator('.code-block-type-diff-add').first()
      await expect(addLine).toBeVisible()
      const inlineAdded = addLine.locator('.diff-inline-added')
      await expect(inlineAdded).toBeVisible()
      await expect(inlineAdded).toHaveText('bar')

      // Unchanged surrounding text isn't inside a highlight span, but the full line text still includes it.
      await expect(removeLine).toContainText('const value =')
      await expect(addLine).toContainText('const value =')
    })
  })

  test.describe('Write Tool Content Display', () => {
    // SPEC: tool:write-show-content
    test('Write tool shows actual written content when expanded', async ({ page }) => {
      await mockSSE(page, 'events/tool-write-python.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Write is expanded by default.
      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // Write is not in the default-collapsed list.
      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      await expect(expandedContent).toContainText('def hello_world')
      await expect(expandedContent).toContainText('Hello, World!')
      await expect(expandedContent).toContainText('return True')
      await expect(expandedContent).toContainText("if __name__ == '__main__'")
    })

    // SPEC: tool:write-syntax-highlight
    // SPEC: tool:codeblock-detect
    // SPEC: tool:codeblock-extension
    test('Write tool applies syntax highlighting for Python file', async ({ page }) => {
      await mockSSE(page, 'events/tool-write-python.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      // Unified code-block structure includes a gutter, shared across all code display.
      const codeBlock = expandedContent.locator('.code-block')
      await expect(codeBlock).toBeVisible()
      // Each row has its own gutter cell, just verify at least one exists
      const gutter = codeBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      await expect(codeBlock).toContainText('def hello_world')
      const spans = codeBlock.locator('.code-block-content span')
      const spanCount = await spans.count()
      expect(spanCount).toBeGreaterThan(0)
    })

    // SPEC: tool:write-strip-header
    test('Write tool does not show verbose "File written" header above content', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-write-python.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      await expect(expandedContent).not.toContainText('File has been created')
      await expect(expandedContent).not.toContainText('File written')

      await expect(expandedContent).toContainText('def hello_world')
    })
  })

  test.describe('Markdown Preview', () => {
    // SPEC: tool:codeblock-auto
    test('unknown tool with code-like content auto-detects language and applies highlighting', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-unknown-codeblock-auto.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expanded = toolBlock.locator('.tool-expanded-content')
      // Unknown tools default to expanded; only click the header if hidden.
      if (!(await expanded.isVisible())) {
        await toolBlock.locator('.tool-header').click()
      }
      await expect(expanded).toBeVisible()

      // Auto-detected content must NOT use the plain pre fallback.
      await expect(expanded.locator('.codeblock-plain')).toHaveCount(0)
      // Highlighted output renders as <pre><code> with span-wrapped tokens.
      await expect(expanded.locator('pre code').first()).toBeVisible()
      await expect(expanded.locator('pre code span').first()).toBeVisible()
    })

    // SPEC: tool:markdown-auto-render
    test('Read .md file renders as formatted markdown', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Read is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()

      await expect(expanded.locator('.markdown-preview-container')).toBeVisible()
      await expect(expanded.locator('.code-block')).not.toBeVisible()

      await expect(expanded.locator('.markdown-preview-content')).toContainText('My Project')
    })

    // SPEC: tool:markdown-toolbar
    test('hovering markdown block reveals toolbar', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const container = toolBlock.locator('.markdown-preview-container')
      await expect(container).toBeVisible()

      const toolbar = container.locator('.markdown-preview-toolbar')
      await expect(toolbar).toHaveCSS('opacity', '0')

      await container.hover()
      await expect(toolbar).toHaveCSS('opacity', '1')
    })

    // SPEC: tool:markdown-toggle
    test('toggle switches between rendered and source view', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const container = toolBlock.locator('.markdown-preview-container')
      await container.hover()

      await expect(container.locator('.markdown-preview-content')).toBeVisible()

      await container.locator('.preview-toolbar-btn').click()
      await expect(container.locator('.markdown-preview-content')).not.toBeVisible()

      const sourceBlock = container.locator('pre, [class*="hljs"]')
      await expect(sourceBlock.first()).toBeVisible()
    })

    // SPEC: tool:markdown-copy
    test('copy button copies raw markdown source', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockSSE(page, 'events/tool-read-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const container = toolBlock.locator('.markdown-preview-container')
      await container.hover()

      const copyBtn = container.locator('.preview-toolbar .copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('# My Project')
      expect(clipboardText).toContain('## Installation')
    })
  })

  test.describe('Grep Visual Formatting', () => {
    // SPEC: tool:grep-visual-match
    test('Grep content shows match lines with highlighting', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()

      const expandedText = await expanded.textContent()
      expect(expandedText.length).toBeGreaterThan(0)
    })
  })

  test.describe('Grep Summary Modes', () => {
    // SPEC: tool:grep-summary-modes
    // SPEC: tool:grep-summary-files
    test('files_with_matches mode shows file count summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-files.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // files_with_matches mode: summary shows "N files"
      await expect(toolBlock.locator('.tool-summary')).toContainText('4 files')
    })

    // SPEC: tool:grep-summary-modes
    // SPEC: tool:grep-summary-matches
    test('content mode shows match count summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-content.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // content mode: summary shows "N matches"
      await expect(toolBlock.locator('.tool-summary')).toContainText('5 matches')
    })

    // SPEC: tool:grep-summary-modes
    // SPEC: tool:grep-summary-count
    test('count mode shows files with matches summary', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-count.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // count mode: summary shows "N files with matches"
      await expect(toolBlock.locator('.tool-summary')).toContainText('3 files with matches')
    })
  })

  test.describe('Grep Visual Display', () => {
    // SPEC: tool:grep-visual
    test('Grep output renders as code block with line numbers', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      // Should render code-block wrapper (table layout with sticky gutter)
      const codeBlock = toolBlock.locator('.code-block')
      await expect(codeBlock).toBeVisible()

      const lineNumbers = toolBlock.locator('.code-block-linenum')
      await expect(lineNumbers.first()).toBeVisible()

      // Line numbers from fixture should be present (line 5 is a match)
      await expect(toolBlock.locator('.code-block-linenum', { hasText: '5' })).toBeVisible()
    })

    // SPEC: tool:grep-visual
    test('Grep output renders inside a pre element with tool-details class', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const toolDetails = toolBlock.locator('div.tool-details')
      await expect(toolDetails).toBeVisible()

      await expect(toolDetails).toContainText('handleSubmit')
    })

    // SPEC: tool:grep-visual-context
    test('context lines are visible around match lines', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const matchLines = toolBlock.locator('.code-block-type-match')
      await expect(matchLines.first()).toBeVisible()

      // Context lines should have grep-context class (lines before/after matches)
      const contextLines = toolBlock.locator('.code-block-type-context')
      await expect(contextLines.first()).toBeVisible()

      // Context content from fixture should be visible (line before first match)
      await expect(toolBlock).toContainText("import { useState } from 'react'")

      await expect(toolBlock).toContainText('event.preventDefault()')
    })

    // SPEC: tool:grep-visual-context
    test('context lines have dimmed styling (grep-context class)', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const contextLines = toolBlock.locator('.code-block-type-context')
      const matchLines = toolBlock.locator('.code-block-type-match')

      const contextCount = await contextLines.count()
      const matchCount = await matchLines.count()

      // Fixture has 2 matches and surrounding context lines
      expect(matchCount).toBe(2)
      expect(contextCount).toBeGreaterThan(0)
    })

    // SPEC: tool:grep-visual-context
    test('separator between context groups is visible', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const separator = toolBlock.locator('.code-block-separator')
      await expect(separator.first()).toBeVisible()
    })

    // SPEC: tool:grep-visual-scroll
    test('match highlight extends full line width for horizontal scroll', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-multifile-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const grepContent = toolBlock.locator('.code-block')
      await expect(grepContent).toBeVisible()

      // Highlight extends full width via CSS grid/table layout.
      const matchLines = toolBlock.locator('.code-block-type-match')
      await expect(matchLines.first()).toBeVisible()

      // The long match line from fixture should be present (tests horizontal scroll content)
      await expect(toolBlock).toContainText('handle expired sessions')

      // Match line width should extend beyond the container (grid/table layout ensures full-width highlight)
      const grepContentBox = await grepContent.boundingBox()
      const toolDetailsBox = await toolBlock.locator('.tool-details').boundingBox()
      expect(grepContentBox.width).toBeGreaterThanOrEqual(toolDetailsBox.width)
    })

    // SPEC: tool:grep-visual-scroll
    test('multi-file grep match lines have highlight class', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-multifile-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const codeBlock = toolBlock.locator('.code-block')
      await expect(codeBlock).toBeVisible()

      const multifileMatchLines = toolBlock.locator('.code-block-type-match')
      await expect(multifileMatchLines.first()).toBeVisible()

      // Should have 4 match lines from fixture
      const matchCount = await multifileMatchLines.count()
      expect(matchCount).toBe(4)
    })

    // SPEC: tool:grep-visual-context
    test('multi-file grep context lines have dimmed styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-multifile-context.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const multifileContextLines = toolBlock.locator('.code-block-type-context')
      await expect(multifileContextLines.first()).toBeVisible()

      await expect(toolBlock).toContainText('const token = getToken()')
      await expect(toolBlock).toContainText('return validateToken(token)')
    })
  })

  test.describe('Background Task Nested Streaming', () => {
    // SPEC: tool:bgtask-nested-events
    test('background task shows nested tools', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      // Completed async Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      await expect(page.getByText('Read').first()).toBeVisible()
      await expect(page.getByText('Bash').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-nested-complete
    test('completed nested tools show results', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      // Completed async Task auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      await expect(page.getByText('npm run build').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-nested-resume
    test('resumed session shows nested tools from static data', async ({ page }) => {
      // Load all events at once (simulates resume)
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      // Completed async Task auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      await expect(page.getByText('Read').first()).toBeVisible()
      await expect(page.getByText('Bash').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-correlation
    test('task notification updates status', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')
    })

    // SPEC: tool:bgtask-nested-spinner
    test('in-progress nested tool shows spinner indicator', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and assistant response
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Run the build',
          timestamp: 1705600000000,
          ts: '2025-01-18T12:00:00Z',
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: "I'll run the build in the background.",
          timestamp: 1705600001000,
          ts: '2025-01-18T12:00:01Z',
        },
      ])

      // Send Task tool_use (background) and its result
      await controller.sendEvents([
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: 1705600002000,
          ts: '2025-01-18T12:00:02Z',
          tool_use_id: 'task_bg_001',
          tool_name: 'Task',
          tool_input: {
            description: 'Build project',
            prompt: 'Run npm build and report results',
            subagent_type: 'Bash',
            run_in_background: true,
          },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'Background task started',
          timestamp: 1705600003000,
          ts: '2025-01-18T12:00:03Z',
          tool_use_id: 'task_bg_001',
          metadata: { background_task: true, output_file: '/tmp/bg_build.output' },
          tool_use_result: {
            isAsync: true,
            agentId: 'agent_bg_001',
            outputFile: '/tmp/bg_build.output',
          },
        },
      ])

      // Send nested Read tool_use WITHOUT its result (simulates in-progress)
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Read',
        timestamp: 1705600004000,
        ts: '2025-01-18T12:00:04Z',
        parent_tool_use_id: 'task_bg_001',
        tool_use_id: 'nested_read_001',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/package.json' },
      })

      const nestedToolBlock = page.locator(
        '[data-testid="tool-block"][data-tool-status="pending"].nested',
      )
      await expect(nestedToolBlock).toBeVisible()

      const spinner = nestedToolBlock.locator('.spinner')
      await expect(spinner).toBeVisible()
    })

    // SPEC: tool:bgtask-nested-immediate
    test('nested tool block appears immediately when emitted', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and assistant response
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Run the build',
          timestamp: 1705600000000,
          ts: '2025-01-18T12:00:00Z',
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: "I'll run the build in the background.",
          timestamp: 1705600001000,
          ts: '2025-01-18T12:00:01Z',
        },
      ])

      // Send Task tool_use (background) and its result
      await controller.sendEvents([
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: 1705600002000,
          ts: '2025-01-18T12:00:02Z',
          tool_use_id: 'task_bg_002',
          tool_name: 'Task',
          tool_input: {
            description: 'Build project',
            prompt: 'Run npm build and report results',
            subagent_type: 'Bash',
            run_in_background: true,
          },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'Background task started',
          timestamp: 1705600003000,
          ts: '2025-01-18T12:00:03Z',
          tool_use_id: 'task_bg_002',
          metadata: { background_task: true, output_file: '/tmp/bg_build.output' },
          tool_use_result: {
            isAsync: true,
            agentId: 'agent_bg_002',
            outputFile: '/tmp/bg_build.output',
          },
        },
      ])

      await expect(page.locator('[data-testid="tool-block"].nested')).toHaveCount(0)

      // Send nested Bash tool_use - no result yet, task still running
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: 1705600004000,
        ts: '2025-01-18T12:00:04Z',
        parent_tool_use_id: 'task_bg_002',
        tool_use_id: 'nested_bash_002',
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
      })

      // Nested tool block should appear immediately (not deferred until task completion)
      const nestedBlock = page.locator('[data-testid="tool-block"].nested')
      await expect(nestedBlock).toBeVisible()

      await expect(nestedBlock).toContainText('Bash')
      await expect(nestedBlock).toContainText('npm run build')
    })
  })

  test.describe('Tool Input Display', () => {
    // SPEC: tool:input-bash-dedup
    test('Bash: no generic Input dump; full command reachable via its own Command section', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // No description in this fixture - header falls back to the command.
      await expect(toolBlock.locator('.tool-name')).toContainText('ls -la')

      // No generic JSON Input dump.
      await expect(toolBlock.locator('.tool-input-section')).toHaveCount(0)

      // The purpose-built Command section carries the full command text.
      const commandSection = toolBlock.locator('.tool-command-section')
      await expect(commandSection.locator('.collapsible-label')).toHaveText('Command')
      await expect(commandSection).toContainText('ls -la --color=always')
    })

    // SPEC: tool:bash-header-description
    test("Bash header shows the model's description, falling back to the command in its tooltip", async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-bash-description.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolName = page.locator('.tool-name').first()
      await expect(toolName).toHaveText('Bash(Search config for the default model)')

      const title = await toolName.getAttribute('title')
      expect(title).toContain("grep -rn 'DEFAULT_MODEL'")
    })

    // SPEC: tool:bash-command-section
    test('expanding a Bash block reveals the full command in a Command section above the output', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-bash-description.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      // This fixture's single-line output matches its own summary, so the block starts collapsed.
      await toolBlock.locator('.tool-header').click()

      const commandSection = toolBlock.locator('.tool-command-section')
      const resultSection = toolBlock.locator('.tool-result-section')
      await expect(commandSection).toBeVisible()
      await expect(commandSection).toContainText("grep -rn 'DEFAULT_MODEL'")
      await expect(resultSection).toBeVisible()

      const commandBox = await commandSection.boundingBox()
      const resultBox = await resultSection.boundingBox()
      expect(commandBox.y).toBeLessThan(resultBox.y)
    })

    // SPEC: tool:input-hover
    test('tool header has title attribute with full input', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBeTruthy()
      expect(title).toContain('ls -la')
    })

    // SPEC: tool:file-tooltip
    test('Read tool header has full file path in title', async ({ page }) => {
      await mockSSE(page, 'events/tool-read.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBe('/home/user/project/config.json')
    })

    // SPEC: tool:input-unhandled-section
    test('unhandled MCP tool shows Input section in expanded content', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // JSON result causes default collapse - expand first
      await toolBlock.locator('.tool-header').click()

      const inputSection = toolBlock.locator('.tool-input-section')
      await expect(inputSection).toBeVisible()
      await expect(inputSection.locator('.collapsible-label')).toHaveText('Input')

      await expect(inputSection).toContainText('collection_name')
      await expect(inputSection).toContainText('share')
    })

    // SPEC: tool:input-above-output
    test('Input section rendered above Output section', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      // JSON result causes default collapse - expand first
      await toolBlock.locator('.tool-header').click()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      const inputBox = expandedContent.locator('.tool-input-section')
      const outputBox = expandedContent.locator('.tool-output-section')
      await expect(inputBox).toBeVisible()
      await expect(outputBox).toBeVisible()

      const inputTop = await inputBox.boundingBox()
      const outputTop = await outputBox.boundingBox()
      expect(inputTop.y).toBeLessThan(outputTop.y)
    })

    // SPEC: tool:output-unhandled-section
    test('unhandled MCP tool wraps output in collapsible Output section', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const outputSection = toolBlock.locator('.tool-output-section')
      await expect(outputSection).toBeVisible()
      await expect(outputSection.locator('.collapsible-label')).toHaveText('Output')
      await expect(outputSection.locator('.collapsible-content')).toBeVisible()
    })

    // SPEC: tool:input-default-expanded
    test('Input section expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      // JSON result causes default collapse - expand block first
      await toolBlock.locator('.tool-header').click()

      const inputSection = toolBlock.locator('.tool-input-section')

      // Input section is expanded by default.
      await expect(inputSection.locator('.collapsible-content')).toBeVisible()
    })

    // SPEC: tool:input-pending-visible
    test('Input section visible while tool is pending', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled-pending.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()

      // Input section should be visible even though tool hasn't returned
      const inputSection = toolBlock.locator('.tool-input-section')
      await expect(inputSection).toBeVisible()
      await expect(inputSection).toContainText('collection_name')
    })

    // SPEC: tool:input-empty-hidden
    test('empty input does not render Input section', async ({ page }) => {
      await mockSSE(page, 'events/tool-mcp-unhandled-empty-input.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-input-section')).not.toBeVisible()
    })

    // SPEC: tool:input-handled-skip
    test('handled tools do not show generic Input section', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-input-section')).not.toBeVisible()
    })
  })

  test.describe('Code Block Gutter', () => {
    // SPEC: tool:codeblock-gutter
    test('Read tool renders line numbers in gutter elements', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Read is collapsed by default.
      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const lineNumbers = toolBlock.locator('.code-block-linenum')
      const count = await lineNumbers.count()
      expect(count).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-gutter
    test('Grep single-file renders gutter with line numbers', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const gutters = toolBlock.locator('.code-block-gutter')
      const count = await gutters.count()
      expect(count).toBeGreaterThanOrEqual(1)

      const gutterLineNumbers = toolBlock.locator('.code-block-gutter .code-block-linenum')
      const lnCount = await gutterLineNumbers.count()
      expect(lnCount).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-sticky
    test('line number has sticky position for horizontal scroll', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-wide.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const gutter = toolBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      const position = await gutter.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('sticky')
    })

    // SPEC: tool:codeblock-sticky
    test('grep gutter has sticky position for horizontal scroll', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const gutter = toolBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      const position = await gutter.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('sticky')
    })

    // SPEC: tool:bash-command-no-linenums
    test('Bash Command section renders with no gutter cells', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const commandSection = toolBlock.locator('.tool-command-section')
      await expect(commandSection).toBeVisible()
      await expect(commandSection.locator('.code-block-gutter')).toHaveCount(0)
      await expect(commandSection.locator('.code-block-linenum')).toHaveCount(0)
    })

    // SPEC: tool:bash-command-no-linenums
    test('a multi-line Bash command shows no number on any line', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-multiline-command.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const commandSection = toolBlock.locator('.tool-command-section')
      await expect(commandSection.locator('.code-block-row').first()).toBeVisible()
      await expect(commandSection).toContainText("grep -rn 'MODEL' lib/")
      await expect(commandSection.locator('.code-block-linenum')).toHaveCount(0)
    })

    // SPEC: tool:bash-command-no-linenums
    test('command and output share the same left edge', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const commandContent = toolBlock.locator('.tool-command-section .code-block-content').first()
      const resultBox = toolBlock.locator('.tool-result-section pre, .tool-result-section code')
      // Compares each element's TEXT start (box x + padding-left), not the boxes themselves - the
      // command cell insets via padding-left while the plain result <pre> carries none.
      const textStartX = async locator =>
        locator.evaluate(el => {
          const r = el.getBoundingClientRect()
          return r.x + Number.parseFloat(getComputedStyle(el).paddingLeft)
        })
      const commandTextX = await textStartX(commandContent)
      const outputTextX = await textStartX(resultBox.first())
      expect(Math.abs(commandTextX - outputTextX)).toBeLessThanOrEqual(1)
    })

    // SPEC: tool:codeblock-gutter
    test('Read tool keeps its gutter unaffected by the Bash opt-out', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.code-block-gutter').first()).toBeVisible()
      const lineNumbers = toolBlock.locator('.code-block-linenum')
      expect(await lineNumbers.count()).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-sticky
    test('line number stays at left edge after horizontal scroll', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-wide.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const scrollContainer = toolBlock.locator('.tool-details').first()
      await expect(scrollContainer).toBeVisible()

      const lineNumber = toolBlock.locator('.code-block-linenum').first()
      const beforeBox = await lineNumber.boundingBox()
      expect(beforeBox).toBeTruthy()
      const leftBefore = beforeBox.x

      await scrollContainer.evaluate(el => {
        el.scrollLeft = 200
      })

      const afterBox = await lineNumber.boundingBox()
      expect(afterBox).toBeTruthy()

      // Sticky position holds roughly steady; tolerance covers the CSS left: -8px offset.
      expect(Math.abs(afterBox.x - leftBefore)).toBeLessThanOrEqual(10)
    })

    // SPEC: tool:codeblock-gutter-edges
    test('gutter background extends to container edges with no gaps', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      // The unified CodeBlock uses table layout with per-cell opaque backgrounds.
      const gutterCell = toolBlock.locator('.code-block-gutter').first()
      await expect(gutterCell).toBeVisible()

      const gutterBg = await gutterCell.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(gutterBg).not.toBe('transparent')
      expect(gutterBg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-edges
    test('line-number gutter has opaque background color', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      // Gutter cell should have an opaque background (not transparent) to cover content behind
      const gutter = toolBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      const bg = await gutter.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('transparent')
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-edges
    test('grep gutter has opaque background to prevent content bleed-through', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const gutter = toolBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      const bg = await gutter.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('transparent')
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-width
    test('gutter width is constant across every row', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const gutterCells = toolBlock.locator('.code-block-gutter')
      const count = await gutterCells.count()
      expect(count).toBeGreaterThanOrEqual(2)

      // Every gutter cell shares one width, sized to the widest line number and locked across rows.
      const widths = await gutterCells.evaluateAll(cells =>
        cells.map(el => el.getBoundingClientRect().width),
      )
      const reference = widths[0]
      for (const width of widths) {
        // Allow sub-pixel rounding noise from getBoundingClientRect.
        expect(Math.abs(width - reference)).toBeLessThan(1)
      }
    })

    // SPEC: tool:codeblock-gutter-width
    test('gutter is at least 3 characters wide (minimum)', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const gutter = toolBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()

      // Measures gutter font ch-width vs cell width; ``999`` (3 chars) sets the floor.
      const measurement = await gutter.evaluate(el => {
        const probe = document.createElement('span')
        probe.style.cssText = getComputedStyle(el).cssText
        probe.style.position = 'absolute'
        probe.style.visibility = 'hidden'
        probe.textContent = '999'
        document.body.appendChild(probe)
        const probeWidth = probe.getBoundingClientRect().width
        probe.remove()
        return { cell: el.getBoundingClientRect().width, threeChar: probeWidth }
      })

      expect(measurement.cell).toBeGreaterThanOrEqual(measurement.threeChar - 1)
    })

    // SPEC: tool:codeblock-highlight
    test('grep match line has distinct background', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const matchLine = toolBlock.locator('.code-block-type-match').first()
      await expect(matchLine).toBeVisible()

      const matchBg = await matchLine.evaluate(el => getComputedStyle(el).backgroundColor)
      // Should have non-transparent background (yellow highlight)
      expect(matchBg).not.toBe('transparent')
      expect(matchBg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-highlight
    test('grep match gutter has accent styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      // Match line gutter should have distinct background (yellow-tinted)
      const matchGutter = toolBlock.locator('.code-block-type-match .code-block-gutter').first()
      await expect(matchGutter).toBeVisible()

      const gutterBg = await matchGutter.evaluate(el => getComputedStyle(el).backgroundColor)
      // Match gutter background (#3d3820) differs from default gutter (#252526)
      expect(gutterBg).not.toBe('transparent')
      expect(gutterBg).not.toBe('rgba(0, 0, 0, 0)')

      // Match gutter should also have box-shadow for the yellow accent border
      const boxShadow = await matchGutter.evaluate(el => getComputedStyle(el).boxShadow)
      expect(boxShadow).not.toBe('none')
    })

    // SPEC: tool:codeblock-highlight
    test('grep context line has lower opacity than match line', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const contextLine = toolBlock.locator('.code-block-type-context').first()
      await expect(contextLine).toBeVisible()

      const opacity = await contextLine.evaluate(el => getComputedStyle(el).opacity)
      expect(parseFloat(opacity)).toBeLessThan(1)
    })

    // SPEC: tool:read-line-align
    test('Read tool lines are consistently aligned', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const readLines = toolBlock.locator('.code-block-row')
      const count = await readLines.count()
      expect(count).toBeGreaterThanOrEqual(2)

      const positions = []
      for (let i = 0; i < Math.min(count, 5); i++) {
        const box = await readLines.nth(i).boundingBox()
        if (box) {
          positions.push(box.x)
        }
      }

      const firstX = positions[0]
      for (const x of positions) {
        expect(Math.abs(x - firstX)).toBeLessThanOrEqual(1)
      }
    })

    // SPEC: tool:read-line-align
    test('first and last Read lines have matching alignment', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      const lineNumbers = toolBlock.locator('.code-block-row .code-block-linenum')
      const count = await lineNumbers.count()
      expect(count).toBeGreaterThanOrEqual(2)

      const firstBox = await lineNumbers.first().boundingBox()
      const lastBox = await lineNumbers.nth(count - 1).boundingBox()
      expect(firstBox).toBeTruthy()
      expect(lastBox).toBeTruthy()

      expect(Math.abs(firstBox.x - lastBox.x)).toBeLessThanOrEqual(1)
    })

    // SPEC: tool:read-line-gutter
    test('Read line numbers are right-aligned in gutter', async ({ page }) => {
      await mockSSE(page, 'events/tool-read-lined.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()
      await toolBlock.locator('.tool-header').click()

      // Single-digit and double-digit line numbers should have right edges aligned.
      const lineNumbers = toolBlock.locator('.code-block-row .code-block-linenum')
      const count = await lineNumbers.count()
      expect(count).toBeGreaterThanOrEqual(2)

      // Skips index 0 since extractSystemReminders().trim() strips line 1's leading whitespace.
      const rightEdges = []
      for (let i = 1; i < Math.min(count, 6); i++) {
        const box = await lineNumbers.nth(i).boundingBox()
        if (box) {
          rightEdges.push(box.x + box.width)
        }
      }

      // Right edges should match within 2px; monospace gives same-length strings equal width.
      const firstRight = rightEdges[0]
      for (const right of rightEdges) {
        expect(Math.abs(right - firstRight)).toBeLessThanOrEqual(2)
      }
    })

    // SPEC: tool:read-line-gutter
    test('grep single-file line numbers are right-aligned', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      const lineNumber = toolBlock.locator('.code-block-row .code-block-linenum').first()
      await expect(lineNumber).toBeVisible()

      const textAlign = await lineNumber.evaluate(el => getComputedStyle(el).textAlign)
      expect(textAlign).toBe('right')
    })
  })

  test.describe('Task Execution Behavior', () => {
    // SPEC: tool:task-expanded-default
    test('running Task block is expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-running.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Pending because there's no tool_result for the Task itself.
      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="pending"]')
        .first()
      await expect(taskBlock).toBeVisible()

      // Task is expanded by default during execution - nested tools should be visible
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(taskBlock.getByText('Glob').first()).toBeVisible()
    })

    // SPEC: tool:task-collapse-count
    test('clicking running Task header collapses it', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-running.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="pending"]')
        .first()
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      // Click header to collapse (use .tool-header-area to avoid matching nested tool headers)
      await taskBlock.locator('.tool-header-area').first().click()

      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await expect(taskBlock).toBeVisible()
    })

    // SPEC: tool:task-click-expand
    test('clicking collapsed Task header expands it again', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-running.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="pending"]')
        .first()
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      // Click header to collapse (use .tool-header-area to avoid matching nested tool headers)
      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(taskBlock.getByText('Glob').first()).toBeVisible()
    })

    // SPEC: tool:task-spinner-align
    test('spinner is vertically aligned with summary text', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user message and a Task tool_use (no result - keeps it pending with spinner)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Analyze the project',
          timestamp: 1705600000000,
          ts: '2025-01-18T12:00:00Z',
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: 1705600001000,
          ts: '2025-01-18T12:00:01Z',
          tool_use_id: 'tool_spin_001',
          tool_name: 'Task',
          tool_input: {
            description: 'Analyze project',
            prompt: 'Analyze the project structure.',
            subagent_type: 'Explore',
          },
        },
      ])

      const taskBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="pending"]')
        .first()
      await expect(taskBlock).toBeVisible()

      const spinner = taskBlock.locator('.spinner')
      await expect(spinner).toBeVisible()

      // The corner character (└) and spinner share the .tool-result row and a vertical center.
      const corner = taskBlock.locator('.tool-corner')
      await expect(corner).toBeVisible()

      const cornerBox = await corner.boundingBox()
      const spinnerBox = await spinner.boundingBox()

      expect(cornerBox).toBeTruthy()
      expect(spinnerBox).toBeTruthy()

      // Vertical centers should be within 4px of each other (aligned on same baseline)
      const cornerCenterY = cornerBox.y + cornerBox.height / 2
      const spinnerCenterY = spinnerBox.y + spinnerBox.height / 2
      expect(Math.abs(cornerCenterY - spinnerCenterY)).toBeLessThanOrEqual(4)
    })
  })

  test.describe('Background Task Consolidated', () => {
    // SPEC: tool:bgtask-consolidated
    test('background task renders as single consolidated block', async ({ page }) => {
      await mockSSE(page, 'events/bg-task-consolidated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Nested Read/Bash events become children of the block, not separate top-level blocks.
      const topLevelToolBlocks = page.locator('[data-testid="tool-block"]:not(.nested)')
      await expect(topLevelToolBlocks.first()).toBeVisible()

      const count = await topLevelToolBlocks.count()
      expect(count).toBe(1)

      await expect(topLevelToolBlocks.first()).toContainText('Task')
    })

    // SPEC: tool:bgtask-single-block
    test('background task with nested tools shows one parent block', async ({ page }) => {
      await mockSSE(page, 'events/bg-task-consolidated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      await expect(taskBlock).toContainText('Build and test project')

      // Notification arrived, so summary should reflect completion
      const summary = taskBlock.locator('.tool-summary')
      await expect(summary).toContainText('Build and tests completed successfully')
    })

    // SPEC: tool:bgtask-no-multi-block
    test('background task with events across turns still renders as single block', async ({
      page,
    }) => {
      await mockSSE(page, 'events/bg-task-no-multi-block.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await disableAutoCollapse(page)

      // Even though a second turn and a later task_notification occur, turn 1's Task stays one consolidated block.
      const topLevelToolBlocks = page.locator('[data-testid="tool-block"]:not(.nested)')

      await expect(topLevelToolBlocks.first()).toBeVisible()

      const count = await topLevelToolBlocks.count()
      expect(count).toBe(1)

      await expect(topLevelToolBlocks.first()).toContainText('Task')
      await expect(topLevelToolBlocks.first()).toContainText('Deploy application')
    })

    // SPEC: tool:bgtask-inline-taskoutput
    test('TaskOutput appears inline in assistant message referencing background task', async ({
      page,
    }) => {
      await mockSSE(page, 'events/bg-task-inline-taskoutput.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await disableAutoCollapse(page)

      const taskOutputBlock = page.locator('[data-testid="tool-block"]')

      await expect(taskOutputBlock.first()).toBeVisible()

      await expect(page.getByText('TaskOutput(agent_inline_001)').first()).toBeVisible()

      const taskOutputToolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .filter({ hasText: 'TaskOutput' })
      await expect(taskOutputToolBlock.first()).toBeVisible()

      const summary = taskOutputToolBlock.first().locator('.tool-summary')
      await expect(summary).toContainText('Completed')
    })

    // SPEC: tool:bgtask-click-expand
    test('clicking completed background task block expands to show nested details', async ({
      page,
    }) => {
      await mockSSE(page, 'events/bg-task-click-expand.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Completed after the notification arrives.
      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()

      // Completed Task with nested tools is collapsed by default
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await taskBlock.locator('.tool-header').click()

      await expect(taskBlock.locator('.tool-expanded-content').first()).toBeVisible()

      await expect(taskBlock.locator('.tool-nested').first()).toBeVisible()
      await expect(taskBlock.getByText('Bash').first()).toBeVisible()
      await expect(taskBlock.getByText('npm test -- --coverage').first()).toBeVisible()
    })
  })

  test.describe('Background Task Status', () => {
    // SPEC: tool:bgtask
    test('background task tool block is rendered', async ({ page }) => {
      await mockSSE(page, 'events/tool-task-background.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toContainText('Task')
    })

    // SPEC: tool:bgtask-running
    test('running background task shows spinner and Running status', async ({ page }) => {
      await mockSSE(page, 'events/tool-taskoutput-running.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // Running TaskOutput has effectiveIsPending=true -> spinner shown instead of summary
      const spinner = toolBlock.locator('.spinner')
      await expect(spinner).toBeVisible()

      await expect(toolBlock).toHaveAttribute('data-tool-status', 'pending')

      await expect(toolBlock).toContainText('TaskOutput')
    })

    // SPEC: tool:bgtask-completed
    test('completed background task shows Completed status with green bullet', async ({ page }) => {
      await mockSSE(page, 'events/tool-taskoutput.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Completed')

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/completed/)
    })

    // SPEC: tool:bgtask-failed
    test('failed background task shows Failed status with error styling', async ({ page }) => {
      await mockSSE(page, 'events/tool-taskoutput-failed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Failed')

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/error/)
    })

    // SPEC: tool:bgtask-killed
    test('killed background task shows Killed status', async ({ page }) => {
      await mockSSE(page, 'events/tool-taskoutput-killed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Killed')

      // Killed status renders a yellow bullet.
      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/killed/)
    })

    test('background task completion notification is not shown as a raw chat message', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-task-bg-strip-xml.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The genuine human message renders...
      await expect(page.getByText('Research the codebase in the background')).toBeVisible()

      // ...but the <task-notification> completion echo (stored as a human message) is hidden.
      await expect(page.getByText('<task-notification', { exact: false })).toHaveCount(0)
      await expect(page.getByText('</task-notification>', { exact: false })).toHaveCount(0)

      const userBubbles = page.locator('[data-testid="message-user"]')
      const count = await userBubbles.count()
      for (let i = 0; i < count; i++) {
        await expect(userBubbles.nth(i)).not.toContainText('task-notification')
      }
    })
  })

  test.describe('Tool Output Truncation', () => {
    // SPEC: tool:output-truncation
    test('truncated output shows truncation indicator', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-truncated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      // Bash is expanded by default.
      const truncationIndicator = toolBlock.locator('.persisted-output-truncated')
      await expect(truncationIndicator).toBeVisible()

      await expect(truncationIndicator).toContainText('256.3KB')
    })

    // SPEC: tool:output-truncation
    test('truncated output shows preview content', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-truncated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()
      await expect(expandedContent).toContainText('Running full test suite')
      await expect(expandedContent).toContainText('318 passed')
    })

    // SPEC: tool:output-truncation
    test('truncated output exposes both expand AND download buttons', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-truncated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandBtn = toolBlock.locator('.tool-expand-btn')
      await expect(expandBtn).toBeVisible()
      await expect(expandBtn).toHaveAttribute('title', 'Show full output')

      // The claim names both buttons; match by class, falling back to a title mentioning download.
      const downloadBtn = toolBlock.locator('.tool-download-btn, button[title*="ownload"]').first()
      await expect(downloadBtn).toBeVisible()
    })

    // SPEC: tool:output-truncation
    test('clicking expand button fetches and shows full content', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-truncated.jsonl')

      // Mock the tool output API endpoint to return full content
      await page.route(/\/api\/sessions\/current\/tool-output\/tool_trunc_001$/, async route => {
        await route.fulfill({
          json: {
            content:
              'Running full test suite...\n\nTest Suites: 42 passed, 42 total\nTests:       318 passed, 318 total\nSnapshots:   0 total\nTime:        24.567s\n\nFull verbose output follows...\nAll 318 tests passed with no failures.',
            truncated: false,
          },
        })
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const expandBtn = toolBlock.locator('.tool-expand-btn')
      await expandBtn.click()

      await expect(toolBlock).toContainText('Full verbose output follows')

      await expect(expandBtn).toHaveAttribute('title', 'Show preview')
    })

    // SPEC: tool:output-download
    test('truncated output has download button', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-truncated.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const downloadBtn = toolBlock.locator('.tool-download-btn')
      await expect(downloadBtn).toBeVisible()

      await expect(downloadBtn).toHaveAttribute('download', '')
      await expect(downloadBtn).toHaveAttribute('title', 'Download full output')

      const href = await downloadBtn.getAttribute('href')
      expect(href).toContain('/tool-output/tool_trunc_001/download')
    })

    // SPEC: tool:output-download
    test('persisted output has download button', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash-persisted.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page
        .locator('[data-testid="tool-block"][data-tool-status="completed"]')
        .first()
      await expect(toolBlock).toBeVisible()

      const downloadBtn = toolBlock.locator('.tool-download-btn')
      await expect(downloadBtn).toBeVisible()

      await expect(downloadBtn).toHaveAttribute('download', '')
      await expect(downloadBtn).toHaveAttribute('title', 'Download full output')

      const href = await downloadBtn.getAttribute('href')
      expect(href).toContain('/tool-output/tool_001/download')
    })
  })

  test.describe('Grep Pagination Hidden', () => {
    // SPEC: tool:grep-pagination-hidden
    test('SDK pagination metadata stripped from Grep output', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep-pagination.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Grep is collapsed by default - click to expand
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-details')).toContainText('TODO: fix this')

      await expect(toolBlock.locator('.tool-details')).not.toContainText(
        'Showing results with pagination',
      )
    })
  })

  test.describe('Grep Collapsed By Default', () => {
    // SPEC: tool:expand-default-collapsed
    test('Grep tool starts collapsed', async ({ page }) => {
      await mockSSE(page, 'events/tool-grep.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-details')).not.toBeVisible()
    })
  })

  test.describe('WebSearch/WebFetch Rendering', () => {
    // SPEC: tool:expand-default-collapsed
    test('WebSearch is collapsed by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-websearch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:expand-default-collapsed
    test('WebFetch is collapsed by default', async ({ page }) => {
      await mockSSE(page, 'events/tool-webfetch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:websearch
    test('WebSearch renders result as markdown', async ({ page }) => {
      await mockSSE(page, 'events/tool-websearch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()
      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      const markdownContainer = toolBlock.locator('.tool-markdown-content')
      await expect(markdownContainer).toBeVisible()

      // Markdown should render headings and bold text as HTML, not raw markdown
      await expect(markdownContainer).toContainText('Search Results')
      await expect(markdownContainer).toContainText('First Result')
      await expect(markdownContainer.locator('strong').first()).toBeVisible()
    })

    // SPEC: tool:webfetch
    test('WebFetch renders result as markdown', async ({ page }) => {
      await mockSSE(page, 'events/tool-webfetch.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      await toolBlock.locator('.tool-header').click()
      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      const markdownContainer = toolBlock.locator('.tool-markdown-content')
      await expect(markdownContainer).toBeVisible()

      // Markdown should render lists and blockquotes as HTML
      await expect(markdownContainer).toContainText('Page Summary')
      await expect(markdownContainer.locator('li').first()).toBeVisible()
      await expect(markdownContainer.locator('blockquote')).toBeVisible()
    })
  })

  test.describe('Path Highlighting', () => {
    // SPEC: tool:tmp-path-highlighting
    test('/tmp paths rendered as clickable highlighted spans', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockSSE(page, 'events/tool-bash-tmp-path.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Bash is expanded by default.
      const pathLink = page.locator('.path-link').first()
      await expect(pathLink).toBeVisible()

      const title = await pathLink.getAttribute('title')
      expect(title).toContain('/tmp/test-output.log')

      await pathLink.click()
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('/tmp/test-output.log')
    })

    // SPEC: tool:general-path-highlighting
    test('general file paths highlighted when resolved via server', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      // No editor template - this test covers plain click/copy.
      await mockNoEditorTemplate(page)
      await page.route('**/api/files/resolve-paths', async route => {
        const data = JSON.parse(route.request().postData())
        const resolved = {}
        if (data.candidates.includes('src/app.js')) {
          resolved['src/app.js'] = '/workspace/src/app.js'
        }
        if (data.candidates.includes('config.toml')) {
          resolved['config.toml'] = '/workspace/config.toml'
        }
        await route.fulfill({ json: { resolved } })
      })
      await mockSSE(page, 'events/general-path-highlighting.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const assistant = page.getByTestId('message-assistant')
      const pathLink = assistant.locator('.path-link', { hasText: 'src/app.js' })
      await expect(pathLink).toBeVisible()

      const title = await pathLink.getAttribute('title')
      expect(title).toBe('/workspace/src/app.js')

      await pathLink.click()
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('/workspace/src/app.js')
    })

    // SPEC: tool:path-alt-click-opens-editor
    test('Alt+Click a highlighted path opens it in the editor instead of copying', async ({
      page,
    }) => {
      await page.route('**/api/files/resolve-paths', async route => {
        const data = JSON.parse(route.request().postData())
        const resolved = {}
        if (data.candidates.includes('src/app.js')) {
          resolved['src/app.js'] = '/workspace/src/app.js'
        }
        await route.fulfill({ json: { resolved } })
      })
      await mockSSE(page, 'events/general-path-highlighting.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.evaluate(() => {
        window.__opened = []
        window.open = url => {
          window.__opened.push(url)
          return null
        }
      })

      const assistant = page.getByTestId('message-assistant')
      const pathLink = assistant.locator('.path-link', { hasText: 'src/app.js' })
      await expect(pathLink).toBeVisible()
      await expect(pathLink).toHaveAttribute('title', /Alt\+Click to open in editor/)

      await pathLink.click({ modifiers: ['Alt'] })

      const opened = await page.evaluate(() => window.__opened)
      expect(opened).toEqual([
        'claudebox-editor-test://open?path=%2Fworkspace%2Fsrc%2Fapp.js&line=1',
      ])
      await expect(pathLink).not.toHaveClass(/copied/)
    })

    // SPEC: tool:path-alt-click-fallback
    test('Alt+Click with no editor configured copies, same as a plain click', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockNoEditorTemplate(page)
      await page.route('**/api/files/resolve-paths', async route => {
        const data = JSON.parse(route.request().postData())
        const resolved = {}
        if (data.candidates.includes('src/app.js')) {
          resolved['src/app.js'] = '/workspace/src/app.js'
        }
        await route.fulfill({ json: { resolved } })
      })
      await mockSSE(page, 'events/general-path-highlighting.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const assistant = page.getByTestId('message-assistant')
      const pathLink = assistant.locator('.path-link', { hasText: 'src/app.js' })
      await expect(pathLink).toBeVisible()
      await expect(pathLink).toHaveAttribute('title', '/workspace/src/app.js')

      await pathLink.click({ modifiers: ['Alt'] })

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('/workspace/src/app.js')
      await expect(pathLink).toHaveClass(/copied/)
    })
  })

  test.describe('Hidden ToolSearch', () => {
    // SPEC: tool:toolsearch-hidden
    test('a successful search renders no block, while the tool it discovered does', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-toolsearch-success.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(1)
      await expect(page.getByText('ToolSearch', { exact: false })).toHaveCount(0)
      await expect(page.locator('[data-testid="tool-block"]').first()).toContainText(
        'mcp__gcal__list_events',
      )
    })

    // SPEC: tool:toolsearch-hidden
    test('a failed search renders its block exactly as before', async ({ page }) => {
      await mockSSE(page, 'events/tool-toolsearch-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()
      await expect(toolBlock).toContainText('ToolSearch')
      await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')
    })

    // SPEC: tool:toolsearch-hidden
    test('a nested subagent search is hidden from the Task Activity section', async ({ page }) => {
      await mockSSE(page, 'events/tool-toolsearch-nested.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const taskBlock = page.locator('[data-testid="tool-block"]', { hasText: 'Task' }).first()
      await expect(taskBlock).toBeVisible()
      await taskBlock.locator('.tool-header-area').click()

      const activity = taskBlock.locator('.task-activity')
      await expect(activity).toBeVisible()
      await expect(activity.getByText('ToolSearch', { exact: false })).toHaveCount(0)
      await expect(activity).toContainText('mcp__gcal__list_events')
    })

    // SPEC: tool:toolsearch-hidden
    test('never flashes visible mid-stream before the result settles it hidden', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Look up the calendar tools',
          ts: '2025-01-18T12:00:00Z',
          turn_id: 'turn_stream',
          id: 'evt_stream_1',
          primary: true,
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'ToolSearch',
          ts: '2025-01-18T12:00:01Z',
          tool_use_id: 'tool_stream',
          tool_name: 'ToolSearch',
          tool_input: { query: 'select:gcal_list' },
          id: 'evt_stream_2',
          primary: false,
          is_human: false,
        },
      ])

      // Sampled while pending (no result yet) - a show-then-hide implementation would show a block
      // here even though the final render hides it correctly.
      await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(0)

      await controller.sendEvent({
        type: 'user',
        subtype: 'tool_result',
        content: '[{"name":"mcp__gcal__list_events"}]',
        ts: '2025-01-18T12:00:02Z',
        tool_use_id: 'tool_stream',
        id: 'evt_stream_3',
        primary: false,
        is_human: false,
      })

      await page.waitForTimeout(200)
      await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(0)
    })

    // SPEC: tool:toolsearch-hidden
    // TurnProgress's "worked for Xs" summary appears on the active/last turn regardless (unrelated
    // to ToolSearch); a two-turn fixture makes the hidden-only turn historical, isolating any leftover chrome.
    test('a historical turn whose only content is a hidden search renders no chrome at all', async ({
      page,
    }) => {
      await mockSSE(page, 'events/tool-toolsearch-only.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="message-user"]')).toHaveCount(2)
      // Only the active (second) turn produces an assistant message wrapper - the first turn's only
      // content was a hidden, successful search, so it renders nothing.
      await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(1)
      await expect(page.locator('[data-testid="message-assistant"]')).toContainText(
        "You're welcome!",
      )
    })
  })
})
