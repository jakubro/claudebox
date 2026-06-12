/** E2E visual regression tests using toHaveScreenshot for key UI states. */

import { devices, expect, test } from '@playwright/test'
import {
  closeAllSidePanels,
  openBookmarksPanel,
  openHelpPanel,
  openLogsPanel,
  openSessionsPanel,
  openSkillsPanel,
  openStashPanel,
  openTasksPanel,
  openTodosPanel,
  openUsagePanel,
  waitForAppReady,
  waitForMobileReady,
} from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import {
  createDaemonSSEController,
  createLogsSSEController,
  createSSEController,
  mockSSE,
} from '../mocks/sse.js'

/** Shared screenshot options: tolerate minor anti-aliasing differences. */
const OPTS = { maxDiffPixelRatio: 0.01 }
const OPTS_ANIM = { maxDiffPixelRatio: 0.02 }

// Mobile device descriptor with `defaultBrowserType` stripped - Playwright disallows
// changing the browser type inside a describe-scoped `test.use()`.
const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5']

/**
 * Wait for a tool block to render and return the first one.
 * @param {import('@playwright/test').Page} page
 */
async function waitForToolBlock(page) {
  const block = page.locator('[data-testid="tool-block"]').first()
  await expect(block).toBeVisible()
  return block
}

