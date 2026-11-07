/** E2E tests for raw HTML rendering and sanitization in chat messages. */

import { expect, test } from '@playwright/test'
import { openSession } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

test.describe('Raw HTML in messages', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:html-content
  test('renders common HTML as formatted elements', async ({ page }) => {
    await openSession(page, 'events/html-content.jsonl')

    await expect(page.locator('summary', { hasText: 'Build log' })).toBeVisible()
    await expect(page.locator('kbd')).toHaveText('Ctrl+S')
  })

  // SPEC: chat:html-details-toggle
  test('details block expands and collapses', async ({ page }) => {
    await openSession(page, 'events/html-content.jsonl')

    const details = page.locator('details').first()
    await expect(details.locator('summary')).toBeVisible()
    expect(await details.evaluate(el => el.open)).toBe(false)

    await details.locator('summary').click()
    expect(await details.evaluate(el => el.open)).toBe(true)
  })

  // SPEC: chat:html-safe
  test('scripts and iframes are stripped and inert', async ({ page }) => {
    await openSession(page, 'events/html-content.jsonl')

    // Content rendered, proving the message was processed.
    await expect(page.locator('kbd')).toBeVisible()

    expect(await page.locator('iframe[src*="evil.example"]').count()).toBe(0)
    expect(await page.evaluate(() => window.__xss_fired === true)).toBe(false)
  })

  // SPEC: chat:html-link-safe
  test('links open safely with rel and target', async ({ page }) => {
    await openSession(page, 'events/html-content.jsonl')

    const link = page.locator('a', { hasText: 'external link' })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  })
})

test.describe('Hostile HTML in messages', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await openSession(page, 'events/html-hostile.jsonl')
  })

  // SPEC: chat:html-style-limited
  test('keeps colour, weight, alignment and width and drops every other style and app class', async ({
    page,
  }) => {
    const flagged = page.locator('span', { hasText: 'flagged' }).first()
    await expect(flagged).toBeVisible()
    const span = await flagged.evaluate(el => {
      const style = getComputedStyle(el)
      return {
        color: style.color,
        position: style.position,
        fontSize: style.fontSize,
        parentFontSize: getComputedStyle(el.parentElement).fontSize,
      }
    })
    expect(span.color).toBe('rgb(255, 0, 0)')
    expect(span.position).not.toBe('fixed')
    expect(span.fontSize).toBe(span.parentFontSize)

    const overlay = page.locator('div', {
      hasText: /^Session expired - paste your key to continue$/,
    })
    expect(await overlay.evaluate(el => el.getAttribute('class'))).toBeNull()
    expect(await overlay.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed')

    const cell = page.locator('td', { hasText: 'cell' })
    const td = await cell.evaluate(el => ({
      align: getComputedStyle(el).textAlign,
      padding: getComputedStyle(el).paddingTop,
      width: el.style.width,
    }))
    expect(td.align).toBe('center')
    expect(td.padding).not.toBe('40px')
    expect(td.width).toBe('50%')
  })

  // SPEC: chat:html-contained
  test('a message stays inside its own area and keeps its spacing', async ({ page }) => {
    const root = page.locator('.turn-text', { hasText: 'Session expired' }).first()
    await expect(root).toBeVisible()
    const style = await root.evaluate(el => ({
      contain: getComputedStyle(el).contain,
      isolation: getComputedStyle(el).isolation,
    }))
    expect(style.contain).toBe('paint')
    expect(style.isolation).toBe('isolate')

    const wide = page.locator('div', { hasText: /^wide$/ })
    const hit = await root.evaluate(
      (el, wideEl) => {
        const box = el.getBoundingClientRect()
        const y = wideEl.getBoundingClientRect().top + 2
        return document.elementFromPoint(box.right + 20, y) === wideEl
      },
      await wide.elementHandle(),
    )
    expect(hit).toBe(false)

    const edges = await root.evaluate(el => {
      const box = el.getBoundingClientRect()
      return {
        rootTop: box.top,
        rootBottom: box.bottom,
        listTop: el.querySelector(':scope > ul').getBoundingClientRect().top,
        tableBottom: el.querySelector(':scope > table').getBoundingClientRect().bottom,
      }
    })
    expect(edges.listTop).toBeCloseTo(edges.rootTop, 0)
    expect(edges.tableBottom).toBeCloseTo(edges.rootBottom, 0)
  })

  // SPEC: chat:html-contained
  test("a command's formatted output covers nothing", async ({ page }) => {
    const block = page.locator('.tool-block').filter({ hasText: 'Bash' }).first()
    const expanded = block.locator('.tool-expanded-content')
    if (!(await expanded.isVisible())) {
      await block.locator('.tool-header').click()
    }
    const layer = expanded.locator('div', { hasText: /^Nothing to see here$/ })
    await expect(layer).toBeVisible()

    expect(await layer.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed')
    const covers = await layer.evaluate(
      el => document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) === el,
    )
    expect(covers).toBe(false)
  })
})

