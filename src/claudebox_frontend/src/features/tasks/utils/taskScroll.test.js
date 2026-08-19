/** Tests for taskScroll - task tool-block lookup and scroll/highlight orchestration. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findVisibleToolBlock, jumpToTask } from './taskScroll'

vi.mock('../../../utils/scroll', () => ({
  computeScrollDestination: vi.fn(() => 100),
  scrollAndHighlight: vi.fn(),
}))

import { computeScrollDestination, scrollAndHighlight } from '../../../utils/scroll'

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

  it('flashes highlight-only when there is no chat scroll container', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const refs = {
      markUserIntentRef: { current: vi.fn() },
      markProgrammaticScrollRef: { current: vi.fn() },
    }

    jumpToTask(el, refs)

    expect(el.classList.contains('task-highlight')).toBe(true)
    expect(scrollAndHighlight).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(el.classList.contains('task-highlight')).toBe(false)
  })

  it('disengages user-intent tracking when the landing spot is off-bottom', () => {
    const container = document.createElement('div')
    container.setAttribute('data-testid', 'chat-messages')
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
    jumpToTask(el, {
      markUserIntentRef: { current: markUserIntent },
      markProgrammaticScrollRef: { current: markProgrammaticScroll },
    })

    expect(markUserIntent).toHaveBeenCalled()
    expect(markProgrammaticScroll).toHaveBeenCalled()
    expect(scrollAndHighlight).toHaveBeenCalledWith(
      container,
      el,
      expect.objectContaining({ highlightClass: 'task-highlight' }),
    )
  })

  it('does not disengage user-intent tracking when the landing spot is already at the bottom', () => {
    const container = document.createElement('div')
    container.setAttribute('data-testid', 'chat-messages')
    Object.defineProperties(container, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)
    computeScrollDestination.mockReturnValue(100) // 600 - 100 - 500 = 0 <= threshold

    const markUserIntent = vi.fn()
    jumpToTask(el, {
      markUserIntentRef: { current: markUserIntent },
      markProgrammaticScrollRef: { current: vi.fn() },
    })

    expect(markUserIntent).not.toHaveBeenCalled()
  })

  it('tolerates missing ref callbacks', () => {
    const container = document.createElement('div')
    container.setAttribute('data-testid', 'chat-messages')
    Object.defineProperties(container, {
      scrollHeight: { value: 5000 },
      clientHeight: { value: 500 },
    })
    document.body.appendChild(container)
    const el = document.createElement('div')
    container.appendChild(el)

    expect(() =>
      jumpToTask(el, {
        markUserIntentRef: { current: null },
        markProgrammaticScrollRef: { current: null },
      }),
    ).not.toThrow()
  })
})
