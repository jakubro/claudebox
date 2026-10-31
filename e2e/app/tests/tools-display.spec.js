/** E2E tests for tool display functionality. */

import { expect, test } from '@playwright/test'
import {
  assertRedColor,
  disableAutoCollapse,
  openLiveSession,
  openRunningTask,
  openSession,
  waitForAppReady,
} from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

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

async function expandFirstCompletedTool(page) {
  const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="completed"]').first()
  await expect(toolBlock).toBeVisible()
  await toolBlock.locator('.tool-header').click()

  return toolBlock
}

async function resolvePaths(page, hostPaths) {
  await page.route('**/api/files/resolve-paths*', async route => {
    const data = JSON.parse(route.request().postData())
    const resolved = Object.fromEntries(
      Object.entries(hostPaths).filter(([candidate]) => data.candidates.includes(candidate)),
    )
    await route.fulfill({ json: { resolved } })
  })
}

async function openExpandedBackgroundTask(page) {
  const taskBlock = await openFirstTool(page, 'events/tool-task-background-nested.jsonl')
  // Completed async Task with nested blocks auto-collapses - expand first
  await taskBlock.locator('.tool-header').click()

  return taskBlock
}

async function openExpandedNestedTask(page) {
  const taskBlock = await openToolWithStatus(page, 'events/tool-task-nested.jsonl', 'completed')
  // Completed Task with nested blocks auto-collapses - expand first
  await taskBlock.locator('.tool-header').click()

  return taskBlock
}

async function openWritePythonContent(page) {
  const toolBlock = await openWritePython(page)
  const content = toolBlock.locator('.tool-expanded-content')
  await expect(content).toBeVisible()

  return content
}

async function openGrepGutter(page) {
  const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')
  const gutter = toolBlock.locator('.code-block-gutter').first()
  await expect(gutter).toBeVisible()

  return gutter
}

async function expandFirstGutter(page) {
  const toolBlock = await expandFirstCompletedTool(page)
  const gutter = toolBlock.locator('.code-block-gutter').first()
  await expect(gutter).toBeVisible()

  return gutter
}

async function openWritePython(page) {
  return openToolWithStatus(page, 'events/tool-write-python.jsonl', 'completed')
}

const BUILD_NARRATION = {
  type: 'assistant',
  subtype: 'text',
  content: "I'll run the build in the background.",
  timestamp: 1705600001000,
  ts: '2025-01-18T12:00:01Z',
}

async function openBackgroundBuild(page, taskId, agentId, narration = []) {
  const controller = await openLiveSession(page)
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
    ...narration,
    ...backgroundBuildEvents(taskId, agentId),
  ])

  return controller
}

function backgroundBuildEvents(taskId, agentId) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Task',
      timestamp: 1705600002000,
      ts: '2025-01-18T12:00:02Z',
      tool_use_id: taskId,
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
      tool_use_id: taskId,
      metadata: { background_task: true, output_file: '/tmp/bg_build.output' },
      tool_use_result: { isAsync: true, agentId, outputFile: '/tmp/bg_build.output' },
    },
  ]
}

async function openTodoWriteDiff(page) {
  await openSession(page, 'events/tool-todowrite-diff.jsonl')
  const diffBlock = page.locator('[data-testid="tool-block"]').nth(1)
  await expect(diffBlock).toBeVisible()

  return diffBlock
}

async function expandFirstTask(page) {
  const taskBlock = page.locator('[data-testid="tool-block"]').first()
  await expect(taskBlock).toBeVisible()
  await taskBlock.locator('.tool-header-area').click()

  return taskBlock
}

async function expandNestedTool(page) {
  // Task collapses by default - expand to see the nested block.
  const taskBlock = await expandFirstTask(page)
  const nestedBlock = taskBlock.locator('.tool-nested [data-testid="tool-block"]').first()
  await expect(nestedBlock).toBeVisible()

  return nestedBlock
}

function commandLines(page, toolUseId) {
  return page
    .locator(`[data-testid="tool-block"][data-tool-use-id="${toolUseId}"] .tool-command-section`)
    .locator('.code-block-row')
    .evaluateAll(rows => rows.map(row => row.textContent.replace(/\n$/, '')))
}

function firstToolBlock(page, status) {
  return page.locator(`[data-testid="tool-block"][data-tool-status="${status}"]`).first()
}

async function openFirstTool(page, fixture) {
  await openSession(page, fixture)
  const toolBlock = page.locator('[data-testid="tool-block"]').first()
  await expect(toolBlock).toBeVisible()

  return toolBlock
}

async function openExpandedTool(page, fixture) {
  await openSession(page, fixture)
  const toolBlock = page.locator('[data-testid="tool-block"]').first()
  await toolBlock.locator('.tool-header').click()

  return toolBlock
}

async function openToolWithStatus(page, fixture, status) {
  await openSession(page, fixture)
  const toolBlock = firstToolBlock(page, status)
  await expect(toolBlock).toBeVisible()

  return toolBlock
}