// ---------------------------------------------------------------------------
// Layout & Golden States
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Layout', () => {
  test('default layout with all panels', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page).toHaveScreenshot('layout-default.png', OPTS)
  })

  test('all panels closed - chat fills viewport', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // State-aware close: only clicks panels that are currently visible. Blind
    // Alt+N toggles flip state instead of forcing closed, so the end state
    // depended on the default-open set (Boards opened, Tasks stayed open).
    await closeAllSidePanels(page)

    // Wait for layout to fully settle after all panels closed
    await page.waitForTimeout(300)
    await expect(page).toHaveScreenshot('layout-chat-only.png', OPTS)
  })

  test('footer in ready state', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="footer"]')).toHaveScreenshot('footer-ready.png', OPTS)
  })

  test('sessions panel with session list', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSessionsPanel(page)
    await expect(page.locator('[data-testid="panel-sessions"]')).toHaveScreenshot(
      'sessions-panel.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Turn States
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Turns', () => {
  test('empty chat state', async ({ page }) => {
    await mockSSE(page, 'events/empty.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'empty-chat.png',
      OPTS,
    )
  })

  test('simple conversation', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'simple-chat.png',
      OPTS,
    )
  })

  test('active response with spinner', async ({ page }) => {
    const controller = await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'What is 2 + 2?',
        timestamp: Date.now(),
        turn_id: 'turn_active',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Let me calculate that for you...',
        timestamp: Date.now() + 100,
      },
    ])

    await expect(page.getByText('Let me calculate that for you...')).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'active-response.png',
      {
        ...OPTS_ANIM,
        mask: [page.locator('.progress-spinner')],
      },
    )
  })

  test('error turn with red border', async ({ page }) => {
    await mockSSE(page, 'events/chat-with-error.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.getByText('Do something that fails').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'error-turn.png',
      OPTS,
    )
  })

  test('interrupted turn with yellow border', async ({ page }) => {
    await mockSSE(page, 'events/interrupted-turn.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.getByText('Once upon a time').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'interrupted-turn.png',
      OPTS,
    )
  })

  test('multi-turn conversation', async ({ page }) => {
    await mockSSE(page, 'events/multi-turn.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'multi-turn.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Core File Tools
// ---------------------------------------------------------------------------

test.describe('Visual Regression - File Tools', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('Read tool (collapsed)', async ({ page }) => {
    await mockSSE(page, 'events/tool-read.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-read-collapsed.png', OPTS)
  })

  test('Read tool (expanded with line numbers)', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-lined.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await block.locator('.tool-header-area').click()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-read-expanded.png', OPTS)
  })

  test('Read tool with large content (collapsible)', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-large.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-read-large.png', OPTS)
  })

  test('Read tool with wide content (horizontal scroll)', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-wide.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await block.locator('.tool-header-area').click()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-read-wide.png', OPTS)
  })

  test('Edit tool with diff', async ({ page }) => {
    await mockSSE(page, 'events/tool-edit.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-edit-collapsed.png', OPTS)
  })

  test('Edit tool with character-level diff highlighting', async ({ page }) => {
    await mockSSE(page, 'events/tool-edit-char-highlight.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-edit-char-diff.png', OPTS)
  })

  test('Write tool with syntax highlighting', async ({ page }) => {
    await mockSSE(page, 'events/tool-write-python.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-write-python.png', OPTS)
  })

  test('Read markdown file renders as formatted preview', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-markdown.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Read is collapsed by default - click to expand
    const block = await waitForToolBlock(page)
    await block.locator('.tool-header').click()
    await expect(block.locator('.markdown-preview-container')).toBeVisible()

    await expect(block).toHaveScreenshot('tool-read-markdown.png', OPTS)
  })

  test('Glob tool', async ({ page }) => {
    await mockSSE(page, 'events/tool-glob.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-glob.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Bash
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Bash Tool', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('Bash tool expanded with output', async ({ page }) => {
    await mockSSE(page, 'events/tool-bash.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bash-expanded.png', OPTS)
  })

  test('Bash tool with error', async ({ page }) => {
    await mockSSE(page, 'events/tool-with-error.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bash-error.png', OPTS)
  })

  test('Bash tool with truncated output', async ({ page }) => {
    await mockSSE(page, 'events/tool-bash-truncated.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bash-truncated.png', OPTS)
  })

  test('Bash tool with persisted output', async ({ page }) => {
    await mockSSE(page, 'events/tool-bash-persisted.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bash-persisted.png', OPTS)
  })

  test('Bash tool multiline error', async ({ page }) => {
    await mockSSE(page, 'events/tool-error-multiline.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-error-multiline.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Grep
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Grep Tool', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('Grep with match context', async ({ page }) => {
    await mockSSE(page, 'events/tool-grep-context.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await block.locator('.tool-header-area').click()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-grep-context.png', OPTS)
  })

  test('Grep multifile with context', async ({ page }) => {
    await mockSSE(page, 'events/tool-grep-multifile-context.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await block.locator('.tool-header-area').click()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-grep-multifile.png', OPTS)
  })

  test('Grep single file with line numbers', async ({ page }) => {
    await mockSSE(page, 'events/tool-grep-singlefile.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await block.locator('.tool-header-area').click()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-grep-singlefile.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Interactive (AskUser, ExitPlan)
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Interactive Tools', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('AskUserQuestion form', async ({ page }) => {
    await mockSSE(page, 'events/tool-ask-question.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block.locator('.tool-questions-interactive')).toBeVisible()
    await expect(block).toHaveScreenshot('tool-askuser-form.png', OPTS)
  })

  test('AskUserQuestion answered state', async ({ page }) => {
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-askuser-answered.png', OPTS)
  })

  test('ExitPlanMode with plan content', async ({ page }) => {
    await mockSSE(page, 'events/tool-exit-plan.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-exitplan.png', OPTS)
  })

  test('ExitPlanMode answered', async ({ page }) => {
    await mockSSE(page, 'events/tool-exit-plan-answered.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-exitplan-answered.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Tasks & Background
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Task Tools', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('Task with nested tools', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-nested.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-task-nested.png', OPTS)
  })

  test('Background task consolidated', async ({ page }) => {
    await mockSSE(page, 'events/bg-task-consolidated.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bgtask-consolidated.png', OPTS)
  })

  test('Background task with nested tools', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-background-nested.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-bgtask-nested.png', OPTS)
  })

  test('TaskOutput completed', async ({ page }) => {
    await mockSSE(page, 'events/tool-taskoutput.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-taskoutput-completed.png', OPTS)
  })

  test('TaskOutput running', async ({ page }) => {
    await mockSSE(page, 'events/tool-taskoutput-running.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-taskoutput-running.png', {
      ...OPTS_ANIM,
      mask: [page.locator('.progress-spinner'), page.locator('.tool-bullet')],
    })
  })

  test('TaskOutput failed', async ({ page }) => {
    await mockSSE(page, 'events/tool-taskoutput-failed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-taskoutput-failed.png', OPTS)
  })

  test('TaskOutput killed', async ({ page }) => {
    await mockSSE(page, 'events/tool-taskoutput-killed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-taskoutput-killed.png', OPTS)
  })

  test('TodoWrite with diff', async ({ page }) => {
    await mockSSE(page, 'events/tool-todowrite-diff.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-todowrite-diff.png', OPTS)
  })

  test('TodoWrite collapsed with status counts', async ({ page }) => {
    await mockSSE(page, 'events/tool-todowrite.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-todowrite-collapsed.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Web & MCP Tools
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Web & MCP Tools', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('WebSearch tool', async ({ page }) => {
    await mockSSE(page, 'events/tool-websearch.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-websearch.png', OPTS)
  })

  test('WebFetch tool', async ({ page }) => {
    await mockSSE(page, 'events/tool-webfetch.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-webfetch.png', OPTS)
  })

  test('Skill tool', async ({ page }) => {
    await mockSSE(page, 'events/tool-skill.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-skill.png', OPTS)
  })

  test('MCPSearch tool', async ({ page }) => {
    await mockSSE(page, 'events/tool-mcpsearch.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-mcpsearch.png', OPTS)
  })

  test('Unhandled MCP tool with Input/Output sections', async ({ page }) => {
    await mockSSE(page, 'events/tool-mcp-unhandled.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-mcp-unhandled.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Special Rendering
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Special Blocks', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('Thinking block', async ({ page }) => {
    await mockSSE(page, 'events/thinking.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.thinking-block').first()).toBeVisible()
    const turn = page.locator('.turn-container').first()
    await expect(turn).toHaveScreenshot('thinking-block.png', OPTS)
  })

  test('Compaction block', async ({ page }) => {
    await mockSSE(page, 'events/compaction.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.compaction-block').first()).toBeVisible()
    await expect(page.locator('.compaction-block').first()).toHaveScreenshot(
      'compaction-block.png',
      OPTS,
    )
  })

  test('Compaction in progress', async ({ page }) => {
    await mockSSE(page, 'events/compaction-in-progress.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.compaction-block').first()).toBeVisible()
    await expect(page.locator('.compaction-block').first()).toHaveScreenshot(
      'compaction-in-progress.png',
      {
        ...OPTS_ANIM,
        mask: [page.locator('.compaction-spinner, .progress-spinner')],
      },
    )
  })

  test('Mermaid diagram', async ({ page }) => {
    await mockSSE(page, 'events/mermaid-diagram.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.mermaid-container').first()).toBeVisible()
    await expect(page.locator('.mermaid-container').first()).toHaveScreenshot(
      'mermaid-diagram.png',
      OPTS,
    )
  })

  test('System reminders in tool output', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-with-reminders.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-with-reminders.png', OPTS)
  })

  test('Duplicate system reminders with count badge', async ({ page }) => {
    await mockSSE(page, 'events/tool-read-with-duplicate-reminders.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-with-duplicate-reminders.png', OPTS)
  })

  test('Markdown rendering (code, lists, links)', async ({ page }) => {
    await mockSSE(page, 'events/chat-with-markdown.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'markdown-rendering.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Tool Blocks - Pending State
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Pending States', () => {
  test('pending tool with spinner', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-pending.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = await waitForToolBlock(page)
    await expect(block).toHaveScreenshot('tool-pending.png', {
      ...OPTS_ANIM,
      mask: [page.locator('.progress-spinner'), page.locator('.tool-bullet')],
    })
  })
})

