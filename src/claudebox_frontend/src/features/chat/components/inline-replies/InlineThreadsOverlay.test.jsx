/** Integration tests for InlineThreadsOverlay: the clamped position reaches the rendered float. */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUiState, patchSessionUiState } from '../../../../api/uiState'
import InlineThreadsOverlay from './InlineThreadsOverlay'

// useInteraction throws outside InteractionProvider; InlineThread's interrupt handler (mirroring
// the composer's) needs it stubbed for a standalone render.
vi.mock('../../../../context/InteractionContext', () => ({
  useInteraction: () => ({
    interruptStatus: null,
    startInterrupt: vi.fn(),
    completeInterrupt: vi.fn(),
    setError: vi.fn(),
  }),
}))

// PromotedThreadCard's own fetch, reached by the rail-promoted hover card below.
vi.mock('../../../../api/sessions', () => ({
  getSessionEvents: vi.fn().mockResolvedValue({ events: [] }),
}))

// A box asked on its own draws its exchange as a turn, which reads the session's capabilities.
vi.mock('../../../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: null, runtimeName: null }),
}))

// Box sizes live in the session's UI state; resolved per test where one is stored.
vi.mock('../../../../api/uiState', () => ({
  getUiState: vi.fn().mockResolvedValue({ session: {} }),
  patchSessionUiState: vi.fn(),
}))

const QUOTE = 'quoted span text'
const FLOAT_WIDTH = 300
const FLOAT_HEIGHT = 80

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
let extraContainer = null

function setupContainer() {
  extraContainer = document.createElement('div')
  extraContainer.innerHTML = `
    <div data-turn-id="t1">
      <div data-testid="message-assistant">
        <div class="turn-text">${QUOTE}</div>
      </div>
    </div>
  `
  document.body.appendChild(extraContainer)
  return extraContainer
}

function setupAnchored({ right = 800, spanLeft = 190, spanRight = 200 } = {}) {
  const container = setupContainer()
  container.getBoundingClientRect = () => ({ left: 0, right, top: 0, bottom: 600 })
  Range.prototype.getClientRects = () => [{ left: spanLeft, right: spanRight, top: 20, bottom: 36 }]
  return container
}

// Empty prefix/suffix -> resolveAnchor falls back to matching the quote text directly.
function makeReply(overrides = {}) {
  return {
    id: 'r1',
    turnId: 't1',
    from: 'assistant',
    quote: QUOTE,
    prefix: '',
    suffix: '',
    offset: 0,
    response: '',
    ...overrides,
  }
}

beforeEach(() => {
  // jsdom has no layout engine, so .inline-float's getBoundingClientRect stays 0-sized; stub a fixed
  // size so the clamp math is under test, not jsdom's limitation.
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains('inline-float')) {
      return { width: FLOAT_WIDTH, height: FLOAT_HEIGHT, left: 0, top: 0, right: 0, bottom: 0 }
    }

    return originalGetBoundingClientRect.call(this)
  }
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  extraContainer?.remove()
  extraContainer = null
})

// Empty first render sets the seen-ids baseline, so the reply added on rerender is "fresh" and auto-pins.
async function renderWithFreshReply(messagesRef, reply, overrides = {}) {
  const props = {
    messagesRef,
    sentThreads: [],
    resolveSignal: 0,
    maxHeight: 200,
    onEditReply: vi.fn(),
    onRemove: vi.fn(),
    onSubmitBatch: vi.fn(),
    ...overrides,
  }

  const { rerender } = render(<InlineThreadsOverlay {...props} unsent={[]} />)
  rerender(<InlineThreadsOverlay {...props} unsent={[reply]} />)

  await waitFor(() => {
    expect(document.querySelector('.inline-float')).not.toBeNull()
  })
}

