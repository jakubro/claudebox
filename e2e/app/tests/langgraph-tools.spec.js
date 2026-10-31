/** E2E test for LangGraph workspace simple-port tools. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph Tools', () => {
  // SPEC: langgraph:file-tools
  test('renders a tool block for a LangGraph read_file tool_use', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-read-file.jsonl')

    // LangGraph tool_use blocks render via the same conversion -> projection path as Claude's.
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })

  // SPEC: tool:bash-read-only-collapsed
  test('a LangGraph bash call that changes nothing starts collapsed', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-bash.jsonl')

    const block = id => page.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)
    await expect(block('tool_read_only')).toHaveAttribute('data-expanded', 'false')
    await expect(block('tool_lay_seq')).toHaveAttribute('data-expanded', 'true')
  })

  // SPEC: tool:bash-command-layout
  test('a LangGraph bash call shows one command per line', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-bash.jsonl')

    const rows = page
      .locator('[data-testid="tool-block"][data-tool-use-id="tool_lay_seq"]')
      .locator('.tool-command-section .code-block-row')
    await expect
      .poll(() => rows.evaluateAll(els => els.map(el => el.textContent.replace(/\n$/, ''))))
      .toEqual(['cd /srv/app', 'cat VERSION', 'echo ---', 'git log --oneline -5 | cat'])
  })
})