// ---------------------------------------------------------------------------
// User Message Variants
// ---------------------------------------------------------------------------

test.describe('Visual Regression - User Messages', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('user message with command output (stdout/stderr)', async ({ page }) => {
    await mockSSE(page, 'events/user-message-with-command-output.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'user-msg-command-output.png',
      OPTS,
    )
  })

  test('user message with AskUser Q/A response', async ({ page }) => {
    await mockSSE(page, 'events/user-message-askuser-response.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'user-msg-askuser-response.png',
      OPTS,
    )
  })

  test('slash command in user message', async ({ page }) => {
    await mockSSE(page, 'events/slash-command-message.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'user-msg-slash-command.png',
      OPTS,
    )
  })

  test('chat with image attachments', async ({ page }) => {
    await mockSSE(page, 'events/chat-with-attachments.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'user-msg-attachments.png',
      OPTS,
    )
  })

  test('non-human text with local command output', async ({ page }) => {
    await mockSSE(page, 'events/nonhuman-text-with-command-output.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'user-msg-nonhuman-command.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Side Panels with Content
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Side Panels', () => {
  test('todos panel with subagent sections', async ({ page }) => {
    await mockSSE(page, 'events/todos-subagent.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTodosPanel(page)
    await expect(page.locator('[data-testid="panel-todos"]')).toHaveScreenshot(
      'panel-todos-subagent.png',
      OPTS,
    )
  })

  test('commands panel with Custom tab', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSkillsPanel(page)
    await expect(page.locator('.skills-panel')).toHaveScreenshot('panel-skills.png', OPTS)
  })

  test('MCP panel with servers', async ({ page }) => {
    await mockSSE(page, 'events/with-mcp-servers.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.keyboard.press('Alt+8')
    await expect(page.locator('.mcp-panel')).toBeVisible()
    await expect(page.locator('.mcp-panel')).toHaveScreenshot('panel-mcp.png', OPTS)
  })

  test('logs panel with entries', async ({ page }) => {
    const logs = await createLogsSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openLogsPanel(page)
    await logs.sendLog({
      timestamp: '2025-01-18T12:00:00.000Z',
      level: 'info',
      logger: 'claudebox.session',
      message: 'Session started successfully',
    })
    await logs.sendLog({
      timestamp: '2025-01-18T12:00:01.000Z',
      level: 'debug',
      logger: 'claudebox.pipeline',
      message: 'Processing event batch (5 events)',
    })
    await logs.sendLog({
      timestamp: '2025-01-18T12:00:02.000Z',
      level: 'error',
      logger: 'claudebox.containers',
      message: 'Container health check failed: timeout',
    })

    await expect(page.locator('.logs-panel')).toHaveScreenshot('panel-logs.png', OPTS)
  })

  test('stash panel with items', async ({ page }) => {
    await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Stash some items via keyboard
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('First stashed message with important context')
    await page.keyboard.press('Control+s')
    await input.fill('Second stashed item')
    await page.keyboard.press('Control+s')

    await openStashPanel(page)
    await expect(page.locator('.stash-panel')).toHaveScreenshot('panel-stash.png', OPTS)
  })

  test('sessions panel with forked tree (parent + child)', async ({ page }) => {
    // The with-children fixture has session-002 forked from session-001;
    // SessionsPanel renders the forked child nested under the parent in a
    // tree. Snapshot guards the indentation and connector chrome.
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, { sessionsFixture: 'sessions/with-children.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSessionsPanel(page)
    await expect(page.locator('[data-testid="panel-sessions"]')).toHaveScreenshot(
      'sessions-panel-forked-tree.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Overlays', () => {
  test('resume replay overlay', async ({ page }) => {
    await mockSSE(page, 'events/resuming.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    await expect(page.locator('.chat-replay-overlay')).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'overlay-resume.png',
      OPTS_ANIM,
    )
  })

  test('creation overlay with progress', async ({ page }) => {
    let resolveNewSession
    const newSessionPromise = new Promise(resolve => {
      resolveNewSession = resolve
    })
    const daemon = await createDaemonSSEController(page)
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await newSessionPromise
          await route.fulfill({
            status: 200,
            json: { session_id: 'vr-session', container_id: 'vr-ctr', name: null },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()
    await daemon.sendProgress('Creating container')

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'overlay-creation.png',
      OPTS_ANIM,
    )

    resolveNewSession()
  })

  test('welcome state (no session)', async ({ page }) => {
    await mockSSE(page, 'events/empty.jsonl')
    await mockAPI(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'welcome-state.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Header & Tab Bar
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Header & Tab Bar', () => {
  test('header bar default state', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.dv-tabs-and-actions-container').first()).toHaveScreenshot(
      'header-default.png',
      OPTS,
    )
  })

  test('session header strip - active session with running container', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const strip = page.locator('[data-testid="session-header-strip"]')
    await expect(strip.locator('[data-testid="session-header-status-dot"]')).toBeVisible()
    await expect(strip.locator('[data-testid="session-header-stop-btn"]')).toBeVisible()
    await expect(strip).toHaveScreenshot('session-header-strip-active.png', OPTS)
  })

  test('session header strip - welcome state', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    const strip = page.locator('[data-testid="session-header-strip"]')
    await expect(strip).toBeVisible()
    // Welcome state: LEFT slot empty (no dot, no name, no stop button).
    await expect(strip.locator('[data-testid="session-header-status-dot"]')).toHaveCount(0)
    await expect(strip).toHaveScreenshot('session-header-strip-welcome.png', OPTS)
  })

  test('session header strip - creating spinner', async ({ page }) => {
    let resolveNewSession
    const newSessionPromise = new Promise(resolve => {
      resolveNewSession = resolve
    })
    await mockSSE(page)
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await newSessionPromise
          await route.fulfill({
            status: 200,
            json: { session_id: 'new-session', container_id: 'new-ctr', name: null },
          })
        },
      },
    })
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()
    // Wait for the strip to show the Creating… text rather than a stable wait.
    await expect(page.locator('text=Creating…')).toBeVisible()

    const strip = page.locator('[data-testid="session-header-strip"]')
    await expect(strip).toHaveScreenshot('session-header-strip-creating.png', {
      ...OPTS_ANIM,
      mask: [strip.locator('.spin')],
    })

    resolveNewSession()
  })

  test('new session split button chevron menu open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Header-strip chevron is the second button after the +.
    const strip = page.locator('[data-testid="session-header-strip"]')
    await strip.locator('.new-session-split-chevron').click()
    await expect(page.locator('.new-session-dropdown')).toBeVisible()

    await expect(strip).toHaveScreenshot('header-new-session-menu-open.png', OPTS)
  })

  test('confirm stop modal - stop variant', async ({ page }) => {
    await mockSSE(page, 'events/responding.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Force the modal open by injecting React state via a known interaction:
    // click Stop while events show isResponding. Fallback: render the modal
    // directly via DOM injection if responding state isn't reachable in mock.
    const stopBtn = page.locator('[data-testid="session-header-stop-btn"]')
    if (await stopBtn.count()) {
      await stopBtn.click()
    }
    const modal = page.locator('[data-testid="confirm-stop-modal"]')
    if (await modal.count()) {
      await expect(modal).toHaveScreenshot('confirm-stop-modal-stop.png', OPTS)
    }
  })

  test('confirm stop modal - reload variant', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Inject the reload-variant chrome directly so the snapshot captures the
    // distinct detail text deterministically. The component's data-testids are
    // the SPEC contract; the rest follows from the variant prop.
    await page.evaluate(() => {
      const root = document.createElement('div')
      root.className = 'confirm-stop-overlay'
      root.innerHTML =
        '<div class="confirm-stop-modal" data-testid="confirm-stop-modal-mock">' +
        '<p class="confirm-stop-modal-title" data-testid="confirm-stop-modal-title">Claude is working</p>' +
        '<p class="confirm-stop-modal-detail" data-testid="confirm-stop-modal-detail">Reloading will end the response. Continue?</p>' +
        '<div class="confirm-stop-modal-actions">' +
        '<button type="button" class="confirm-stop-modal-cancel" data-testid="confirm-stop-modal-cancel">Cancel</button>' +
        '<button type="button" class="confirm-stop-modal-confirm" data-testid="confirm-stop-modal-confirm">Continue</button>' +
        '</div></div>'
      document.body.appendChild(root)
    })
    const modal = page.locator('[data-testid="confirm-stop-modal-mock"]')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveScreenshot('confirm-stop-modal-reload.png', OPTS)
  })

  test('rewind split-button chevron menu shows two options', async ({ page }) => {
    // Regression guard: the chevron lists "Rewind here" and "Rewind in new
    // browser tab" - no third option.
    await mockSSE(page, 'events/rewind-point.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const firstTurn = page.locator('.turn-container').first()
    await firstTurn.hover()
    await page.locator('.message-rewind-chevron').first().click()
    await expect(page.locator('.rewind-dropdown')).toBeVisible()

    await expect(firstTurn).toHaveScreenshot('rewind-chevron-menu.png', OPTS)
  })

  test('chat-control-bar fork chevron menu shows two options', async ({ page }) => {
    // Regression guard: chat-control-bar fork dropdown lists "Fork here" and
    // "Fork in new browser tab" - no third option.
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.chat-control-fork-chevron').click()
    const dropdown = page.locator('.chat-control-fork-dropdown')
    await expect(dropdown).toBeVisible()

    await expect(dropdown).toHaveScreenshot('chat-control-bar-fork-menu.png', OPTS)
  })

  test('still running toast', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Force the toast to render via the context; mocked path so the snapshot
    // reflects the toast chrome regardless of upstream emit timing.
    await page.evaluate(() => {
      const toast = document.createElement('button')
      toast.type = 'button'
      toast.className = 'still-running-toast'
      toast.setAttribute('data-testid', 'still-running-toast-mock')
      toast.innerHTML =
        '<span class="still-running-toast-text">Session <strong>Test Session</strong> still running</span>' +
        '<span class="still-running-toast-cta">click to return</span>'
      document.body.appendChild(toast)
    })
    const toast = page.locator('[data-testid="still-running-toast-mock"]')
    await expect(toast).toBeVisible()
    await expect(toast).toHaveScreenshot('still-running-toast.png', OPTS)
  })

  test('workspace switcher with multiple workspaces', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await page.route('**/api/workspaces', async route => {
      await route.fulfill({
        json: {
          workspaces: [
            { id: 'ws-main', path: '/home/user/project', name: 'project' },
            { id: 'ws-docs', path: '/home/user/docs', name: 'docs' },
            { id: 'ws-infra', path: '/home/user/infrastructure', name: 'infrastructure' },
          ],
        },
      })
    })
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Click the workspace switcher
    const switcher = page.locator('[data-testid="workspace-switcher"]')
    await switcher.click()
    await page.waitForTimeout(200)

    await expect(page).toHaveScreenshot('workspace-switcher-open.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Input Area States
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Input Area', () => {
  test('input area empty', async ({ page }) => {
    await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.chat-input-wrapper')).toHaveScreenshot('input-empty.png', OPTS_ANIM)
  })

  test('input area with text', async ({ page }) => {
    await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill(
      'Can you help me refactor this function to use async/await instead of callbacks?',
    )

    await expect(page.locator('.chat-input-wrapper')).toHaveScreenshot(
      'input-with-text.png',
      OPTS_ANIM,
    )
  })

  test('input area with attachment chips', async ({ page }) => {
    await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Simulate pasting a file via DataTransfer
    const input = page.locator('[data-testid="chat-input"]')
    await input.focus()
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['hello world'], 'example.txt', { type: 'text/plain' }))
      dt.items.add(new File(['body { color: red }'], 'styles.css', { type: 'text/css' }))
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
      document.querySelector('[data-testid="chat-input"]').dispatchEvent(event)
    })
    await page.waitForTimeout(300)

    await expect(page.locator('.chat-input-wrapper')).toHaveScreenshot(
      'input-attachments.png',
      OPTS_ANIM,
    )
  })

  test('input area disabled during active response', async ({ page }) => {
    await mockSSE(page, 'events/responding.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.chat-input-wrapper')).toHaveScreenshot('input-disabled.png', {
      ...OPTS_ANIM,
      mask: [page.locator('.progress-spinner')],
    })
  })
})

