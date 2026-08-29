/** Tests for AncestorQuoteHighlights - read-only quote highlight and rail-promoted card. */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AncestorQuoteHighlights from './AncestorQuoteHighlights'

const QUOTE = 'quoted span text'

vi.mock('../../../../api/sessions', () => ({
  getSessionEvents: vi.fn().mockResolvedValue({ events: [] }),
}))

vi.mock('./ancestorHighlightRegistry', () => ({
  setAncestorHighlightRanges: vi.fn(),
  clearAncestorHighlightRanges: vi.fn(),
}))

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
let container = null

function setupContainer() {
  container = document.createElement('div')
  container.innerHTML = `
    <div data-turn-id="t1">
      <div data-testid="message-assistant">
        <div class="turn-text">${QUOTE}</div>
      </div>
    </div>
  `
  document.body.appendChild(container)
  container.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600 })
  return container
}

function makeReply(overrides = {}) {
  return {
    id: 'r1',
    turnId: 't1',
    from: 'assistant',
    quote: QUOTE,
    prefix: '',
    suffix: '',
    offset: 0,
    railPromoted: false,
    threadSessionId: null,
    ...overrides,
  }
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains('inline-float')) {
      return { width: 300, height: 80, left: 0, top: 0, right: 0, bottom: 0 }
    }
    return originalGetBoundingClientRect.call(this)
  }
  Range.prototype.getClientRects = () => [{ left: 190, right: 200, top: 20, bottom: 36 }]
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  container?.remove()
  container = null
  vi.clearAllMocks()
})

describe('AncestorQuoteHighlights - registry contribution', () => {
  it('registers this ancestor session id as the resolved ranges - the sole shared-registry contract under test here', async () => {
    const c = setupContainer()
    const { setAncestorHighlightRanges } = await import('./ancestorHighlightRegistry')

    render(
      <AncestorQuoteHighlights
        sessionId="anc-1"
        messagesRef={{ current: c }}
        sentThreads={[makeReply()]}
        onFocusThread={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(setAncestorHighlightRanges).toHaveBeenCalledWith('anc-1', expect.any(Array))
      expect(setAncestorHighlightRanges.mock.calls.at(-1)[1]).toHaveLength(1)
    })
  })

  it('clears this ancestor session id on unmount', async () => {
    const c = setupContainer()
    const { clearAncestorHighlightRanges } = await import('./ancestorHighlightRegistry')

    const { unmount } = render(
      <AncestorQuoteHighlights
        sessionId="anc-1"
        messagesRef={{ current: c }}
        sentThreads={[makeReply()]}
        onFocusThread={vi.fn()}
      />,
    )

    unmount()

    expect(clearAncestorHighlightRanges).toHaveBeenCalledWith('anc-1')
  })
})

describe('AncestorQuoteHighlights - click routing', () => {
  it('clicking a rail-promoted quote calls onFocusThread with its thread session id', async () => {
    const c = setupContainer()
    const onFocusThread = vi.fn()

    render(
      <AncestorQuoteHighlights
        sessionId="anc-1"
        messagesRef={{ current: c }}
        sentThreads={[makeReply({ railPromoted: true, threadSessionId: 'thread-1' })]}
        onFocusThread={onFocusThread}
      />,
    )

    await waitFor(() => {
      fireEvent.pointerDown(c, { clientX: 195, clientY: 28 })
      fireEvent.click(c, { clientX: 195, clientY: 28 })
      expect(onFocusThread).toHaveBeenCalledWith('thread-1')
    })
  })

  it('an ordinary (non-rail-promoted) quote is inert - no click effect, no hover card', async () => {
    const c = setupContainer()
    const onFocusThread = vi.fn()

    render(
      <AncestorQuoteHighlights
        sessionId="anc-1"
        messagesRef={{ current: c }}
        sentThreads={[makeReply({ railPromoted: false })]}
        onFocusThread={onFocusThread}
      />,
    )

    // Give the resolve pass a chance to run, then confirm neither interaction path fires.
    await new Promise(r => setTimeout(r, 50))
    fireEvent.mouseMove(c, { clientX: 195, clientY: 28, buttons: 0 })
    fireEvent.pointerDown(c, { clientX: 195, clientY: 28 })
    fireEvent.click(c, { clientX: 195, clientY: 28 })

    expect(onFocusThread).not.toHaveBeenCalled()
    expect(document.querySelector('.promoted-thread-card')).toBeNull()
  })
})