describe('InlineThreadsOverlay - edge clamp', () => {
  it('clamps a float anchored near the transcript right edge inside its bounds', async () => {
    // Anchor at 390 on a 0-400 transcript - a 300px-wide float would overflow to 690.
    const container = setupAnchored({ right: 400, spanLeft: 380, spanRight: 390 })

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(96) // min(390, 400-300-4)
    })
  })

  it('clamps a float anchored near the transcript left edge inside its bounds', async () => {
    // Anchor at -10 (span scrolled left of the transcript) - box would sit past the left edge.
    const container = setupAnchored({ right: 400, spanLeft: -20, spanRight: -10 })

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(4) // bounds.left + padding
    })
  })

  it('leaves a mid-line float at its unclamped anchor position', async () => {
    const container = setupAnchored()

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(200) // well within bounds - passes through unchanged
    })
  })
})

describe('InlineThreadsOverlay - rail-promoted click routing', () => {
  it('clicking a rail-promoted quote focuses its thread instead of pinning a float', async () => {
    const container = setupAnchored()

    const onFocusRailPromoted = vi.fn()
    const reply = makeReply({ threadSessionId: 'thread-1', railPromoted: true })

    render(
      <InlineThreadsOverlay
        messagesRef={{ current: container }}
        unsent={[reply]}
        sentThreads={[]}
        resolveSignal={0}
        maxHeight={200}
        onEditReply={vi.fn()}
        onRemove={vi.fn()}
        threadSessions={{ onFocusRailPromoted }}
      />,
    )

    // Retry the click until the async resolve() pass has anchored the span - hitTest is a no-op
    // (and this assertion keeps failing) until then.
    await waitFor(() => {
      fireEvent.pointerDown(container, { clientX: 195, clientY: 28 })
      fireEvent.click(container, { clientX: 195, clientY: 28 })
      expect(onFocusRailPromoted).toHaveBeenCalledWith('thread-1')
    })

    expect(document.querySelector('.inline-float')).toBeNull()
  })

  it('hovering a rail-promoted quote still opens its read-only card', async () => {
    const container = setupAnchored()

    const reply = makeReply({ threadSessionId: 'thread-1', railPromoted: true })

    render(
      <InlineThreadsOverlay
        messagesRef={{ current: container }}
        unsent={[reply]}
        sentThreads={[]}
        resolveSignal={0}
        maxHeight={200}
        onEditReply={vi.fn()}
        onRemove={vi.fn()}
        threadSessions={{ onFocusRailPromoted: vi.fn() }}
      />,
    )

    await waitFor(
      () => {
        fireEvent.mouseMove(container, { clientX: 195, clientY: 28, buttons: 0 })
        expect(document.querySelector('.promoted-thread-card')).not.toBeNull()
      },
      { timeout: 2000 },
    )
  })
})

describe('InlineThreadsOverlay - box size', () => {
  const baseProps = messagesRef => ({
    messagesRef,
    sentThreads: [],
    resolveSignal: 0,
    maxHeight: 200,
    onEditReply: vi.fn(),
    onRemove: vi.fn(),
    sessionId: 's1',
  })

  it('opens a box at the size stored for its reply, clamped to the conversation', async () => {
    vi.mocked(getUiState).mockResolvedValueOnce({
      session: { inlineReplySizes: { r1: { width: 900, height: 150 } } },
    })
    const container = setupAnchored({ right: 600 })

    await renderWithFreshReply({ current: container }, makeReply(), { sessionId: 's1' })

    await waitFor(() => {
      expect(document.querySelector('.inline-float').style.width).toBe('592px')
    })
    expect(document.querySelector('[data-testid="inline-thread-input"]').style.height).toBe('150px')
  })

  it('closes a pinned box once its reply is sent from the message box', async () => {
    const container = setupAnchored()
    const props = baseProps({ current: container })
    const reply = makeReply({ response: 'sent text' })

    const { rerender } = render(<InlineThreadsOverlay {...props} unsent={[]} />)
    rerender(<InlineThreadsOverlay {...props} unsent={[reply]} />)
    await waitFor(() => expect(document.querySelector('.inline-float')).not.toBeNull())

    rerender(<InlineThreadsOverlay {...props} unsent={[]} sentThreads={[reply]} />)

    await waitFor(() => expect(document.querySelector('.inline-float')).toBeNull())
  })

  it('deleting a resized reply forgets its size', async () => {
    vi.mocked(getUiState).mockResolvedValueOnce({
      session: { inlineReplySizes: { r1: { width: 500, height: 120 } } },
    })
    const container = setupAnchored()
    const onRemove = vi.fn()

    await renderWithFreshReply({ current: container }, makeReply(), { sessionId: 's1', onRemove })
    await waitFor(() => {
      expect(document.querySelector('.inline-float').style.width).toBe('500px')
    })

    fireEvent.click(document.querySelector('[data-testid="inline-thread-delete"]'))

    expect(onRemove).toHaveBeenCalledWith('r1')
    expect(patchSessionUiState).toHaveBeenCalledWith('s1', [
      { op: 'unset', path: 'inlineReplySizes.r1' },
    ])
  })
})