test.describe('Spacing at the edges of a contained message', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await openSession(page, 'events/message-edges.jsonl')
  })

  const edges = async (page, text) => {
    const root = page.locator('.turn-text', { hasText: text }).first()
    await expect(root).toBeVisible()
    return root.evaluate(el => {
      const box = node => node.getBoundingClientRect()
      const blocks = el.querySelectorAll(':scope > [data-md-block]')
      const last = blocks[blocks.length - 1]
      const corner = el.querySelector(':scope > .injected-context-corner')
      return {
        above: box(blocks[0]).top - box(el.previousElementSibling).bottom,
        below: box(el.nextElementSibling).top - box(corner ?? last).bottom,
        aboveReminder: corner ? box(corner).top - box(last).bottom : null,
      }
    })
  }

  test('a rule opening or closing a reply sits 13px from its neighbour', async ({ page }) => {
    expect((await edges(page, 'opened with a rule')).above).toBeCloseTo(13, 1)
    expect((await edges(page, 'closes with a rule')).below).toBeCloseTo(13, 1)
  })

  test('display math closing a reply sits 13px above its neighbour', async ({ page }) => {
    expect((await edges(page, 'measured size grows')).below).toBeCloseTo(13, 1)
  })

  test('a nested list closing a reply sits 10px above its neighbour', async ({ page }) => {
    expect((await edges(page, 'compile and link')).below).toBeCloseTo(10, 1)
  })

  test("a block before a reply's reminders keeps its own margin above the triangle", async ({
    page,
  }) => {
    expect((await edges(page, 'alpha target')).aboveReminder).toBeCloseTo(6.5, 1)
    expect((await edges(page, 'build/out.bin')).aboveReminder).toBeCloseTo(9.75, 1)
  })

  test('a paragraph reply sits 10px from both neighbours', async ({ page }) => {
    const { above, below } = await edges(page, 'plain paragraph between')
    expect(above).toBeCloseTo(10, 1)
    expect(below).toBeCloseTo(10, 1)
  })

  test('two replies meeting at rules sit 13px apart', async ({ page }) => {
    const first = page.locator('.turn-text', { hasText: 'close with a rule' }).first()
    await expect(first).toBeVisible()
    const gap = await first.evaluate(el => {
      const blocks = el.querySelectorAll(':scope > [data-md-block]')
      const next = el.nextElementSibling.querySelector(':scope > [data-md-block]')
      return (
        next.getBoundingClientRect().top - blocks[blocks.length - 1].getBoundingClientRect().bottom
      )
    })
    expect(gap).toBeCloseTo(13, 1)
  })

  const activityEdges = async (page, description) => {
    const task = page.locator('[data-testid="tool-block"]', { hasText: description }).first()
    await task.locator('.tool-header-area').click()
    await expect(task.locator('.task-activity .nested-text-entry').first()).toBeVisible()
    return task.evaluate(block => {
      const box = node => node.getBoundingClientRect()
      const section = block.querySelector('.task-activity')
      const entries = section.querySelectorAll('.nested-text-entry')
      const lastBlocks = entries[entries.length - 1].querySelectorAll(':scope > [data-md-block]')
      const after = section.nextElementSibling ?? block.nextElementSibling
      return {
        above:
          box(entries[0].querySelector(':scope > [data-md-block]')).top -
          box(section.querySelector('.collapsible-header')).bottom,
        below: box(after).top - box(lastBlocks[lastBlocks.length - 1]).bottom,
      }
    })
  }

  test("a subagent's first and last narration keep the Activity's 8px above its result", async ({
    page,
  }) => {
    const { above, below } = await activityEdges(page, 'Survey the targets')
    expect(above).toBeCloseTo(8, 1)
    expect(below).toBeCloseTo(8, 1)
  })

  test("a subagent's last narration keeps 10px to the next call when no result section follows", async ({
    page,
  }) => {
    const { above, below } = await activityEdges(page, 'Check the targets')
    expect(above).toBeCloseTo(8, 1)
    expect(below).toBeCloseTo(10, 1)
  })

  test("a reply after a reply's reminders sits 13px below them when it opens on a rule", async ({
    page,
  }) => {
    const first = page.locator('.turn-text', { hasText: 'deploy notes end with a rule' }).first()
    await expect(first).toBeVisible()
    const gap = await first.evaluate(el => {
      const corner = el.querySelector(':scope > .injected-context-corner')
      const next = el.nextElementSibling.querySelector(':scope > [data-md-block]')
      return next.getBoundingClientRect().top - corner.getBoundingClientRect().bottom
    })
    expect(gap).toBeCloseTo(13, 1)
  })

  const auditGaps = async page => {
    const task = page
      .locator('[data-testid="tool-block"]', { hasText: 'Audit the targets' })
      .first()
    await task.locator('.tool-header-area').click()
    await expect(task.locator('.task-activity .nested-text-entry').nth(1)).toBeVisible()
    return task.evaluate(block => {
      const [first, second] = block.querySelectorAll('.task-activity .nested-text-entry')
      const blocks = el => [...el.querySelectorAll(':scope > [data-md-block]')]
      const reply = block.nextElementSibling.querySelector(':scope > [data-md-block]')
      return {
        between:
          blocks(second)[0].getBoundingClientRect().top -
          blocks(first).at(-1).getBoundingClientRect().bottom,
        toReply:
          reply.getBoundingClientRect().top - blocks(second).at(-1).getBoundingClientRect().bottom,
      }
    })
  }

  test("a subagent's narration after one closing on a rule keeps its nested list's 6.5px", async ({
    page,
  }) => {
    expect((await auditGaps(page)).between).toBeCloseTo(6.5, 1)
  })

  test('a reply opening on a rule sits 13px below a Task whose last narration closes on one', async ({
    page,
  }) => {
    expect((await auditGaps(page)).toReply).toBeCloseTo(13, 1)
  })
})

test.describe('Spacing at the edges of a contained message in the work panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page, { sessionUiStateDefaults: { rightSlotView: 'work' } })
    await page.setViewportSize({ width: 1280, height: 900 })
    await openSession(page, 'events/message-edges-work.jsonl')
  })

  test("a subagent's last narration keeps its rule's 13px when its Task closes a work entry", async ({
    page,
  }) => {
    const column = page.getByTestId('work-column')
    const task = column
      .locator('[data-testid="tool-block"]', { hasText: 'Audit the build' })
      .first()
    await task.locator('.tool-header-area').click()
    await expect(task.locator('.task-activity .nested-text-entry')).toBeVisible()
    const gap = await column.evaluate(col => {
      const entry = col.querySelector('[data-testid="work-turn-entry"]')
      const blocks = entry.querySelectorAll('.nested-text-entry > [data-md-block]')
      return (
        entry.parentElement.getBoundingClientRect().bottom -
        blocks[blocks.length - 1].getBoundingClientRect().bottom
      )
    })
    expect(gap).toBeCloseTo(13, 1)
  })
})
