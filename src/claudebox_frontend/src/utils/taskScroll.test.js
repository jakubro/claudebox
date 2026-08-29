/** Tests for taskScroll - task tool-block lookup and scroll/highlight orchestration. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findVisibleToolBlock, jumpToTask, jumpToTaskInWorkColumn } from './taskScroll'

vi.mock('./scroll', () => ({
  computeScrollDestination: vi.fn(() => 100),
  scrollAndHighlight: vi.fn(),
}))

import { computeScrollDestination, scrollAndHighlight } from './scroll'

describe('findVisibleToolBlock', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns null when no element matches the task id', () => {
    expect(findVisibleToolBlock('missing')).toBeNull()
  })

  it('returns the element when its turn is not collapsed', () => {
    document.body.innerHTML = '<div data-tool-use-id="t1"></div>'
    expect(findVisibleToolBlock('t1')).toBe(document.querySelector('[data-tool-use-id="t1"]'))
  })

  it('returns null when the tool block is inside a collapsed turn', () => {
    document.body.innerHTML =
      '<div class="turn-content-collapsed"><div data-tool-use-id="t1"></div></div>'
    expect(findVisibleToolBlock('t1')).toBeNull()
  })

  it('escapes special characters in the task id', () => {
    document.body.innerHTML = '<div data-tool-use-id="a:b"></div>'
    expect(findVisibleToolBlock('a:b')).not.toBeNull()
  })
})

describe('jumpToTask', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    computeScrollDestination.mockClear().mockReturnValue(100)
    scrollAndHighlight.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flashes highlight-only when there is no scroll container', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)

    jumpToTask(el, null, { markUserIntent: vi.fn(), markProgrammaticScroll: vi.fn() })

    expect(el.classList.contains('task-highlight')).toBe(true)
    expect(scrollAndHighlight).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(el.classList.contains('task-highlight')).toBe(false)
  })

  it('disengages user-intent tracking when the landing spot is off-bottom', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      scrollHeight: { value: 5000 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)
    computeScrollDestination.mockReturnValue(0) // far from the bottom given a 5000-tall scroller

    const markUserIntent = vi.fn()
    const markProgrammaticScroll = vi.fn()
    jumpToTask(el, container, { markUserIntent, markProgrammaticScroll })

    expect(markUserIntent).toHaveBeenCalled()
    expect(markProgrammaticScroll).toHaveBeenCalled()
    expect(scrollAndHighlight).toHaveBeenCalledWith(
      container,
      el,
      expect.objectContaining({ highlightClass: 'task-highlight' }),
    )
  })

  it('re-engages autoscroll when the landing spot is at the bottom and a callback is given', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)
    computeScrollDestination.mockReturnValue(100) // 600 - 100 - 500 = 0 <= threshold

    const markUserIntent = vi.fn()
    const markReturnedToBottom = vi.fn()
    jumpToTask(el, container, { markUserIntent, markReturnedToBottom })

    expect(markUserIntent).not.toHaveBeenCalled()
    expect(markReturnedToBottom).toHaveBeenCalled()
  })

  it('does nothing extra at the bottom when no markReturnedToBottom callback is given (transcript path)', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)
    computeScrollDestination.mockReturnValue(100)

    const markUserIntent = vi.fn()
    jumpToTask(el, container, { markUserIntent })

    expect(markUserIntent).not.toHaveBeenCalled()
    expect(scrollAndHighlight).toHaveBeenCalled()
  })

  it('tolerates missing ref callbacks', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      scrollHeight: { value: 5000 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)

    expect(() => jumpToTask(el, container, {})).not.toThrow()
  })
})

describe('jumpToTaskInWorkColumn', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    computeScrollDestination.mockClear().mockReturnValue(0)
    scrollAndHighlight.mockClear()
  })

  it('lands directly on the block when its row is already mounted', () => {
    const row = document.createElement('div')
    row.className = 'work-row'
    row.setAttribute('data-index', '2')
    const block = document.createElement('div')
    block.setAttribute('data-tool-use-id', 'task_1')
    row.appendChild(block)
    document.body.appendChild(row)

    const container = document.createElement('div')
    const markProgrammaticScroll = vi.fn()
    const virtualizer = { scrollToIndex: vi.fn() }

    jumpToTaskInWorkColumn(2, 'task_1', { container, virtualizer, markProgrammaticScroll })

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
    expect(scrollAndHighlight).toHaveBeenCalledWith(
      container,
      block,
      expect.objectContaining({ highlightClass: 'task-highlight' }),
    )
  })

  it('mounts the row via the virtualizer first when it is windowed out, then lands on the block', () => {
    const container = document.createElement('div')
    const virtualizer = {
      // pollFrames checks synchronously before its first requestAnimationFrame retry, so
      // mounting the row inside scrollToIndex itself is enough for this test to stay synchronous.
      scrollToIndex: vi.fn(index => {
        const row = document.createElement('div')
        row.className = 'work-row'
        row.setAttribute('data-index', String(index))
        const block = document.createElement('div')
        block.setAttribute('data-tool-use-id', 'task_2')
        row.appendChild(block)
        document.body.appendChild(row)
      }),
    }
    const markProgrammaticScroll = vi.fn()

    jumpToTaskInWorkColumn(5, 'task_2', { container, virtualizer, markProgrammaticScroll })

    expect(markProgrammaticScroll).toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(5, { align: 'start' })
    expect(scrollAndHighlight).toHaveBeenCalledWith(
      container,
      document.querySelector('[data-tool-use-id="task_2"]'),
      expect.objectContaining({ highlightClass: 'task-highlight' }),
    )
  })

  it('does nothing when the row never mounts and there is no virtualizer', () => {
    const container = document.createElement('div')

    expect(() =>
      jumpToTaskInWorkColumn(9, 'task_absent', { container, virtualizer: null }),
    ).not.toThrow()
    expect(scrollAndHighlight).not.toHaveBeenCalled()
  })

  it('scopes the row lookup to root, matching findVisibleToolBlock', () => {
    const outerRoot = document.createElement('div')
    const innerRoot = document.createElement('div')
    document.body.append(outerRoot, innerRoot)

    const decoyRow = document.createElement('div')
    decoyRow.className = 'work-row'
    decoyRow.setAttribute('data-index', '0')
    const decoyBlock = document.createElement('div')
    decoyBlock.setAttribute('data-tool-use-id', 'task_scoped')
    decoyRow.appendChild(decoyBlock)
    outerRoot.appendChild(decoyRow)

    const container = document.createElement('div')
    jumpToTaskInWorkColumn(0, 'task_scoped', {
      container,
      virtualizer: { scrollToIndex: vi.fn() },
      root: innerRoot,
    })

    expect(scrollAndHighlight).not.toHaveBeenCalled()
  })
})
