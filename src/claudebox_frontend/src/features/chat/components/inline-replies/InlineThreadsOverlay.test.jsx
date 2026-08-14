/** Integration tests for InlineThreadsOverlay: the clamped position reaches the rendered float. */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
async function renderWithFreshReply(messagesRef, reply) {
  const props = {
    messagesRef,
    sentThreads: [],
    resolveSignal: 0,
    maxHeight: 200,
    onEditReply: vi.fn(),
    onRemove: vi.fn(),
    onSubmitBatch: vi.fn(),
  }

  const { rerender } = render(<InlineThreadsOverlay {...props} unsent={[]} />)
  rerender(<InlineThreadsOverlay {...props} unsent={[reply]} />)

  await waitFor(() => {
    expect(document.querySelector('.inline-float')).not.toBeNull()
  })
}

describe('InlineThreadsOverlay - edge clamp', () => {
  it('clamps a float anchored near the transcript right edge inside its bounds', async () => {
    const container = setupContainer()
    // Anchor at 390 on a 0-400 transcript - a 300px-wide float would overflow to 690.
    container.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 600 })
    Range.prototype.getClientRects = () => [{ left: 380, right: 390, top: 20, bottom: 36 }]

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(96) // min(390, 400-300-4)
    })
  })

  it('clamps a float anchored near the transcript left edge inside its bounds', async () => {
    const container = setupContainer()
    container.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 600 })
    // Anchor at -10 (span scrolled left of the transcript) - box would sit past the left edge.
    Range.prototype.getClientRects = () => [{ left: -20, right: -10, top: 20, bottom: 36 }]

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(4) // bounds.left + padding
    })
  })

  it('leaves a mid-line float at its unclamped anchor position', async () => {
    const container = setupContainer()
    container.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600 })
    Range.prototype.getClientRects = () => [{ left: 190, right: 200, top: 20, bottom: 36 }]

    await renderWithFreshReply({ current: container }, makeReply())

    await waitFor(() => {
      const left = Number.parseFloat(document.querySelector('.inline-float').style.left)
      expect(left).toBe(200) // well within bounds - passes through unchanged
    })
  })
})
