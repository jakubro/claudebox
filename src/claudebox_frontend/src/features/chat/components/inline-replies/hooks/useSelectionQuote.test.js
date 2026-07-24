/** Tests for the useSelectionQuote hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useSelectionQuote from './useSelectionQuote'

function buildTranscript() {
  const container = document.createElement('div')
  container.className = 'chat-messages'
  container.innerHTML =
    '<div data-turn-id="t1">' +
    '<div data-testid="message-assistant">' +
    '<div class="turn-text"><p id="target">the runtime embeds context window today</p></div>' +
    '</div>' +
    '</div>'
  document.body.appendChild(container)
  return container
}

// Real jsdom Range over `quote` inside `textNode`, so captureAnchor resolves against real text nodes.
function rangeOver(textNode, quote) {
  const start = textNode.textContent.indexOf(quote)
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, start + quote.length)
  // jsdom Range lacks getBoundingClientRect (real browsers provide it);
  // shim it so the affordance can compute its position.
  range.getBoundingClientRect = () => ({ right: 100, bottom: 50 })
  return range
}

function mockSelection({ text, node, collapsed = false, range = null }) {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: collapsed,
    rangeCount: collapsed ? 0 : 1,
    anchorNode: node,
    toString: () => text,
    getRangeAt: () => range,
  })
}

function fireSelectionChange() {
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
}

describe('useSelectionQuote', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('maps a selection to text + turnId + from + a durable text-quote anchor', () => {
    const container = buildTranscript()
    const target = container.querySelector('#target').firstChild
    mockSelection({
      text: 'context window',
      node: target,
      range: rangeOver(target, 'context window'),
    })

    const { result } = renderHook(() => useSelectionQuote({ current: container }, true))
    fireSelectionChange()

    expect(result.current.affordance).toMatchObject({
      text: 'context window',
      turnId: 't1',
      from: 'assistant',
      prefix: 'the runtime embeds ',
      suffix: ' today',
      offset: 19,
    })
  })

  it('surfaces the affordance for tool output text (tool blocks are now quotable)', () => {
    const container = document.createElement('div')
    container.className = 'chat-messages'
    container.innerHTML =
      '<div data-turn-id="t1">' +
      '<div data-testid="message-assistant">' +
      '<div class="tool-block"><div class="tool-details"><span id="tool">ran a shell command</span></div></div>' +
      '</div>' +
      '</div>'
    document.body.appendChild(container)
    const target = container.querySelector('#tool').firstChild
    mockSelection({
      text: 'shell command',
      node: target,
      range: rangeOver(target, 'shell command'),
    })

    const { result } = renderHook(() => useSelectionQuote({ current: container }, true))
    fireSelectionChange()

    expect(result.current.affordance).toMatchObject({
      text: 'shell command',
      turnId: 't1',
      from: 'assistant',
    })
  })

  it('ignores a collapsed selection', () => {
    const container = buildTranscript()
    mockSelection({ text: '', node: container, collapsed: true })

    const { result } = renderHook(() => useSelectionQuote({ current: container }, true))
    fireSelectionChange()

    expect(result.current.affordance).toBeNull()
  })

  it('ignores a selection outside the transcript', () => {
    const container = buildTranscript()
    const outside = document.createElement('p')
    outside.textContent = 'sidebar text'
    document.body.appendChild(outside)
    mockSelection({ text: 'sidebar', node: outside.firstChild })

    const { result } = renderHook(() => useSelectionQuote({ current: container }, true))
    fireSelectionChange()

    expect(result.current.affordance).toBeNull()
  })

  it('does not track when disabled', () => {
    const container = buildTranscript()
    const target = container.querySelector('#target').firstChild
    mockSelection({
      text: 'context window',
      node: target,
      range: rangeOver(target, 'context window'),
    })

    const { result } = renderHook(() => useSelectionQuote({ current: container }, false))
    fireSelectionChange()

    expect(result.current.affordance).toBeNull()
  })
})