describe('InlineThreadsOverlay - closing hands the cursor back', () => {
  it('Tab at the end of a reply closes it and focuses the message box', async () => {
    const focus = vi.fn()
    await renderWithFreshReply({ current: setupAnchored() }, makeReply({ response: 'kept' }), {
      composer: { focus },
    })

    const input = document.querySelector('[data-testid="inline-thread-input"]')
    input.setSelectionRange(4, 4)
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(focus).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelector('.inline-float')).toBeNull())
  })

  it('Tab straight after asking keeps the reply, though its thread has not linked yet', async () => {
    const focus = vi.fn()
    const onRemove = vi.fn()
    const asked = { events: [], pending: [{ content: 'q', at: 0 }], running: true }
    await renderWithFreshReply({ current: setupAnchored() }, makeReply(), {
      composer: { focus },
      onRemove,
      threadSessions: { threads: new Map([['r1', asked]]) },
    })

    fireEvent.keyDown(document.querySelector('[data-testid="inline-thread-input"]'), { key: 'Tab' })

    await waitFor(() => expect(document.querySelector('.inline-float')).toBeNull())
    expect(onRemove).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('the close button focuses the message box', async () => {
    const focus = vi.fn()
    await renderWithFreshReply({ current: setupAnchored() }, makeReply({ response: 'kept' }), {
      composer: { focus },
    })

    fireEvent.click(document.querySelector('[data-testid="inline-thread-close"]'))

    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('a second click on the highlight closes the box without focusing the message box', async () => {
    const focus = vi.fn()
    const container = setupAnchored()
    await renderWithFreshReply({ current: container }, makeReply({ response: 'kept' }), {
      composer: { focus },
    })

    await waitFor(() => {
      fireEvent.pointerDown(container, { clientX: 195, clientY: 28 })
      fireEvent.click(container, { clientX: 195, clientY: 28 })
      expect(document.querySelector('.inline-float')).toBeNull()
    })
    expect(focus).not.toHaveBeenCalled()
  })
})

describe('InlineThreadsOverlay - Tab over a highlight', () => {
  function renderClosedReply(composer = {}) {
    const container = setupAnchored()
    render(
      <InlineThreadsOverlay
        messagesRef={{ current: container }}
        unsent={[makeReply({ response: 'kept' })]}
        sentThreads={[]}
        resolveSignal={0}
        maxHeight={200}
        onEditReply={vi.fn()}
        onRemove={vi.fn()}
        composer={composer}
      />,
    )
    return container
  }

  it('opens and pins the box under the pointer and focuses its field', async () => {
    const container = renderClosedReply()
    fireEvent.mouseMove(container, { clientX: 195, clientY: 28, buttons: 0 })

    await waitFor(() => {
      fireEvent.keyDown(document.body, { key: 'Tab' })
      expect(document.activeElement).toBe(
        document.querySelector('[data-testid="inline-thread-input"]'),
      )
    })
    expect(document.querySelector('[data-testid="inline-thread-close"]')).not.toBeNull()
  })

  it('leaves Tab alone while the quote button shows', async () => {
    const container = renderClosedReply({ quoteShowingRef: { current: true } })
    fireEvent.mouseMove(container, { clientX: 195, clientY: 28, buttons: 0 })
    await new Promise(r => setTimeout(r, 50))

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