// ---------------------------------------------------------------------------
// Panel Coverage Gaps
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Additional Panels', () => {
  test('bookmarks panel empty', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBookmarksPanel(page)
    await expect(page.locator('.bookmarks-panel')).toHaveScreenshot(
      'panel-bookmarks-empty.png',
      OPTS,
    )
  })

  test('bookmarks panel with items', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, {
      handlers: {
        getUIState: async route => {
          await route.fulfill({
            json: {
              global: {
                bookmarkedTurns: { 'test-session-001': ['turn_001'] },
                bookmarkMeta: {
                  'test-session-001/turn_001': {
                    preview: 'Hello Claude',
                    ts: '2025-01-18T12:00:00Z',
                  },
                },
              },
              session: {},
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBookmarksPanel(page)
    await expect(page.locator('.bookmarks-panel')).toHaveScreenshot(
      'panel-bookmarks-items.png',
      OPTS,
    )
  })

  test('bookmarks panel all sessions tab', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: {
        getUIState: async route => {
          await route.fulfill({
            json: {
              global: {
                bookmarkedTurns: {
                  'test-session-001': ['turn_001'],
                  'test-session-002': ['turn_abc'],
                },
                bookmarkMeta: {
                  'test-session-001/turn_001': {
                    preview: 'Hello Claude',
                    ts: '2025-01-18T12:00:00Z',
                  },
                  'test-session-002/turn_abc': {
                    preview: 'Help me implement auth',
                    ts: '2025-01-18T08:00:00Z',
                  },
                },
              },
              session: {},
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBookmarksPanel(page)
    // Click "All sessions" tab
    await page.getByText('All sessions').click()
    await page.waitForTimeout(200)
    await expect(page.locator('.bookmarks-panel')).toHaveScreenshot('panel-bookmarks-all.png', OPTS)
  })

  test('usage panel with session costs', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, { sessionsFixture: 'sessions/with-costs.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openUsagePanel(page)
    await expect(page.locator('.usage-panel')).toHaveScreenshot('panel-usage.png', OPTS)
  })

  test('tasks panel empty', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTasksPanel(page)
    await expect(page.locator('.tasks-panel')).toHaveScreenshot('panel-tasks-empty.png', OPTS)
  })

  test('tasks panel with running task', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-running.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openTasksPanel(page)
    await expect(page.locator('.tasks-panel')).toHaveScreenshot('panel-tasks-running.png', {
      ...OPTS_ANIM,
      mask: [page.locator('.progress-spinner'), page.locator('.tool-bullet')],
    })
  })

  test('help panel', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openHelpPanel(page)
    await expect(page.locator('.help-panel')).toHaveScreenshot('panel-help.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Minimap & Effort Picker
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Minimap & Controls', () => {
  test('minimap with long conversation', async ({ page }) => {
    await mockSSE(page, 'events/long-conversation.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Ensure minimap is visible (pinned by default)
    await page.waitForTimeout(300)
    const minimap = page.locator('[data-testid="minimap"]')
    await expect(minimap).toBeVisible()
    await expect(minimap).toHaveScreenshot('minimap-long.png', OPTS)
  })

  test('minimap with bookmarked turns', async ({ page }) => {
    await mockSSE(page, 'events/long-conversation.jsonl')
    await mockAPI(page, {
      handlers: {
        getUIState: async route => {
          await route.fulfill({
            json: {
              global: {
                bookmarkedTurns: {
                  'test-session-001': ['turn_003', 'turn_008', 'turn_014'],
                },
                bookmarkMeta: {
                  'test-session-001/turn_003': {
                    preview: 'Bookmarked turn 3',
                    ts: '2025-01-18T12:02:00Z',
                  },
                  'test-session-001/turn_008': {
                    preview: 'Bookmarked turn 8',
                    ts: '2025-01-18T12:08:00Z',
                  },
                  'test-session-001/turn_014': {
                    preview: 'Bookmarked turn 14',
                    ts: '2025-01-18T12:14:00Z',
                  },
                },
              },
              session: {},
            },
          })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.waitForTimeout(300)
    const minimap = page.locator('[data-testid="minimap"]')
    await expect(minimap).toBeVisible()
    await expect(minimap).toHaveScreenshot('minimap-bookmarks.png', OPTS)
  })

  test('effort picker dropdown open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Click effort picker in footer
    const effortLabel = page.locator('[data-testid="footer-effort"]')
    await effortLabel.click()
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="footer"]')).toHaveScreenshot(
      'effort-picker-open.png',
      OPTS,
    )
  })

  test('model picker dropdown open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const modelBtn = page.locator('[data-testid="footer-model"]')
    await modelBtn.click()
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="footer"]')).toHaveScreenshot(
      'model-picker-open.png',
      OPTS,
    )
  })

  test('permission-mode picker dropdown open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const permBtn = page.locator('[data-testid="footer-permission-mode-picker"]')
    await permBtn.click()
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="footer"]')).toHaveScreenshot(
      'permission-picker-open.png',
      OPTS,
    )
  })

  test('control bar during active response', async ({ page }) => {
    const controller = await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Do something complex',
        timestamp: Date.now(),
        turn_id: 'turn_active',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Working on it...',
        timestamp: Date.now() + 100,
      },
    ])

    await expect(page.getByText('Working on it...')).toBeVisible()
    await expect(page.locator('.dv-tabs-and-actions-container').first()).toHaveScreenshot(
      'control-bar-active.png',
      {
        ...OPTS_ANIM,
        mask: [page.locator('.progress-spinner')],
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Special States
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Special States', () => {
  test('permission plan mode divider', async ({ page }) => {
    await mockSSE(page, 'events/permission-plan-mode.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'permission-plan-mode.png',
      OPTS,
    )
  })

  test('rewind button on human message', async ({ page }) => {
    await mockSSE(page, 'events/rewind-point.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Hover over the first user message to reveal rewind button
    const firstTurn = page.locator('.turn-container').first()
    await firstTurn.hover()
    await page.waitForTimeout(200)

    await expect(firstTurn).toHaveScreenshot('rewind-point.png', OPTS)
  })

  test('block timings visible', async ({ page }) => {
    await mockSSE(page, 'events/block-timings.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container').first()).toBeVisible()
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'block-timings.png',
      OPTS,
    )
  })

  test('setting change dividers - model + effort + bypass', async ({ page }) => {
    // Combined fixture exercises three divider variants in one snapshot:
    // model_changed, effort_level_changed, permission_mode_changed (bypass).
    // Existing 'permission plan mode divider' covers Plan; this fills the rest.
    await mockSSE(page, 'events/model-mode-effort-changes.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.turn-container')).toHaveCount(2)
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot(
      'setting-change-dividers.png',
      OPTS,
    )
  })
})

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

const BOARDS_WS_PREFIX = `/api/workspaces/${DEFAULT_WORKSPACE_ID}`

const BOARD_LIST = {
  boards: [{ id: 'sprint-1', name: 'sprint-1', path: 'docs/tickets/board.yaml' }],
}

const BOARD_DETAIL = {
  id: 'sprint-1',
  name: 'sprint-1',
  yaml_path: '/workspace/docs/tickets/board.yaml',
  prompt: {},
  states: [
    { id: 'backlog', label: 'Backlog', folder: 'backlog', terminal: false },
    { id: 'in-progress', label: 'In Progress', folder: 'in-progress', terminal: false },
    { id: 'review', label: 'Review', folder: 'review', terminal: false },
    { id: 'done', label: 'Done', folder: 'completed', terminal: true },
  ],
  swimlanes: [
    { id: 'frontend', name: 'Frontend' },
    { id: 'backend', name: 'Backend' },
  ],
  columns: {
    backlog: [
      { path: 'docs/tickets/active/setup.md', title: 'Setup infra', swimlane: 'frontend' },
      { path: 'docs/tickets/active/boards.md', title: 'Boards', swimlane: 'backend' },
    ],
    'in-progress': [
      {
        path: 'docs/tickets/active/polish.md',
        title: 'Polish UI',
        swimlane: 'frontend',
        session: 'session-001',
      },
    ],
    review: [],
    done: [{ path: 'docs/tickets/active/init.md', title: 'Init project' }],
  },
}

/** Inline board API mock for visual regression - kept self-contained. */
async function mockBoardsForVisuals(page) {
  await page.route(`**${BOARDS_WS_PREFIX}/boards`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: BOARD_LIST })
    } else {
      await route.continue()
    }
  })
  await page.route(
    new RegExp(`${BOARDS_WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
    async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: BOARD_DETAIL })
      } else {
        await route.continue()
      }
    },
  )
  await page.route(
    new RegExp(`${BOARDS_WS_PREFIX}/boards/[^/]+/tickets/.+/content`.replace(/\//g, '\\/')),
    async route => {
      await route.fulfill({ body: '# Setup infra\n\nTicket body content for the visual test.' })
    },
  )
}

/**
 * Lighter-weight ready check for board routes - the boards URL has no active
 * session so waitForAppReady's chat-input enabled wait stalls. This waits
 * for footer + workspace label + fonts only.
 */
async function waitForBoardReady(page) {
  await expect(page.locator('[data-testid="footer"]')).toBeVisible()
  await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('Visual Regression - Boards', () => {
  test('board view - kanban with swimlanes', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await mockBoardsForVisuals(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)
    await waitForBoardReady(page)

    await expect(page.locator('.board-board')).toBeVisible()
    await expect(page.locator('.board-board')).toHaveScreenshot('board-view-default.png', OPTS)
  })

  test('board view - terse density', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await mockBoardsForVisuals(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1?density=terse`)
    await waitForBoardReady(page)

    await expect(page.locator('.board-board')).toBeVisible()
    await expect(page.locator('.board-board')).toHaveScreenshot('board-view-terse.png', OPTS)
  })

  test('board view - ticket detail overlay open', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await mockBoardsForVisuals(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)
    await waitForBoardReady(page)

    await page.getByText('Setup infra').click()
    const overlay = page.locator('.ticket-detail-panel')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveScreenshot('board-ticket-detail.png', OPTS)
  })
})

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe('Visual Regression - Mobile', () => {
  test.use({ ...PIXEL_5, hasTouch: true })

  test('mobile layout - default', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page).toHaveScreenshot('mobile-layout-default.png', OPTS)
  })

  test('mobile top bar', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-top-bar')).toHaveScreenshot('mobile-topbar.png', OPTS)
  })

  test('mobile status strip', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.status-strip')).toHaveScreenshot('mobile-status-strip.png', OPTS)
  })

  test('mobile input area - empty', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.chat-input-row')).toHaveScreenshot('mobile-input-empty.png', OPTS)
  })

  test('mobile input area - with text', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    const input = await waitForMobileReady(page)

    await input.fill('Hello from mobile')
    await expect(page.locator('.chat-input-row')).toHaveScreenshot(
      'mobile-input-with-text.png',
      OPTS,
    )
  })

  test('mobile drawer - open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('button[title="Menu"]').click()
    await expect(page.locator('.mobile-drawer')).toBeVisible()
    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot('mobile-drawer-open.png', OPTS)
  })

  test('mobile drawer - multiple sessions', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('button[title="Menu"]').click()
    await expect(page.locator('.mobile-drawer')).toBeVisible()
    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot('mobile-drawer-sessions.png', OPTS)
  })

  test('details sheet - open', async ({ page }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('button[title="Session details"]').click()
    await expect(page.locator('.details-sheet')).toBeVisible()
    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot('mobile-details-sheet.png', OPTS)
  })

  test('mobile - active response', async ({ page }) => {
    await mockSSE(page, 'events/responding.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page).toHaveScreenshot('mobile-active-response.png', OPTS_ANIM)
  })

  test('mobile - empty chat', async ({ page }) => {
    await mockSSE(page, 'events/empty.jsonl')
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page).toHaveScreenshot('mobile-empty-chat.png', OPTS)
  })
})