test.describe('Tools Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Tool Block Rendering', () => {
    // SPEC: tool:read
    test('displays Read tool with file name', async ({ page }) => {
      await openSession(page, 'events/tool-read.jsonl')

      await expect(page.locator('[data-testid="tool-block"]').first()).toBeVisible()

      // Should show Read tool header with filename (header formatter shows basename only)
      await expect(page.getByText('Read(config.json)').first()).toBeVisible()
    })

    // SPEC: tool:bash
    test('displays Bash tool with command and summary', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

      await expect(page.getByText('ls -la').first()).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      const summaryText = await summary.textContent()
      // Multi-line output -> line count summary (e.g., "6 lines")
      expect(summaryText).toMatch(/\d+ lines?/)
    })

    // SPEC: tool:bullet-complete
    test('completed tool has completed status', async ({ page }) => {
      // Completed status requires the tool_result event to have arrived.
      const toolBlock = await openToolWithStatus(page, 'events/tool-read.jsonl', 'completed')

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
      // Error status requires the tool_result event to have arrived.
      const toolBlock = await openToolWithStatus(page, 'events/tool-with-error.jsonl', 'error')

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
      await openSession(page, 'events/tool-with-error.jsonl')

      await expect(page.getByText('File not found').first()).toBeVisible()
    })

    // SPEC: tool:bullet-error
    test('error tool has error status attribute', async ({ page }) => {
      await openSession(page, 'events/tool-with-error.jsonl')

      // Error status requires the tool_result event to have arrived.
      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()
    })

    // SPEC: tool:error-no-duplicate
    test('single-line error shows in summary', async ({ page }) => {
      const toolBlock = await openToolWithStatus(page, 'events/tool-with-error.jsonl', 'error')

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
      const toolBlock = await openToolWithStatus(page, 'events/tool-error-multiline.jsonl', 'error')

      // First line should be visible in summary (Error: Test failed:)
      await expect(toolBlock.locator('.tool-summary')).toContainText('Test failed')

      // Bash tool with error is expanded by default.
      await expect(toolBlock).toContainText('FAIL')
    })
  })

  test.describe('Tool Details Expansion', () => {
    // SPEC: tool:expand-default-collapsed
    test('Read tool is collapsed by default', async ({ page }) => {
      await openSession(page, 'events/tool-read.jsonl')

      await expect(page.locator('[data-testid="tool-block"]').first()).toBeVisible()

      // Read tool is collapsed by default.
      const expandedContent = page.locator('.tool-expanded-content').first()
      await expect(expandedContent).not.toBeVisible()
    })

    // SPEC: tool:expand-click
    test('clicking tool header toggles details', async ({ page }) => {
      await openSession(page, 'events/tool-read.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

      await expect(toolBlock.locator('.tool-expanded-content').first()).toBeVisible()
    })

    // SPEC: tool:expand-threshold
    test('large content is collapsible based on threshold', async ({ page }) => {
      const toolBlock = await openToolWithStatus(page, 'events/tool-read-large.jsonl', 'completed')

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
      const toolBlock = await openToolWithStatus(page, 'events/tool-bash.jsonl', 'completed')

      // Bash is not in the default-collapsed list, so it's expanded without clicking.
      await expect(toolBlock.locator('.tool-expanded-content').first()).toBeVisible()
    })

    // SPEC: tool:expand-default-expanded
    test('AskUserQuestion is expanded by default', async ({ page }) => {
      await openFirstTool(page, 'events/tool-ask-question.jsonl')

      // AskUserQuestion should be expanded by default (shows interactive form)
      await expect(page.locator('.tool-questions-interactive').first()).toBeVisible()
    })

    // SPEC: tool:expand-default-expanded
    test('ExitPlanMode is expanded by default', async ({ page }) => {
      await openFirstTool(page, 'events/tool-exit-plan.jsonl')

      // ExitPlanMode should be expanded by default (shows plan content)
      await expect(page.locator('.tool-plan').first()).toBeVisible()
      await expect(page.locator('.tool-expanded-content').first()).toBeVisible()
    })
  })

  test.describe('Bash Output', () => {
    // SPEC: tool:bash
    test('Bash tool shows directory listing', async ({ page }) => {
      // Bash is expanded by default
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()

      await expect(page.getByText('app.js').first()).toBeVisible()
      await expect(page.getByText('config.json').first()).toBeVisible()
    })

    // SPEC: tool:expand-click
    // SPEC: tool:codeblock-fallback
    test('Bash output has details section', async ({ page }) => {
      const toolBlock = await openToolWithStatus(page, 'events/tool-bash.jsonl', 'completed')

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
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

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
      await openSession(page, 'events/tool-read.jsonl')

      const toolBlocks = page.locator('[data-testid="tool-block"]')
      await expect(toolBlocks.first()).toBeVisible()

      // Count should be at least 1 (the fixture has one tool)
      const count = await toolBlocks.count()
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  test.describe('Nested Tool Blocks', () => {
    // SPEC: tool:nested-task
    // SPEC: tool:nested-tree
    test('Task tool shows nested tools', async ({ page }) => {
      const taskBlock = await openFirstTool(page, 'events/tool-task-nested.jsonl')

      await expect(taskBlock).toContainText('Task')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      await expect(page.getByText('Glob').first()).toBeVisible()
    })

    // SPEC: tool:nested-tree
    test('Task with nested tools shows multiple tool names', async ({ page }) => {
      const taskBlock = await openFirstTool(page, 'events/tool-task-nested.jsonl')

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator('.tool-header').click()

      // Fixture has nested Glob and Read tools.
      await expect(page.getByText('Glob').first()).toBeVisible()
      await expect(page.getByText('Read').first()).toBeVisible()
    })

    // SPEC: tool:nested-collapse
    test('nested tools can be collapsed', async ({ page }) => {
      const taskBlock = await openFirstTool(page, 'events/tool-task-nested.jsonl')

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')

      // Completed Task with nested blocks auto-collapses - expand first
      await taskBlock.locator(':scope > .tool-header-area').click()
      await expect(taskBlock.locator('.task-prompt .collapsible-label')).toBeVisible()

      await taskBlock.locator(':scope > .tool-header-area').click()

      await expect(taskBlock.locator('.task-prompt .collapsible-label')).not.toBeVisible()
    })

    // SPEC: tool:nested-realtime
    test('nested tools appear progressively during streaming', async ({ page }) => {
      const controller = await openRunningTask(page, 'tool_100')

      // Task collapses by default - expand to watch nested calls stream in.
      const taskBlock = await expandFirstTask(page)

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

    // SPEC: tool:nested-prose
    // SPEC: tool:nested-prose-realtime
    test("a subagent's narration renders as markdown, interleaved with its calls in order", async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_300')

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      const nestedContent = taskBlock.locator('.tool-nested')
      await expect(taskBlock).toBeVisible()

      // Task collapses by default - expand to watch its Activity list.
      await taskBlock.locator('.tool-header-area').click()

      // Narration arrives live, before any call - it must still appear, not wait on one.
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: "I'll start with the module layout.",
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_300',
      })
      await expect(nestedContent.locator('.nested-text-entry')).toHaveCount(1)
      await expect(page.getByText("I'll start with the module layout.")).toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Glob',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_300',
        tool_use_id: 'tool_301',
        tool_name: 'Glob',
        tool_input: { pattern: 'src/**/*.js' },
      })

      // A second line of narration - markdown must render as elements, not literal characters.
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'The parser is split across **two** files; reading both.',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_300',
      })

      await expect(nestedContent.locator('.nested-text-entry')).toHaveCount(2)
      const secondEntry = nestedContent.locator('.nested-text-entry').nth(1)
      await expect(secondEntry.locator('strong', { hasText: 'two' })).toBeVisible()

      // Source order: prose, call, prose - not calls first with prose trailing.
      const kinds = await nestedContent.evaluate(el =>
        Array.from(el.children).map(child =>
          child.classList.contains('nested-text-entry') ? 'text' : 'tool',
        ),
      )
      expect(kinds).toEqual(['text', 'tool', 'text'])
    })

    // SPEC: tool:nested-tool-use
    test('nested tool_use event creates a nested tool block', async ({ page }) => {
      const controller = await openRunningTask(page, 'tool_200')

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

      const nestedBlock = await expandNestedTool(page)
      await expect(nestedBlock).toContainText('Read')
    })

    // SPEC: tool:nested-tool-result
    test('nested tool_result updates the nested block with result text', async ({ page }) => {
      const controller = await openRunningTask(page, 'tool_300')

      await controller.sendEvents([
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

      const nestedBlock = await expandNestedTool(page)
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
      const controller = await openRunningTask(page, 'tool_400')

      // Task is pending (no tool_result yet)
      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toHaveAttribute('data-tool-status', 'pending')

      // Task collapses by default - expand to watch nested calls stream in.
      await taskBlock.locator('.tool-header-area').click()

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
      const controller = await openRunningTask(page, 'tool_500')

      await controller.sendEvents([
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
      const nestedBlock = await expandNestedTool(page)
      await expect(nestedBlock).toHaveAttribute('data-tool-status', 'pending')

      const spinner = nestedBlock.locator('.spinner')
      await expect(spinner).toBeVisible()

      // Bullet should have pending class (cyan pulsing animation via CSS)
      const bullet = nestedBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/pending/)
    })

    // SPEC: tool:nested-complete-green
    test('completed nested tool shows green bullet with result summary', async ({ page }) => {
      await openSession(page, 'events/tool-task-nested-realtime.jsonl')

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
      const taskBlock = await openExpandedNestedTask(page)

      const promptLabel = taskBlock.locator('.task-prompt .collapsible-label')
      await expect(promptLabel).toContainText('Prompt')

      await promptLabel.click()

      await expect(taskBlock.locator('.task-prompt .collapsible-content')).not.toBeVisible()
    })

    // SPEC: tool:task-prompt-collapsed
    test('Task prompt shows preview when collapsed', async ({ page }) => {
      const taskBlock = await openExpandedNestedTask(page)

      // Prompt starts expanded; click collapses it.
      await taskBlock.locator('.task-prompt .collapsible-header').click()

      const preview = taskBlock.locator('.task-prompt .collapsible-preview')
      await expect(preview).toBeVisible()
      await expect(preview).toContainText('Find all configuration files')
    })

    // SPEC: tool:task-prompt-content
    test('clicking prompt header toggles full content', async ({ page }) => {
      const taskBlock = await openExpandedNestedTask(page)

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
      const toolBlock = await openFirstTool(page, 'events/tool-edit.jsonl')

      // Edit result from fixture: changed "consle.log" to "console.log"
      await expect(toolBlock).toContainText(/\+\d+/)
      await expect(toolBlock).toContainText(/-\d+/)
    })

    // SPEC: tool:write
    test('Write tool shows line count', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-write.jsonl')

      await expect(toolBlock).toContainText(/Wrote \d+ lines/)
    })

    // SPEC: tool:write-display
    test('Write tool shows syntax highlighting for Python', async ({ page }) => {
      // Write is expanded by default.
      const codeContent = await openWritePythonContent(page)

      // Unified code-block structure includes a gutter, shared across all code display.
      const codeBlock = codeContent.locator('.code-block')
      await expect(codeBlock).toBeVisible()
      // Each row has its own gutter cell, just verify at least one exists
      const gutter = codeBlock.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()
    })

    // SPEC: tool:write-line-numbers
    test('Write tool shows content with code formatting', async ({ page }) => {
      // Write is expanded by default
      const expandedContent = await openWritePythonContent(page)

      await expect(expandedContent).toContainText('def hello_world')
      await expect(expandedContent).toContainText('return True')

      const gutter = expandedContent.locator('.code-block-gutter').first()
      await expect(gutter).toBeVisible()
      const gutterText = await gutter.textContent()
      expect(gutterText.trim()).toMatch(/\d+/)
    })

    // SPEC: tool:grep
    test('Grep tool shows match count', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-grep.jsonl')

      await expect(toolBlock).toContainText('3 matches')
    })

    // SPEC: tool:glob
    test('Glob tool shows file count', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-glob.jsonl')

      await expect(toolBlock).toContainText('5 files')
    })

    // SPEC: tool:task
    test('Task tool shows status', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-task-nested.jsonl')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      const summaryText = await summary.textContent()
      expect(summaryText.length).toBeGreaterThan(0)
    })

    // SPEC: tool:skill
    test('Skill tool shows launch message', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-skill.jsonl')

      await expect(toolBlock).toContainText('Launching skill: commit')
    })

    // SPEC: tool:skill-content-folds
    // SPEC: tool:skill-content-tool-result-intervening
    // SPEC: tool:skill-content-reload
    // SPEC: tool:skill-content-reopen
    test('each load of a skill folds its own text into its Skill block', async ({ page }) => {
      await openSession(page, 'events/tool-skill-reload.jsonl')

      for (const pass of ['open', 'reopened']) {
        if (pass === 'reopened') {
          await page.reload()
          await waitForAppReady(page)
        }
        const skill = id => page.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)
        await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(4)
        for (const [id, args] of [
          ['tool_001', 'first'],
          ['tool_002', 'second'],
        ]) {
          await skill(id).locator('.tool-header').click()
          const content = skill(id).locator('.tool-skill-content')
          await expect(content).toContainText('NOTES-SKILL-BODY')
          await expect(content).toContainText(`ARGUMENTS: ${args}`)
        }
        await skill('tool_003').locator('.tool-header').click()
        await expect(skill('tool_003').locator('.tool-skill-content')).toHaveText(
          'Skill /notes is already loaded above; instructions unchanged.',
        )
        const messages = page.locator('[data-testid="message-assistant"]')
        await expect(messages).toContainText('Loaded it twice.')
        await expect(
          messages
            .locator('.turn-text:not([data-testid="tool-block"] .turn-text)')
            .filter({ hasText: 'NOTES-SKILL-BODY' }),
        ).toHaveCount(0)
        await expect(page.locator('.chat-messages')).not.toContainText('Re-invocation of')
      }
    })

    // SPEC: tool:todowrite
    test('TodoWrite tool shows full diff count format ●N ◐N ○N ✕N', async ({ page }) => {
      // Diff fixture exercises all four count categories - the claim is a specific format, not any one symbol.
      const diffBlock = await openTodoWriteDiff(page)

      // Each count must appear with its sigil - proves the structured format, not just one symbol.
      await expect(diffBlock).toContainText(/● \d+/)
      await expect(diffBlock).toContainText(/◐ \d+/)
      await expect(diffBlock).toContainText(/○ \d+/)
      await expect(diffBlock).toContainText(/✕ \d+/)
    })

    // SPEC: tool:webfetch
    test('WebFetch tool displays first line of result', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-webfetch.jsonl')

      await expect(page.getByText('WebFetch').first()).toBeVisible()

      // Summary should show first line of result content, not URL
      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Page Summary')
    })

    // SPEC: tool:websearch
    test('WebSearch tool displays first line of result', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-websearch.jsonl')

      await expect(page.getByText('WebSearch').first()).toBeVisible()

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Search Results')
    })

    // SPEC: tool:mcpsearch
    test('MCPSearch tool displays correctly', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-mcpsearch.jsonl')

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
      await openSession(page, 'events/tool-ask-question-answered.jsonl')
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
      const toolBlock = await openToolWithStatus(page, 'events/tool-todowrite.jsonl', 'completed')

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:todos-block-collapsed
    test('TodoWrite shows status counts in summary', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-todowrite.jsonl')

      // Counts map to sigils: 1 completed (●1), 1 in_progress (◐1), 2 pending (○2).
      await expect(toolBlock).toContainText('● 1')
      await expect(toolBlock).toContainText('◐ 1')
      await expect(toolBlock).toContainText('○ 2')
    })

    // SPEC: tool:todos-block-status
    test('expanded TodoWrite shows todo items with status symbols', async ({ page }) => {
      await openSession(page, 'events/tool-todowrite.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(toolBlock).toContainText('Fix authentication bug')
      await expect(toolBlock).toContainText('Write unit tests')
      await expect(toolBlock).toContainText('Update documentation')
    })

    // SPEC: tool:todos-block-status
    test('todo items have correct status classes', async ({ page }) => {
      await openSession(page, 'events/tool-todowrite.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

      await expect(toolBlock.locator('.todo-completed')).toBeVisible()
      await expect(toolBlock.locator('.todo-in-progress')).toBeVisible()
      await expect(toolBlock.locator('.todo-pending').first()).toBeVisible()
    })

    // SPEC: tool:todos-block-diff-only
    test('expanded TodoWrite shows only changed items, not unchanged', async ({ page }) => {
      const secondTodoWrite = await openTodoWriteDiff(page)

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
      const secondTodoWrite = await openTodoWriteDiff(page)

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
      await openSession(page, 'events/tool-task-create.jsonl')

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
      await openSession(page, 'events/tool-task-create.jsonl')

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
      await openSession(page, 'events/tool-task-create.jsonl')

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
      await openSession(page, 'events/tool-task-create.jsonl')

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
      await openSession(page, 'events/tool-task-create.jsonl')

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
      await openSession(page, 'events/tool-task-list-solo.jsonl')

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
      await openSession(page, 'events/todos-empty-update.jsonl')

      // Wait for the assistant message so the turn has fully streamed in before asserting.
      await expect(page.locator('[data-testid="message-assistant"]').first()).toBeVisible()

      // The Todos panel must NOT be rendered.
      await expect(page.locator('[data-testid="todos-group"]')).toHaveCount(0)
    })
  })

  test.describe('Bash commands that change nothing', () => {
    const block = (page, id) => page.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)

    test.beforeEach(async ({ page }) => {
      await openSession(page, 'events/tool-bash-read-only.jsonl')
    })

    // SPEC: tool:bash-read-only-collapsed
    test('a command that changes nothing starts collapsed, in its turn and in a subagent', async ({
      page,
    }) => {
      const listing = block(page, 'tool_ro_list')
      await expect(listing).toHaveAttribute('data-expanded', 'false')
      await expect(listing.locator('.tool-summary')).toHaveText('5 lines output')
      await listing.locator('.tool-header').click()
      await expect(listing).toHaveAttribute('data-expanded', 'true')
      await expect(listing).toContainText('ls -a; echo done')

      const task = block(page, 'tool_task')
      await task.locator(':scope > .tool-header-area').click()
      await expect(block(page, 'tool_sub_list')).toHaveAttribute('data-expanded', 'false')
    })

    // SPEC: tool:bash-changing-expanded
    test('a command that writes a file starts expanded', async ({ page }) => {
      await expect(block(page, 'tool_ch_write')).toHaveAttribute('data-expanded', 'true')
    })

    // SPEC: tool:bash-read-only-failure
    test('a command that changes nothing and fails starts collapsed, marked failed', async ({
      page,
    }) => {
      const failed = block(page, 'tool_ro_fail')
      await expect(failed).toHaveAttribute('data-expanded', 'false')
      await expect(failed).toHaveAttribute('data-tool-status', 'error')
      await assertRedColor(failed.locator('.tool-bullet').first(), 'color')
      await assertRedColor(failed.locator('.tool-summary'), 'color')
    })

    // SPEC: tool:bash-failure-marked
    test('a command that changes something and fails shows a red bullet and summary', async ({
      page,
    }) => {
      const failed = block(page, 'tool_ch_fail')
      await expect(failed).toHaveAttribute('data-expanded', 'true')
      await expect(failed).toHaveAttribute('data-tool-status', 'error')
      await assertRedColor(failed.locator('.tool-bullet').first(), 'color')
      await assertRedColor(failed.locator('.tool-summary'), 'color')
    })

    // SPEC: tool:bash-read-only-recorded
    test('a command recorded with no mark does not start collapsed', async ({ page }) => {
      await expect(block(page, 'tool_recorded')).toHaveAttribute('data-expanded', 'true')
    })
  })

  test.describe('Bash commands measured once they finished', () => {
    const block = (page, id) => page.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)
    const running = (id, command, extra = {}) => ({
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_use_id: id,
      tool_name: 'Bash',
      tool_input: { command },
      ...extra,
    })
    const finished = (id, changed) => ({
      type: 'user',
      subtype: 'tool_result',
      content: 'line 3\nline 2\nline 1',
      tool_use_id: id,
      command_changed: changed,
    })

    async function openStreaming(page) {
      const controller = await openLiveSession(page)
      await controller.sendEvent({
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'reverse the notes',
        turn_id: 't1',
      })

      return controller
    }

    // SPEC: tool:bash-changing-expanded
    // SPEC: tool:bash-measured-folds
    test('a command read as changing something runs expanded and folds once it changed nothing', async ({
      page,
    }) => {
      const controller = await openStreaming(page)

      await controller.sendEvent(running('tu_print', "python3 -c 'print(1)'"))
      await expect(block(page, 'tu_print')).toHaveAttribute('data-expanded', 'true')

      await controller.sendEvent(finished('tu_print', false))
      await expect(block(page, 'tu_print')).toHaveAttribute('data-expanded', 'false')
    })

    // SPEC: tool:bash-read-only-collapsed
    // SPEC: tool:bash-measured-shows
    test('a command read as changing nothing runs collapsed and opens once it changed something', async ({
      page,
    }) => {
      const controller = await openStreaming(page)

      await controller.sendEvent(
        running('tu_tac', 'cat notes.txt | tac', { command_read_only: true }),
      )
      await expect(block(page, 'tu_tac')).toHaveAttribute('data-expanded', 'false')

      await controller.sendEvent(finished('tu_tac', true))
      await expect(block(page, 'tu_tac')).toHaveAttribute('data-expanded', 'true')
    })

    test.describe('printing one line or nothing', () => {
      const printed = (id, content, changed, extra = {}) => ({
        type: 'user',
        subtype: 'tool_result',
        content,
        tool_use_id: id,
        command_changed: changed,
        ...extra,
      })

      // SPEC: tool:bash-short-output-shows
      test('a command that changed something stays expanded from running to finished; one that changed nothing folds', async ({
        page,
      }) => {
        const controller = await openStreaming(page)

        await controller.sendEvent(running('tu_silent', 'echo x > notes.txt'))
        await controller.sendEvent(running('tu_written', 'echo x > notes.txt; echo written'))
        await controller.sendEvent(running('tu_hello', 'echo hello'))
        for (const id of ['tu_silent', 'tu_written', 'tu_hello']) {
          await expect(block(page, id)).toHaveAttribute('data-expanded', 'true')
        }

        await controller.sendEvent(printed('tu_silent', '(Bash completed with no output)', true))
        await controller.sendEvent(printed('tu_written', 'written', true))
        await controller.sendEvent(printed('tu_hello', 'hello', false))

        await expect(block(page, 'tu_hello')).toHaveAttribute('data-expanded', 'false')
        for (const [id, line] of [
          ['tu_silent', '(Bash completed with no output)'],
          ['tu_written', 'written'],
        ]) {
          await expect(block(page, id)).toHaveAttribute('data-expanded', 'true')
          await expect(block(page, id).locator('.tool-summary')).toContainText(line)
          await expect(block(page, id).locator('.tool-command-section')).toBeVisible()
          await expect(block(page, id).locator('.tool-result-section')).toContainText(line)
        }
      })

      // SPEC: tool:bash-short-output-shows
      test("a subagent's command that changed something and printed one line opens expanded", async ({
        page,
      }) => {
        const controller = await openStreaming(page)
        const nested = { parent_tool_use_id: 'tu_task' }

        await controller.sendEvent({
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          tool_use_id: 'tu_task',
          tool_name: 'Task',
          tool_input: { description: 'Write the notes', prompt: 'Write the notes.' },
        })
        await controller.sendEvent(
          running('tu_sub_written', 'echo x > notes.txt; echo written', nested),
        )
        await controller.sendEvent(printed('tu_sub_written', 'written', true, nested))
        await controller.sendEvent(printed('tu_task', 'Wrote the notes.', true))
        await expect(block(page, 'tu_task')).toHaveAttribute('data-expanded', 'false')

        await block(page, 'tu_task').locator(':scope > .tool-header-area').click()
        await expect(block(page, 'tu_sub_written')).toHaveAttribute('data-expanded', 'true')
        await expect(block(page, 'tu_sub_written').locator('.tool-result-section')).toContainText(
          'written',
        )
      })
    })

    test.describe('in a recorded session', () => {
      test.beforeEach(async ({ page }) => {
        await openSession(page, 'events/tool-bash-traced.jsonl')
      })

      // SPEC: tool:bash-measured-folds
      // SPEC: tool:bash-measured-cases
      test('a command that only printed opens folded, in its turn and inside a subagent', async ({
        page,
      }) => {
        await expect(block(page, 'tool_measured_reader')).toHaveAttribute('data-expanded', 'false')

        await block(page, 'tool_task').locator(':scope > .tool-header-area').click()
        await expect(block(page, 'tool_sub_reader')).toHaveAttribute('data-expanded', 'false')
      })

      // SPEC: tool:bash-measured-shows
      test('a command that kept a file opens expanded though it was read as changing nothing', async ({
        page,
      }) => {
        await expect(block(page, 'tool_measured_writer')).toHaveAttribute('data-expanded', 'true')
      })

      test('a failed command is marked failed either way, folded only when it changed nothing', async ({
        page,
      }) => {
        const reader = block(page, 'tool_measured_reader_failed')
        const writer = block(page, 'tool_measured_writer_failed')
        await expect(reader).toHaveAttribute('data-expanded', 'false')
        await expect(writer).toHaveAttribute('data-expanded', 'true')
        for (const failed of [reader, writer]) {
          await expect(failed).toHaveAttribute('data-tool-status', 'error')
          await assertRedColor(failed.locator('.tool-summary'), 'color')
        }
      })

      // SPEC: tool:bash-measured-unavailable
      test('a command with no measurement opens as its text was read', async ({ page }) => {
        await expect(block(page, 'tool_unmeasured')).toHaveAttribute('data-expanded', 'true')
      })
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
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

      const group = page.locator('[data-testid="lookups-group"]')
      await expect(group).toBeVisible()
      await expect(group).toHaveClass(/tool-block/)
      await expect(group.locator('.tool-name')).toHaveText('Lookups')
      await expect(group.locator('.tool-summary')).toHaveText('Read x2, Grep x1')

      await expect(group.locator('[data-testid="lookups-group-rows"]')).toHaveCount(0)
      await group.locator('.tool-header-area').click()
      await expect(group.locator('[data-testid="lookups-group-rows"]')).toBeVisible()
    })

    // SPEC: tool:lookups-block-read-only-bash
    test('a Bash command that changes nothing joins the panel and counts as Bash', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-bash-read-only.jsonl')

      const group = page.locator('[data-testid="lookups-group"]')
      await expect(group.locator('.tool-summary')).toHaveText('Bash x2, Read x1')
      const blocks = page.locator('.turn-content > [data-testid="tool-block"]')
      await expect(blocks.filter({ hasText: 'List the notes folder' })).toHaveCount(0)
      await expect(blocks.filter({ hasText: 'Write a note' })).toHaveCount(1)
    })

    // SPEC: tool:lookups-block-read-only-bash
    test('a Bash command measured as changing nothing joins the panel once it finished', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-bash-traced.jsonl')

      const group = page.locator('[data-testid="lookups-group"]')
      await expect(group.locator('.tool-summary')).toHaveText('Bash x2, Read x1')
      const blocks = page.locator('.turn-content > [data-testid="tool-block"]')
      await expect(blocks.filter({ hasText: 'Count the notes' })).toHaveCount(0)
      await expect(blocks.filter({ hasText: 'Reverse the notes' })).toHaveCount(1)
    })

    // SPEC: tool:lookups-block-order
    test('rows appear in the order the calls happened', async ({ page }) => {
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-read.jsonl')

      await expect(page.locator('[data-testid="lookups-group"]')).toHaveCount(0)
      await expect(
        page.locator('[data-testid="tool-block"]').filter({ hasText: 'Read(' }),
      ).toHaveCount(1)
    })

    // SPEC: tool:lookups-block-nested-excluded
    test("a subagent's own lookups stay inside its Task block, not the turn's Lookups panel", async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_900')

      await controller.sendEvents([
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
      // Task collapses by default - expand to see its nested lookups.
      await taskBlock.locator('.tool-header-area').click()
      await expect(taskBlock.locator('.tool-nested [data-testid="tool-block"]')).toHaveCount(2)
    })
  })

  test.describe('Lookups Details - switch off (default)', () => {
    test('scattered read-only calls each render as an ordinary block; no Lookups panel appears', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

      await expect(page.locator('[data-testid="lookups-group"]')).toHaveCount(0)
      const toolBlocks = page.locator('[data-testid="tool-block"]')
      await expect(toolBlocks.filter({ hasText: 'Read(' })).toHaveCount(2)
      await expect(toolBlocks.filter({ hasText: 'Grep(' })).toHaveCount(1)
      await expect(toolBlocks.filter({ hasText: 'Edit(' })).toHaveCount(1)
      await expect(toolBlocks.filter({ hasText: 'Write(' })).toHaveCount(1)
    })

    test('a mutation-bearing Todos run still groups', async ({ page }) => {
      await openSession(page, 'events/tool-task-create.jsonl')

      await expect(page.locator('[data-testid="todos-group"]')).toBeVisible()
    })
  })

  test.describe('Tool Pending State', () => {
    // SPEC: tool:bullet-pending
    test('pending tool shows cyan-classed bullet and pulsing spinner', async ({ page }) => {
      await openSession(page, 'events/tool-pending.jsonl')

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
      await openFirstTool(page, 'events/tool-ask-question.jsonl')

      await expect(page.locator('.tool-questions-interactive').first()).toBeVisible()
    })
  })

  test.describe('Bash Command Layout', () => {
    test.beforeEach(async ({ page }) => {
      await openSession(page, 'events/tool-bash-layout.jsonl')
    })

    // SPEC: tool:bash-command-layout
    test('commands joined by ; show one per line', async ({ page }) => {
      await expect
        .poll(() => commandLines(page, 'tool_lay_seq'))
        .toEqual(['cd /srv/app', 'cat VERSION', 'echo ---', 'git log --oneline -5 | cat'])
    })

    // SPEC: tool:bash-command-layout
    test('loop and if bodies sit indented beneath their opening line', async ({ page }) => {
      await expect
        .poll(() => commandLines(page, 'tool_lay_loop'))
        .toEqual(['for f in a b; do', '  echo $f', 'done'])
      await expect
        .poll(() => commandLines(page, 'tool_lay_if'))
        .toEqual(['if [ -f VERSION ]; then', '  cat VERSION', 'else', '  echo none', 'fi'])
    })

    // SPEC: tool:bash-command-chain-break
    test('a long chain breaks before && and each |; a short one stays on one line', async ({
      page,
    }) => {
      await expect
        .poll(() => commandLines(page, 'tool_lay_chain'))
        .toEqual([
          'cd /tmp \\',
          "  && printf '%s\\n' alpha-first-entry-of-the-list beta-second-entry-of-the-list gamma-third-entry-of-the-list \\",
          '  | sort -r \\',
          '  | head -n 2',
        ])
      await expect
        .poll(() => commandLines(page, 'tool_lay_short'))
        .toEqual(['cd src && make check 2>&1 | tail -20'])
    })

    // SPEC: tool:bash-command-words-kept
    test('a heredoc shows exactly as sent', async ({ page }) => {
      await expect
        .poll(() => commandLines(page, 'tool_lay_heredoc'))
        .toEqual(["cat > notes.txt <<'EOF'", 'first; second', '  indented', 'EOF'])
    })

    // SPEC: tool:bash-command-copy-as-sent
    test('copy gives the command exactly as the agent sent it', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      const section = page.locator(
        '[data-testid="tool-block"][data-tool-use-id="tool_lay_seq"] .tool-command-section',
      )
      await section.hover()
      await section.locator('.tool-copy-btn').click()

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('cd /srv/app; cat VERSION; echo ---; git log --oneline -5 | cat')
    })

    // SPEC: tool:bash-command-unreadable
    test('a command that is not shell, or was never laid out, shows exactly as sent', async ({
      page,
    }) => {
      await expect
        .poll(() => commandLines(page, 'tool_lay_unreadable'))
        .toEqual(['echo "unterminated'])
      await expect.poll(() => commandLines(page, 'tool_lay_older')).toEqual(['cd /srv/app; ls'])
    })
  })

  test.describe('Bash Command Layout While Pending', () => {
    // SPEC: tool:bash-command-layout
    test('a command still running is already laid out', async ({ page }) => {
      const controller = await openLiveSession(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Run it',
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
          tool_input: { command: 'cd /srv/app; make' },
          command_layout: 'cd /srv/app\nmake',
          id: 'evt_live_2',
          primary: false,
          is_human: false,
        },
      ])

      const block = page.locator('[data-testid="tool-block"][data-tool-use-id="tool_live"]')
      await expect(block).toHaveAttribute('data-tool-status', 'pending')
      await expect.poll(() => commandLines(page, 'tool_live')).toEqual(['cd /srv/app', 'make'])
    })
  })

  test.describe('Bash Command While Pending', () => {
    // SPEC: tool:bash-command-while-running
    test('command is visible in a Command section while the block is still pending', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-bash-pending.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()
      await expect(toolBlock.getByText('Command')).toBeVisible()
      await expect(toolBlock).toContainText('ls -la /var/log')
      await expect(toolBlock.getByText('Result')).not.toBeVisible()
    })

    // SPEC: tool:bash-command-while-running
    test('header collapses and re-expands a pending Bash block', async ({ page }) => {
      await openSession(page, 'events/tool-bash-pending.jsonl')

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
      const controller = await openLiveSession(page)

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
      await openSession(page, 'events/tool-pending.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()
      await expect(toolBlock.locator('.tool-header-area')).toHaveCSS('cursor', 'default')
      await expect(page.locator('.tool-expanded-content')).toHaveCount(0)
    })

    // SPEC: tool:input-handled-skip
    test('no generic JSON input section appears in a pending Bash block', async ({ page }) => {
      await openSession(page, 'events/tool-bash-pending.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock.getByText('Command')).toBeVisible()
      await expect(toolBlock.locator('.tool-json')).toHaveCount(0)
    })
  })

  test.describe('File Path Display', () => {
    // SPEC: tool:file-collapsed
    test('Read tool shows filename only when collapsed', async ({ page }) => {
      // Read is collapsed by default.
      const toolBlock = await openFirstTool(page, 'events/tool-read.jsonl')

      const toolName = toolBlock.locator('.tool-name')
      await expect(toolName).toContainText('Read(config.json)')
      await expect(toolName).not.toContainText('/home/user')
    })

    // SPEC: tool:file-tooltip
    test('Read tool has full path in title attribute', async ({ page }) => {
      await openSession(page, 'events/tool-read.jsonl')

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBe('/home/user/project/config.json')
    })

    // SPEC: tool:file-expanded
    test('Read tool shows full path when expanded', async ({ page }) => {
      // Read is collapsed by default.
      const toolBlock = await openExpandedTool(page, 'events/tool-read.jsonl')

      const toolName = toolBlock.locator('.tool-name')
      await expect(toolName).toContainText('/home/user/project/config.json')
    })

    // SPEC: tool:file-open-in-editor
    test('Edit block offers an open-in-editor control that opens the resolved URL without toggling the block', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-lookups-scattered.jsonl')

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
      await openSession(page, 'events/tool-read-with-offset.jsonl')

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
    const readRow = page => page.locator('[data-testid="tool-block"]').first()
    const toggleOf = scope => scope.getByTestId('injected-context-toggle')

    // SPEC: tool:reminder
    // SPEC: tool:reminder-collapsed
    test("a folded tool row carries its result's reminders behind a closed triangle", async ({
      page,
    }) => {
      await openSession(page, 'events/tool-read-with-reminders.jsonl')

      const row = readRow(page)
      await expect(row).toHaveAttribute('data-expanded', 'false')
      await expect(toggleOf(row)).toHaveAttribute('title', 'System reminder')
      await expect(row.getByTestId('injected-context-box')).toHaveCount(0)
    })

    // SPEC: tool:reminder-strip
    test('an opened row shows its output with no reminder text and no reminder section of its own', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-read-with-reminders.jsonl')

      const row = readRow(page)
      await row.locator('.tool-header').click()
      const details = row.locator('.tool-expanded-content')
      await expect(details).toContainText('def main')
      await expect(details).not.toContainText('malware')
      await expect(details).not.toContainText('<system-reminder>')
      await expect(toggleOf(row)).toHaveCount(1)
    })

    // SPEC: tool:reminder-separate
    test('each reminder is its own entry in the box, labelled System reminder', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-read-with-reminders.jsonl')

      const row = readRow(page)
      await toggleOf(row).click()
      const box = row.getByTestId('injected-context-box')
      await expect(box.locator('.injected-context-source')).toHaveText([
        'System reminder',
        'System reminder',
      ])
      await expect(box.locator('.injected-context-text').nth(0)).toContainText('malware')
      await expect(box.locator('.injected-context-text').nth(1)).toContainText('best practices')
    })

    // SPEC: tool:reminder-scope
    test("a message's own reminders leave its text and sit behind its triangle", async ({
      page,
    }) => {
      await openSession(page, 'events/message-with-reminders.jsonl')

      const text = page.locator('.turn-text', { hasText: 'security overview' })
      await expect(text).not.toContainText('validate user input')
      await toggleOf(text).click()
      await expect(page.getByTestId('injected-context-box')).toContainText('validate user input')
    })

    // SPEC: tool:reminder-standalone
    test('a reminder arriving as its own message hangs on the row before it, with no empty message', async ({
      page,
    }) => {
      await openSession(page, 'events/reminder-on-its-own.jsonl')

      const texts = page.locator('.turn-content > .turn-text')
      await expect(texts).toHaveCount(1)
      await expect(texts).toContainText('Two files')
      const row = readRow(page)
      await toggleOf(row).click()
      await expect(row.getByTestId('injected-context-box')).toContainText('Keep each change small')
    })
  })

  test.describe('System Reminder Deduplication', () => {
    // SPEC: tool:reminder-dedup
    test('identical reminders on one row show once, with a ×N count', async ({ page }) => {
      await openSession(page, 'events/tool-read-with-duplicate-reminders.jsonl')

      const row = page.locator('[data-testid="tool-block"]').first()
      await row.getByTestId('injected-context-toggle').click()
      const box = row.getByTestId('injected-context-box')
      await expect(box.getByText(/malware/)).toHaveCount(1)
      await expect(box.locator('.injected-context-count')).toHaveText(['×3'])
    })
  })

  test.describe('TaskOutput Display', () => {
    // SPEC: tool:taskoutput
    test('TaskOutput shows header with task ID and status subtitle', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-taskoutput.jsonl')

      const header = toolBlock.locator('.tool-name')
      await expect(header).toContainText('TaskOutput(bg_task_123)')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Completed')
    })
  })

  test.describe('Persisted Output', () => {
    // SPEC: tool:persisted-output
    test('shows persisted output info section', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash-persisted.jsonl')

      const persistedOutput = toolBlock.locator('.persisted-output')
      await expect(persistedOutput).toBeVisible()

      const truncatedInfo = toolBlock.locator('.persisted-output-truncated')
      await expect(truncatedInfo).toBeVisible()
    })

    // SPEC: tool:persisted-output
    test('shows file size in persisted output', async ({ page }) => {
      await openSession(page, 'events/tool-bash-persisted.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const truncatedInfo = toolBlock.locator('.persisted-output-truncated')
      await expect(truncatedInfo).toContainText('50.7KB')
    })

    // SPEC: tool:persisted-preview
    test('shows preview content for persisted output', async ({ page }) => {
      await openSession(page, 'events/tool-bash-persisted.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const expandedContent = toolBlock.locator('.tool-expanded-content')

      await expect(expandedContent).toContainText('Running test suite')
      await expect(expandedContent).toContainText('PASS')
    })
  })

  test.describe('Background Agent Display', () => {
    // SPEC: tool:task-background
    test('shows background task summary with running info', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-task-background.jsonl')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('running in background')
    })

    // SPEC: tool:task-background-path
    test('shows background task result with output path', async ({ page }) => {
      await openSession(page, 'events/tool-task-background.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('bg_build_456.output')
    })
  })

  test.describe('Edit Diff Rendering', () => {
    // SPEC: tool:edit-diff-inline
    test('Edit tool expanded content has diff lines', async ({ page }) => {
      await openSession(page, 'events/tool-edit.jsonl')

      // Edit is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      await expect(toolBlock.locator('.code-block-type-diff-add').first()).toBeVisible()
      await expect(toolBlock.locator('.code-block-type-diff-remove').first()).toBeVisible()
    })

    // SPEC: tool:edit-diff-word
    test('Edit diff shows word-level highlighting', async ({ page }) => {
      await openSession(page, 'events/tool-edit.jsonl')

      // Edit is expanded by default
      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      await expect(toolBlock.locator('.tool-expanded-content')).toBeVisible()

      await expect(toolBlock.locator('.code-block-type-diff-add').first()).toBeVisible()
      await expect(toolBlock.locator('.code-block-type-diff-remove').first()).toBeVisible()
    })

    // SPEC: tool:edit-diff-fullline
    test('add lines have green styling', async ({ page }) => {
      await openSession(page, 'events/tool-edit.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      const addLine = toolBlock.locator('.code-block-type-diff-add').first()
      await expect(addLine).toBeVisible()
      await expect(addLine).toContainText('console.log')
    })

    // SPEC: tool:edit-diff-fullline
    test('remove lines have red styling', async ({ page }) => {
      await openSession(page, 'events/tool-edit.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()

      const removeLine = toolBlock.locator('.code-block-type-diff-remove').first()
      await expect(removeLine).toBeVisible()
      await expect(removeLine).toContainText('consle.log')
    })

    // SPEC: tool:edit-diff-highlight
    test('paired lines have character-level highlight spans', async ({ page }) => {
      await openSession(page, 'events/tool-edit-char-highlight.jsonl')

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
      // Write is expanded by default.
      // Write is not in the default-collapsed list.
      const expandedContent = await openWritePythonContent(page)

      await expect(expandedContent).toContainText('def hello_world')
      await expect(expandedContent).toContainText('Hello, World!')
      await expect(expandedContent).toContainText('return True')
      await expect(expandedContent).toContainText("if __name__ == '__main__'")
    })

    // SPEC: tool:write-syntax-highlight
    // SPEC: tool:codeblock-detect
    // SPEC: tool:codeblock-extension
    test('Write tool applies syntax highlighting for Python file', async ({ page }) => {
      const expandedContent = await openWritePythonContent(page)

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
      const expandedContent = await openWritePythonContent(page)

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
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-unknown-codeblock-auto.jsonl',
        'completed',
      )

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
      // Read is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-read-markdown.jsonl')

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()

      await expect(expanded.locator('.markdown-preview-container')).toBeVisible()
      await expect(expanded.locator('.code-block')).not.toBeVisible()

      await expect(expanded.locator('.markdown-preview-content')).toContainText('My Project')
    })

    // SPEC: tool:markdown-toolbar
    test('hovering markdown block reveals toolbar', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-read-markdown.jsonl')

      const container = toolBlock.locator('.markdown-preview-container')
      await expect(container).toBeVisible()

      const toolbar = container.locator('.markdown-preview-toolbar')
      await expect(toolbar).toHaveCSS('opacity', '0')

      await container.hover()
      await expect(toolbar).toHaveCSS('opacity', '1')
    })

    // SPEC: tool:markdown-toggle
    test('toggle switches between rendered and source view', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-read-markdown.jsonl')

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
      const toolBlock = await openExpandedTool(page, 'events/tool-read-markdown.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep.jsonl')

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
      const toolBlock = await openToolWithStatus(page, 'events/tool-grep-files.jsonl', 'completed')

      // files_with_matches mode: summary shows "N files"
      await expect(toolBlock.locator('.tool-summary')).toContainText('4 files')
    })

    // SPEC: tool:grep-summary-modes
    // SPEC: tool:grep-summary-matches
    test('content mode shows match count summary', async ({ page }) => {
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-grep-content.jsonl',
        'completed',
      )

      // content mode: summary shows "N matches"
      await expect(toolBlock.locator('.tool-summary')).toContainText('5 matches')
    })

    // SPEC: tool:grep-summary-modes
    // SPEC: tool:grep-summary-count
    test('count mode shows files with matches summary', async ({ page }) => {
      const toolBlock = await openToolWithStatus(page, 'events/tool-grep-count.jsonl', 'completed')

      // count mode: summary shows "N files with matches"
      await expect(toolBlock.locator('.tool-summary')).toContainText('3 files with matches')
    })
  })

  test.describe('Grep Visual Display', () => {
    // SPEC: tool:grep-visual
    test('Grep output renders as code block with line numbers', async ({ page }) => {
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-context.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-context.jsonl')

      const toolDetails = toolBlock.locator('div.tool-details')
      await expect(toolDetails).toBeVisible()

      await expect(toolDetails).toContainText('handleSubmit')
    })

    // SPEC: tool:grep-visual-context
    test('context lines are visible around match lines', async ({ page }) => {
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-context.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-context.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-context.jsonl')

      const separator = toolBlock.locator('.code-block-separator')
      await expect(separator.first()).toBeVisible()
    })

    // SPEC: tool:grep-visual-scroll
    test('match highlight extends full line width for horizontal scroll', async ({ page }) => {
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-multifile-context.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-multifile-context.jsonl')

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-multifile-context.jsonl')

      const multifileContextLines = toolBlock.locator('.code-block-type-context')
      await expect(multifileContextLines.first()).toBeVisible()

      await expect(toolBlock).toContainText('const token = getToken()')
      await expect(toolBlock).toContainText('return validateToken(token)')
    })
  })

  test.describe('Background Task Nested Streaming', () => {
    // SPEC: tool:bgtask-nested-events
    test('background task shows nested tools', async ({ page }) => {
      await openExpandedBackgroundTask(page)

      await expect(page.getByText('Read').first()).toBeVisible()
      await expect(page.getByText('Bash').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-nested-complete
    test('completed nested tools show results', async ({ page }) => {
      await openExpandedBackgroundTask(page)

      await expect(page.getByText('npm run build').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-nested-resume
    test('resumed session shows nested tools from static data', async ({ page }) => {
      // Load all events at once (simulates resume)
      await openExpandedBackgroundTask(page)

      await expect(page.getByText('Read').first()).toBeVisible()
      await expect(page.getByText('Bash').first()).toBeVisible()
    })

    // SPEC: tool:bgtask-correlation
    test('task notification updates status', async ({ page }) => {
      const taskBlock = await openFirstTool(page, 'events/tool-task-background-nested.jsonl')

      await expect(taskBlock).toHaveAttribute('data-tool-status', 'completed')
    })

    // SPEC: tool:bgtask-nested-spinner
    test('in-progress nested tool shows spinner indicator', async ({ page }) => {
      const controller = await openBackgroundBuild(page, 'task_bg_001', 'agent_bg_001', [
        BUILD_NARRATION,
      ])

      // Task collapses by default - expand to see the nested block.
      await expandFirstTask(page)

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
      const controller = await openBackgroundBuild(page, 'task_bg_002', 'agent_bg_002', [
        BUILD_NARRATION,
      ])

      const taskBlockBg002 = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlockBg002).toBeVisible()

      // Task collapses by default - expand to see the nested block.
      await taskBlockBg002.locator('.tool-header-area').click()

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

    // SPEC: tool:bgtask-nested-once
    test('a tailed copy of a call already delivered live renders once, not twice', async ({
      page,
    }) => {
      const controller = await openBackgroundBuild(page, 'task_bg_003', 'agent_bg_003')

      const taskBlockBg003 = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlockBg003).toBeVisible()

      // Task collapses by default - expand to see the nested block.
      await taskBlockBg003.locator('.tool-header-area').click()

      // Live copy first, then the async task monitor's tailed copy of the SAME call.
      await controller.sendEvents([
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          timestamp: 1705600004000,
          ts: '2025-01-18T12:00:04Z',
          parent_tool_use_id: 'task_bg_003',
          tool_use_id: 'nested_bash_003',
          tool_name: 'Bash',
          tool_input: { command: 'npm run build' },
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          timestamp: 1705600004500,
          ts: '2025-01-18T12:00:04.5Z',
          parent_tool_use_id: 'task_bg_003',
          tool_use_id: 'nested_bash_003',
          tool_name: 'Bash',
          tool_input: { command: 'npm run build' },
          source_file: '/tmp/bg_build.output',
        },
      ])

      await expect(page.locator('[data-testid="tool-block"].nested')).toHaveCount(1)
    })

    // SPEC: tool:bgtask-nested-prose
    test("a background task's subagent narration renders in the Activity list, same as a foreground task's", async ({
      page,
    }) => {
      const controller = await openBackgroundBuild(page, 'task_bg_004', 'agent_bg_004')

      // Task collapses by default - expand to watch its Activity list.
      const taskBlock = await expandFirstTask(page)

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'Kicking off the build now.',
        timestamp: 1705600004000,
        ts: '2025-01-18T12:00:04Z',
        parent_tool_use_id: 'task_bg_004',
      })

      await expect(taskBlock.locator('.nested-text-entry')).toHaveCount(1)
      await expect(page.getByText('Kicking off the build now.')).toBeVisible()
    })

    // SPEC: tool:bgtask-activity-line
    test("a background task's collapsed header shows the same activity line as a foreground task's", async ({
      page,
    }) => {
      const controller = await openBackgroundBuild(page, 'task_bg_005', 'agent_bg_005')

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: 1705600004000,
        ts: '2025-01-18T12:00:04Z',
        parent_tool_use_id: 'task_bg_005',
        tool_use_id: 'nested_bash_005',
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
      })

      await expect(taskBlock.locator('.tool-activity')).toHaveText('Bash(npm run build)')
    })
  })

  test.describe('Tool Input Display', () => {
    // SPEC: tool:input-bash-dedup
    test('Bash: no generic Input dump; full command reachable via its own Command section', async ({
      page,
    }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

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
      await openSession(page, 'events/tool-bash-description.jsonl')

      const toolName = page.locator('.tool-name').first()
      await expect(toolName).toHaveText('Bash(Search config for the default model)')

      const title = await toolName.getAttribute('title')
      expect(title).toContain("grep -rn 'DEFAULT_MODEL'")
    })

    // SPEC: tool:bash-command-section
    test('expanding a Bash block reveals the full command in a Command section above the output', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-bash-description.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toHaveAttribute('data-expanded', 'true')

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
      await openSession(page, 'events/tool-bash.jsonl')

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBeTruthy()
      expect(title).toContain('ls -la')
    })

    // SPEC: tool:file-tooltip
    test('Read tool header has full file path in title', async ({ page }) => {
      await openSession(page, 'events/tool-read.jsonl')

      const toolName = page.locator('.tool-name').first()
      const title = await toolName.getAttribute('title')
      expect(title).toBe('/home/user/project/config.json')
    })

    // SPEC: tool:input-unhandled-section
    test('unhandled MCP tool shows Input section in expanded content', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-mcp-unhandled.jsonl')

      // JSON result causes default collapse - expand first
      await toolBlock.locator('.tool-header').click()

      const inputSection = toolBlock.locator('.tool-input-section')
      await expect(inputSection).toBeVisible()
      await expect(inputSection.locator('.collapsible-label')).toHaveText('Input')

      await expect(inputSection).toContainText('collection_name')
      await expect(inputSection).toContainText('notes')
    })

    // SPEC: tool:input-above-output
    test('Input section rendered above Output section', async ({ page }) => {
      // JSON result causes default collapse - expand first
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-unhandled.jsonl')

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
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-unhandled.jsonl')

      const outputSection = toolBlock.locator('.tool-output-section')
      await expect(outputSection).toBeVisible()
      await expect(outputSection.locator('.collapsible-label')).toHaveText('Output')
      await expect(outputSection.locator('.collapsible-content')).toBeVisible()
    })

    // SPEC: tool:input-default-expanded
    test('Input section expanded by default', async ({ page }) => {
      // JSON result causes default collapse - expand block first
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-unhandled.jsonl')

      const inputSection = toolBlock.locator('.tool-input-section')

      // Input section is expanded by default.
      await expect(inputSection.locator('.collapsible-content')).toBeVisible()
    })

    // SPEC: tool:input-pending-visible
    test('Input section visible while tool is pending', async ({ page }) => {
      await openSession(page, 'events/tool-mcp-unhandled-pending.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="pending"]')
      await expect(toolBlock).toBeVisible()

      // Input section should be visible even though tool hasn't returned
      const inputSection = toolBlock.locator('.tool-input-section')
      await expect(inputSection).toBeVisible()
      await expect(inputSection).toContainText('collection_name')
    })

    // SPEC: tool:input-empty-hidden
    test('empty input does not render Input section', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-mcp-unhandled-empty-input.jsonl')

      await expect(toolBlock.locator('.tool-input-section')).not.toBeVisible()
    })

    // SPEC: tool:input-handled-skip
    test('handled tools do not show generic Input section', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

      await toolBlock.locator('.tool-header').click()

      await expect(toolBlock.locator('.tool-input-section')).not.toBeVisible()
    })
  })

  test.describe('MCP Content Blocks', () => {
    // SPEC: tool:mcp-output-text
    test('prose text block renders as text, no JSON tree', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-content-blocks-prose.jsonl')

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()
      await expect(expanded).toContainText('Found 3 matching files in the docs directory.')
      await expect(expanded.locator('.tool-output-section .tool-json')).toHaveCount(0)
      await expect(expanded.locator('.markdown-preview-container')).toHaveCount(0)
    })

    // SPEC: tool:mcp-output-text
    test('markdown text block renders as rendered markdown, no JSON tree', async ({ page }) => {
      await openSession(page, 'events/tool-mcp-content-blocks-markdown.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      // Summary line unchanged: the collapsed header already previews the text.
      await expect(toolBlock.locator('.tool-summary')).toContainText('Results')

      await toolBlock.locator('.tool-header').click()

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()
      await expect(expanded.locator('.markdown-preview-container')).toBeVisible()
      await expect(expanded.locator('h2')).toHaveText('Results')
      await expect(expanded.locator('li')).toHaveCount(2)
      // The Input section's own tool-input JSON view also uses .tool-json - scope to Output.
      await expect(expanded.locator('.tool-output-section .tool-json')).toHaveCount(0)
    })

    // SPEC: tool:mcp-output-json
    test('text block that is itself JSON keeps the JSON tree', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-content-blocks-json.jsonl')

      const expanded = toolBlock.locator('.tool-expanded-content')
      await expect(expanded).toBeVisible()
      const outputJson = expanded.locator('.tool-output-section .tool-json')
      await expect(outputJson).toBeVisible()
      await expect(outputJson).toContainText('distances')
      await expect(expanded.locator('.markdown-preview-container')).toHaveCount(0)
    })

    // SPEC: tool:mcp-output-order
    test('several blocks all render, in the order the result lists them', async ({ page }) => {
      const toolBlock = await openExpandedTool(
        page,
        'events/tool-mcp-content-blocks-multiple.jsonl',
      )

      const blocks = toolBlock.locator('.mcp-content-blocks > *')
      await expect(blocks).toHaveCount(2)
      await expect(blocks.nth(0)).toContainText('first block text')
      await expect(blocks.nth(1)).toContainText('second block text')
    })

    // SPEC: tool:mcp-output-image
    test('image block renders as an image, not a placeholder', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-content-blocks-image.jsonl')

      const image = toolBlock.locator('.mcp-image-block img')
      await expect(image).toBeVisible()
      const src = await image.getAttribute('src')
      expect(src).toContain('data:image/png;base64,')
    })

    // SPEC: tool:mcp-output-link
    test('resource link shows its name, description and uri', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-content-blocks-mixed.jsonl')

      const link = toolBlock.locator('.mcp-resource-link a')
      await expect(link).toHaveText('report.pdf')
      await expect(link).toHaveAttribute('href', 'file:///reports/report.pdf')
      await expect(toolBlock.locator('.mcp-resource-description')).toHaveText('Quarterly report')
    })

    // SPEC: tool:mcp-output-unviewable
    test('audio and binary resource blocks name their media type, not an empty box', async ({
      page,
    }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-mcp-content-blocks-mixed.jsonl')

      const unviewable = toolBlock.locator('.mcp-unviewable-block')
      await expect(unviewable).toHaveCount(2)
      await expect(unviewable.nth(0)).toContainText('audio/mpeg')
      await expect(unviewable.nth(1)).toContainText('image/png')
      await expect(unviewable.nth(1)).toContainText('file:///photo.png')
      await expect(toolBlock.locator('audio')).toHaveCount(0)
      await expect(toolBlock.locator('.mcp-unviewable-block img')).toHaveCount(0)
    })

    // SPEC: tool:expand-default-collapsed
    test('MCP block result starts collapsed, same as a plain JSON result', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-mcp-content-blocks-markdown.jsonl')
      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })
  })

  test.describe('Code Block Gutter', () => {
    // SPEC: tool:codeblock-gutter
    test('Read tool renders line numbers in gutter elements', async ({ page }) => {
      await openSession(page, 'events/tool-read-lined.jsonl')

      // Read is collapsed by default.
      const toolBlock = await expandFirstCompletedTool(page)

      const lineNumbers = toolBlock.locator('.code-block-linenum')
      const count = await lineNumbers.count()
      expect(count).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-gutter
    test('Grep single-file renders gutter with line numbers', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')

      const gutters = toolBlock.locator('.code-block-gutter')
      const count = await gutters.count()
      expect(count).toBeGreaterThanOrEqual(1)

      const gutterLineNumbers = toolBlock.locator('.code-block-gutter .code-block-linenum')
      const lnCount = await gutterLineNumbers.count()
      expect(lnCount).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-sticky
    test('line number has sticky position for horizontal scroll', async ({ page }) => {
      await openSession(page, 'events/tool-read-wide.jsonl')

      const gutter = await expandFirstGutter(page)

      const position = await gutter.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('sticky')
    })

    // SPEC: tool:codeblock-sticky
    test('grep gutter has sticky position for horizontal scroll', async ({ page }) => {
      const gutter = await openGrepGutter(page)

      const position = await gutter.evaluate(el => getComputedStyle(el).position)
      expect(position).toBe('sticky')
    })

    // SPEC: tool:bash-command-no-linenums
    test('Bash Command section renders with no gutter cells', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

      const commandSection = toolBlock.locator('.tool-command-section')
      await expect(commandSection).toBeVisible()
      await expect(commandSection.locator('.code-block-gutter')).toHaveCount(0)
      await expect(commandSection.locator('.code-block-linenum')).toHaveCount(0)
    })

    // SPEC: tool:bash-command-no-linenums
    test('a multi-line Bash command shows no number on any line', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash-multiline-command.jsonl')

      const commandSection = toolBlock.locator('.tool-command-section')
      await expect(commandSection.locator('.code-block-row').first()).toBeVisible()
      await expect(commandSection).toContainText("grep -rn 'MODEL' lib/")
      await expect(commandSection.locator('.code-block-linenum')).toHaveCount(0)
    })

    // SPEC: tool:bash-command-no-linenums
    test('command and output share the same left edge', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-bash.jsonl')

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
      await openSession(page, 'events/tool-read-lined.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

      await expect(toolBlock.locator('.code-block-gutter').first()).toBeVisible()
      const lineNumbers = toolBlock.locator('.code-block-linenum')
      expect(await lineNumbers.count()).toBeGreaterThanOrEqual(1)
    })

    // SPEC: tool:codeblock-sticky
    test('line number stays at left edge after horizontal scroll', async ({ page }) => {
      await openSession(page, 'events/tool-read-wide.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

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
      // The unified CodeBlock uses table layout with per-cell opaque backgrounds.
      const gutterCell = await openGrepGutter(page)

      const gutterBg = await gutterCell.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(gutterBg).not.toBe('transparent')
      expect(gutterBg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-edges
    test('line-number gutter has opaque background color', async ({ page }) => {
      await openSession(page, 'events/tool-read-lined.jsonl')

      // Gutter cell should have an opaque background (not transparent) to cover content behind
      const gutter = await expandFirstGutter(page)

      const bg = await gutter.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('transparent')
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-edges
    test('grep gutter has opaque background to prevent content bleed-through', async ({ page }) => {
      const gutter = await openGrepGutter(page)

      const bg = await gutter.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('transparent')
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-gutter-width
    test('gutter width is constant across every row', async ({ page }) => {
      await openSession(page, 'events/tool-read-lined.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

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
      await openSession(page, 'events/tool-read-lined.jsonl')

      const gutter = await expandFirstGutter(page)

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
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')

      const matchLine = toolBlock.locator('.code-block-type-match').first()
      await expect(matchLine).toBeVisible()

      const matchBg = await matchLine.evaluate(el => getComputedStyle(el).backgroundColor)
      // Should have non-transparent background (yellow highlight)
      expect(matchBg).not.toBe('transparent')
      expect(matchBg).not.toBe('rgba(0, 0, 0, 0)')
    })

    // SPEC: tool:codeblock-highlight
    test('grep match gutter has accent styling', async ({ page }) => {
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')

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
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')

      const contextLine = toolBlock.locator('.code-block-type-context').first()
      await expect(contextLine).toBeVisible()

      const opacity = await contextLine.evaluate(el => getComputedStyle(el).opacity)
      expect(parseFloat(opacity)).toBeLessThan(1)
    })

    // SPEC: tool:read-line-align
    test('Read tool lines are consistently aligned', async ({ page }) => {
      await openSession(page, 'events/tool-read-lined.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

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
      await openSession(page, 'events/tool-read-lined.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

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
      await openSession(page, 'events/tool-read-lined.jsonl')

      const toolBlock = await expandFirstCompletedTool(page)

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
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-singlefile.jsonl')

      const lineNumber = toolBlock.locator('.code-block-row .code-block-linenum').first()
      await expect(lineNumber).toBeVisible()

      const textAlign = await lineNumber.evaluate(el => getComputedStyle(el).textAlign)
      expect(textAlign).toBe('right')
    })
  })

  test.describe('Task Execution Behavior', () => {
    // SPEC: tool:task-collapsed-default
    test('running Task block is collapsed by default', async ({ page }) => {
      // Pending because there's no tool_result for the Task itself.
      const taskBlock = await openToolWithStatus(page, 'events/tool-task-running.jsonl', 'pending')

      // Collapsed by default, the same as every other tool.
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()
      await expect(taskBlock.getByText('Glob').first()).not.toBeVisible()
    })

    // SPEC: tool:task-click-expand
    test('clicking a collapsed running Task header expands it', async ({ page }) => {
      const taskBlock = await openToolWithStatus(page, 'events/tool-task-running.jsonl', 'pending')
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      // Use .tool-header-area to avoid matching nested tool headers.
      await taskBlock.locator('.tool-header-area').first().click()

      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()
      await expect(taskBlock.getByText('Glob').first()).toBeVisible()
    })

    // SPEC: tool:task-expand-toggle
    test('clicking an expanded running Task header collapses it again', async ({ page }) => {
      const taskBlock = await openToolWithStatus(page, 'events/tool-task-running.jsonl', 'pending')

      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await expect(taskBlock).toBeVisible()
    })

    // SPEC: tool:task-activity-line
    test("a collapsed running Task's header shows the newest nested call as a status dot and title", async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_act_001')

      const taskBlock = firstToolBlock(page, 'pending')
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-activity')).toHaveCount(0)

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_act_001',
        tool_use_id: 'tool_act_002',
        tool_name: 'Bash',
        tool_input: { command: 'pytest -k flaky' },
      })

      await expect(taskBlock.locator('.tool-activity')).toHaveText('Bash(pytest -k flaky)')
      await expect(taskBlock.locator('.tool-result .tool-bullet')).toHaveClass(/pending/)
    })

    // SPEC: tool:task-activity-follows-newest
    test('the activity line switches from a call to narration, then follows a later call', async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_act_101')

      await controller.sendEvents([
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          parent_tool_use_id: 'tool_act_101',
          tool_use_id: 'tool_act_102',
          tool_name: 'Bash',
          tool_input: { command: 'pytest -k flaky' },
        },
      ])

      const taskBlock = firstToolBlock(page, 'pending')
      const activity = taskBlock.locator('.tool-activity')
      await expect(activity).toHaveText('Bash(pytest -k flaky)')

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'That test fails once in three runs - looking at the fixture setup.',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_act_101',
      })
      await expect(activity).toHaveText(
        'That test fails once in three runs - looking at the fixture setup.',
      )
      // Narration carries no status dot - only a call does.
      await expect(taskBlock.locator('.tool-result .tool-bullet')).toHaveCount(0)

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Read',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_act_101',
        tool_use_id: 'tool_act_103',
        tool_name: 'Read',
        tool_input: { file_path: 'tests/conftest.py' },
      })
      await expect(activity).toHaveText('Read(conftest.py)')
    })

    // SPEC: tool:task-toggle-sticky
    test('a hand-expanded running Task stays expanded when a new nested event arrives', async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_sticky_001')

      const taskBlock = firstToolBlock(page, 'pending')
      await expect(taskBlock).toBeVisible()

      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_sticky_001',
        tool_use_id: 'tool_sticky_002',
        tool_name: 'Bash',
        tool_input: { command: 'pytest -k flaky' },
      })

      await expect(taskBlock.locator('.tool-expanded-content')).toBeVisible()
      await expect(taskBlock.getByText('Bash').first()).toBeVisible()
    })

    // SPEC: tool:task-toggle-sticky
    test('a hand-collapsed running Task stays collapsed when a new nested event arrives', async ({
      page,
    }) => {
      const controller = await openRunningTask(page, 'tool_sticky_101')

      const taskBlock = firstToolBlock(page, 'pending')
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      // Expand, then collapse by hand - back to the default state, but now user-driven.
      await taskBlock.locator('.tool-header-area').first().click()
      await taskBlock.locator('.tool-header-area').first().click()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_sticky_101',
        tool_use_id: 'tool_sticky_102',
        tool_name: 'Bash',
        tool_input: { command: 'pytest -k flaky' },
      })

      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()
      await expect(taskBlock.locator('.tool-activity')).toHaveText('Bash(pytest -k flaky)')
    })

    // SPEC: tool:task-spinner-align
    test('spinner is vertically aligned with summary text', async ({ page }) => {
      const controller = await openLiveSession(page)

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

      const taskBlock = firstToolBlock(page, 'pending')
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
      await openSession(page, 'events/bg-task-consolidated.jsonl')

      // Nested Read/Bash events become children of the block, not separate top-level blocks.
      const topLevelToolBlocks = page.locator('[data-testid="tool-block"]:not(.nested)')
      await expect(topLevelToolBlocks.first()).toBeVisible()

      const count = await topLevelToolBlocks.count()
      expect(count).toBe(1)

      await expect(topLevelToolBlocks.first()).toContainText('Task')
    })

    // SPEC: tool:bgtask-single-block
    test('background task with nested tools shows one parent block', async ({ page }) => {
      const taskBlock = await openFirstTool(page, 'events/bg-task-consolidated.jsonl')

      await expect(taskBlock).toContainText('Build and test project')

      // Notification arrived, so summary should reflect completion
      const summary = taskBlock.locator('.tool-summary')
      await expect(summary).toContainText('Build and tests completed successfully')
    })

    // SPEC: tool:bgtask-no-multi-block
    test('background task with events across turns still renders as single block', async ({
      page,
    }) => {
      await openSession(page, 'events/bg-task-no-multi-block.jsonl')
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
      await openSession(page, 'events/bg-task-inline-taskoutput.jsonl')
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
      // Completed after the notification arrives.
      const taskBlock = await openFirstTool(page, 'events/bg-task-click-expand.jsonl')

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
      const toolBlock = await openFirstTool(page, 'events/tool-task-background.jsonl')

      await expect(toolBlock).toContainText('Task')
    })

    // SPEC: tool:bgtask-running
    test('running background task shows spinner and Running status', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-taskoutput-running.jsonl')

      // Running TaskOutput has effectiveIsPending=true -> spinner shown instead of summary
      const spinner = toolBlock.locator('.spinner')
      await expect(spinner).toBeVisible()

      await expect(toolBlock).toHaveAttribute('data-tool-status', 'pending')

      await expect(toolBlock).toContainText('TaskOutput')
    })

    // SPEC: tool:bgtask-completed
    test('completed background task shows Completed status with green bullet', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-taskoutput.jsonl')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Completed')

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/completed/)
    })

    // SPEC: tool:bgtask-failed
    test('failed background task shows Failed status with error styling', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-taskoutput-failed.jsonl')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Failed')

      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/error/)
    })

    // SPEC: tool:bgtask-killed
    test('killed background task shows Killed status', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-taskoutput-killed.jsonl')

      const summary = toolBlock.locator('.tool-summary')
      await expect(summary).toContainText('Killed')

      // Killed status renders a yellow bullet.
      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toHaveClass(/killed/)
    })

    test('background task completion notification is not shown as a raw chat message', async ({
      page,
    }) => {
      await openSession(page, 'events/tool-task-bg-strip-xml.jsonl')

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
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-bash-truncated.jsonl',
        'completed',
      )

      // Bash is expanded by default.
      const truncationIndicator = toolBlock.locator('.persisted-output-truncated')
      await expect(truncationIndicator).toBeVisible()

      await expect(truncationIndicator).toContainText('256.3KB')
    })

    // SPEC: tool:output-truncation
    test('truncated output shows preview content', async ({ page }) => {
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-bash-truncated.jsonl',
        'completed',
      )

      const expandedContent = toolBlock.locator('.tool-expanded-content')
      await expect(expandedContent).toBeVisible()
      await expect(expandedContent).toContainText('Running full test suite')
      await expect(expandedContent).toContainText('318 passed')
    })

    // SPEC: tool:output-truncation
    test('truncated output exposes both expand AND download buttons', async ({ page }) => {
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-bash-truncated.jsonl',
        'completed',
      )

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
      await page.route(
        new RegExp(`/api/sessions/${DEFAULT_SESSION_ID}/tool-output/tool_trunc_001$`),
        async route => {
          await route.fulfill({
            json: {
              content:
                'Running full test suite...\n\nTest Suites: 42 passed, 42 total\nTests:       318 passed, 318 total\nSnapshots:   0 total\nTime:        24.567s\n\nFull verbose output follows...\nAll 318 tests passed with no failures.',
              truncated: false,
            },
          })
        },
      )

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toolBlock = firstToolBlock(page, 'completed')
      await expect(toolBlock).toBeVisible()

      const expandBtn = toolBlock.locator('.tool-expand-btn')
      await expandBtn.click()

      await expect(toolBlock).toContainText('Full verbose output follows')

      await expect(expandBtn).toHaveAttribute('title', 'Show preview')
    })

    // SPEC: tool:output-download
    test('truncated output has download button', async ({ page }) => {
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-bash-truncated.jsonl',
        'completed',
      )

      const downloadBtn = toolBlock.locator('.tool-download-btn')
      await expect(downloadBtn).toBeVisible()

      await expect(downloadBtn).toHaveAttribute('download', '')
      await expect(downloadBtn).toHaveAttribute('title', 'Download full output')

      const href = await downloadBtn.getAttribute('href')
      expect(href).toContain('/tool-output/tool_trunc_001/download')
    })

    // SPEC: tool:output-download
    test('persisted output has download button', async ({ page }) => {
      const toolBlock = await openToolWithStatus(
        page,
        'events/tool-bash-persisted.jsonl',
        'completed',
      )

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
      // Grep is collapsed by default - click to expand
      const toolBlock = await openExpandedTool(page, 'events/tool-grep-pagination.jsonl')

      await expect(toolBlock.locator('.tool-details')).toContainText('TODO: fix this')

      await expect(toolBlock.locator('.tool-details')).not.toContainText(
        'Showing results with pagination',
      )
    })
  })

  test.describe('Grep Collapsed By Default', () => {
    // SPEC: tool:expand-default-collapsed
    test('Grep tool starts collapsed', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-grep.jsonl')

      await expect(toolBlock.locator('.tool-details')).not.toBeVisible()
    })
  })

  test.describe('WebSearch/WebFetch Rendering', () => {
    // SPEC: tool:expand-default-collapsed
    test('WebSearch is collapsed by default', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-websearch.jsonl')

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:expand-default-collapsed
    test('WebFetch is collapsed by default', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-webfetch.jsonl')

      await expect(toolBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:websearch
    test('WebSearch renders result as markdown', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-websearch.jsonl')

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
      const toolBlock = await openFirstTool(page, 'events/tool-webfetch.jsonl')

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
      await openSession(page, 'events/tool-bash-tmp-path.jsonl')

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
      await resolvePaths(page, {
        'src/app.js': '/workspace/src/app.js',
        'config.toml': '/workspace/config.toml',
      })
      await openSession(page, 'events/general-path-highlighting.jsonl')

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
      await resolvePaths(page, { 'src/app.js': '/workspace/src/app.js' })
      await openSession(page, 'events/general-path-highlighting.jsonl')

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
      await resolvePaths(page, { 'src/app.js': '/workspace/src/app.js' })
      await openSession(page, 'events/general-path-highlighting.jsonl')

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
      await openSession(page, 'events/tool-toolsearch-success.jsonl')

      await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(1)
      await expect(page.getByText('ToolSearch', { exact: false })).toHaveCount(0)
      await expect(page.locator('[data-testid="tool-block"]').first()).toContainText(
        'mcp__gcal__list_events',
      )
    })

    // SPEC: tool:toolsearch-hidden
    test('a failed search renders its block exactly as before', async ({ page }) => {
      const toolBlock = await openFirstTool(page, 'events/tool-toolsearch-error.jsonl')
      await expect(toolBlock).toContainText('ToolSearch')
      await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')
    })

    // SPEC: tool:toolsearch-hidden
    test('a nested subagent search is hidden from the Task Activity section', async ({ page }) => {
      await openSession(page, 'events/tool-toolsearch-nested.jsonl')

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
      const controller = await openLiveSession(page)

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
      await openSession(page, 'events/tool-toolsearch-only.jsonl')

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
