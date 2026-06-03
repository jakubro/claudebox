/** E2E tests for todos panel functionality. */

import { expect, test } from '@playwright/test'
import { openTodosPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Todos Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Todo List Display', () => {
    test.beforeEach(async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)
    })

    // SPEC: panel-todo:readonly
    test('displays todo items from TodoWrite events', async ({ page }) => {
      // tool-todowrite.jsonl has 4 todos
      await expect(page.getByText('Fix authentication bug')).toBeVisible()
      await expect(page.getByText('Write unit tests')).toBeVisible()
      await expect(page.getByText('Update documentation')).toBeVisible()
      await expect(page.getByText('Review PR')).toBeVisible()

      // Verify read-only: no interactive checkbox or input elements within todo items
      const todoPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todoPanel.locator('input[type="checkbox"]')).toHaveCount(0)
      await expect(todoPanel.locator('input[type="text"]')).toHaveCount(0)
    })

    // SPEC: panel-todo:status-icons
    test('shows status icons for different states', async ({ page }) => {
      const todoPanel = page.locator('[data-testid="panel-todos"]')

      // Wait for todos
      await expect(page.getByText('Fix authentication bug')).toBeVisible()

      // ○=pending, ◐=in_progress, ●=completed
      await expect(todoPanel.getByText('○').first()).toBeVisible()
      await expect(todoPanel.getByText('◐')).toBeVisible()
      await expect(todoPanel.getByText('●')).toBeVisible()
    })

    // SPEC: panel-todo:strikethrough
    test('completed items have strikethrough styling', async ({ page }) => {
      await expect(page.getByText('Fix authentication bug')).toBeVisible()

      const completedTodo = page.locator('.todo-completed')
      await expect(completedTodo).toBeVisible()

      // Strikethrough applied on .todo-content child within .todo-completed
      const todoContent = completedTodo.locator('.todo-content').first()
      await expect(todoContent).toBeVisible()
      const textDecoration = await todoContent.evaluate(
        el => getComputedStyle(el).textDecorationLine,
      )
      expect(textDecoration).toContain('line-through')
    })
  })

  test.describe('Empty State', () => {
    // SPEC: panel-todo:empty
    test('shows empty message when no todos', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      const todoPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todoPanel).toContainText('No todos yet')
    })
  })

  test.describe('Subagent Segmentation', () => {
    // SPEC: panel-todo:main-first
    test('main agent todos appear first without section header', async ({ page }) => {
      await mockSSE(page, 'events/todos-subagent.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      const sections = page.locator('[data-testid="todo-section"]')
      await expect(sections).toHaveCount(2)

      // First section has no header
      const firstSection = sections.first()
      await expect(firstSection.locator('[data-testid="todo-section-header"]')).not.toBeAttached()
      await expect(firstSection.getByText('Set up project structure')).toBeVisible()
    })

    // SPEC: panel-todo:subagent-section
    test('subagent todos grouped under labeled section', async ({ page }) => {
      await mockSSE(page, 'events/todos-subagent.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      const sections = page.locator('[data-testid="todo-section"]')
      const subagentSection = sections.nth(1)

      // Has section header
      await expect(subagentSection.locator('[data-testid="todo-section-header"]')).toBeVisible()

      // Contains subagent todos
      await expect(subagentSection.getByText('Create components')).toBeVisible()
      await expect(subagentSection.getByText('Add styling')).toBeVisible()
    })

    // SPEC: panel-todo:subagent-label
    test('section label shows Task description with tooltip', async ({ page }) => {
      await mockSSE(page, 'events/todos-subagent.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      const header = page.locator('[data-testid="todo-section-header"]')
      await expect(header).toBeVisible()

      // Label text with uppercase styling
      const label = header.locator('.todo-section-label')
      await expect(label).toContainText('Build the frontend')
      await expect(label).toHaveCSS('text-transform', 'uppercase')

      // Full description in tooltip
      await expect(header).toHaveAttribute('title', 'Build the frontend')
    })

    // SPEC: panel-todo:subagent-fallback
    test('falls back to truncated tool_use_id when description unavailable', async ({ page }) => {
      await mockSSE(page, 'events/todos-fallback.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      // TodoWrite has parent_tool_use_id "toolu_abc123xyz" but no matching Task event
      const header = page.locator('[data-testid="todo-section-header"]')
      await expect(header).toBeVisible()
      // Should show truncated tool_use_id as fallback label
      await expect(header.locator('.todo-section-label')).toContainText('toolu_')
    })

    // SPEC: panel-todo:subagent-cleanup
    test('subagent section disappears when Task completes', async ({ page }) => {
      await mockSSE(page, 'events/todos-cleanup.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)

      // Fixture includes Task tool_result → subagent section already cleaned up
      // Only main section remains
      await expect(page.getByText('Main task')).toBeVisible()
      await expect(page.getByText('Subagent task')).not.toBeVisible()
      await expect(page.locator('[data-testid="todo-section"]')).toHaveCount(1)
    })
  })

  test.describe('Item Subtitle and Blocked-by', () => {
    test.beforeEach(async ({ page }) => {
      await mockSSE(page, 'events/tool-task-create.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await openTodosPanel(page)
      // Wait for the panel to populate (two TaskCreate events become two rows).
      await expect(
        page.locator('[data-testid="panel-todos"] [data-testid="todo-item"]'),
      ).toHaveCount(2)
    })

    // SPEC: panel-todo:item-subtitle
    // SPEC: panel-todo:row-description-tooltip
    test('description surfaces as native tooltip on the row when set', async ({ page }) => {
      const row = page.locator('[data-testid="panel-todos"] [data-testid="todo-item"]').first()
      // Native title attribute drives the browser tooltip.
      await expect(row).toHaveAttribute('title', 'Skim README and ARCHITECTURE')
      // No visible inline subtitle anywhere in the panel.
      await expect(
        page.locator('[data-testid="panel-todos"] [data-testid="todo-subtitle"]'),
      ).toHaveCount(0)
    })

    // SPEC: panel-todo:blocked-by-badge
    // SPEC: panel-todo:blocked-icon
    test('item with unresolved blockers renders ⊘ icon in place of ○', async ({ page }) => {
      // No standalone count badge anywhere.
      await expect(
        page.locator('[data-testid="panel-todos"] [data-testid="todo-blocked-by-badge"]'),
      ).toHaveCount(0)

      // The blocked row's status icon reads ⊘.
      const icons = await page
        .locator('[data-testid="panel-todos"] [data-testid="todo-item"] .todo-status')
        .allTextContents()
      expect(icons).toContain('⊘')
    })

    // SPEC: panel-todo:row-minimal
    test('row shows state icon + title only — no IDs, no inline subtitle, no badge', async ({
      page,
    }) => {
      const row = page.locator('[data-testid="panel-todos"] [data-testid="todo-item"]').first()
      // Exactly two children: status icon + content.
      const children = await row.evaluate(el => el.children.length)
      expect(children).toBe(2)
      await expect(row.locator('.todo-status')).toBeVisible()
      await expect(row.locator('.todo-content')).toBeVisible()
      await expect(row.locator('[data-testid="todo-subtitle"]')).toHaveCount(0)
      await expect(row.locator('[data-testid="todo-blocked-by-badge"]')).toHaveCount(0)
    })
  })

  test.describe('Badge Count', () => {
    // SPEC: panel-todo:badge
    test('badge shows incomplete todo count across all subagents', async ({ page }) => {
      await mockSSE(page, 'events/todos-subagent.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // todos-subagent.jsonl: main has 1 incomplete + subagent has 2 incomplete = 3
      const badge = page.locator('[data-testid="icon-todos"] .icon-badge')
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText('3')
    })

    // SPEC: panel-todo:badge-update
    // MOCK-LIMITED: All SSE events are delivered at once via fixture, so we cannot
    // observe incremental badge updates as individual TodoWrite events arrive.
    // The test still validates that the badge correctly reflects the final todo state.
    test('badge updates as TodoWrite events arrive', async ({ page }) => {
      await mockSSE(page, 'events/tool-todowrite.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // tool-todowrite.jsonl: 1 completed + 1 in_progress + 2 pending = 3 incomplete
      const badge = page.locator('[data-testid="icon-todos"] .icon-badge')
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText('3')
    })
  })
})
