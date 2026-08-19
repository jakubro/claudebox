/** Tests for findTopmostVisibleTurn - scroll-position-driven active-turn detection. */

import { describe, expect, it } from 'vitest'
import { findTopmostVisibleTurn } from './findTopmostVisibleTurn'

/** A scroll container with turn children, each reporting a controllable bounding rect. */
function buildContainer(containerTop, turns) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ top: containerTop }),
  })

  for (const turn of turns) {
    const el = document.createElement('div')
    el.setAttribute('data-turn-id', turn.id)
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ bottom: turn.bottom }) })

    if (turn.hasUser) {
      const userEl = document.createElement('div')
      userEl.setAttribute('data-testid', 'message-user')
      Object.defineProperty(userEl, 'getBoundingClientRect', {
        value: () => ({ bottom: turn.userBottom ?? turn.bottom }),
      })
      el.appendChild(userEl)
    }

    if (turn.hasAssistant) {
      const assistantEl = document.createElement('div')
      assistantEl.setAttribute('data-testid', 'message-assistant')
      el.appendChild(assistantEl)
    }

    container.appendChild(el)
  }

  return container
}

describe('findTopmostVisibleTurn', () => {
  it('returns null when the container has no turns', () => {
    const container = buildContainer(0, [])
    expect(findTopmostVisibleTurn(container)).toBeNull()
  })

  it('returns null when every turn has already scrolled past the top', () => {
    const container = buildContainer(100, [{ id: 't1', bottom: 50 }])
    expect(findTopmostVisibleTurn(container)).toBeNull()
  })

  it('picks the first turn whose bottom edge is still below the container top', () => {
    const container = buildContainer(100, [
      { id: 't1', bottom: 50 },
      { id: 't2', bottom: 150 },
      { id: 't3', bottom: 250 },
    ])
    expect(findTopmostVisibleTurn(container)).toEqual({ turnId: 't2', role: 'assistant' })
  })

  it('prefers user role when the user child is still visible', () => {
    const container = buildContainer(100, [
      { id: 't1', bottom: 150, hasUser: true, hasAssistant: true, userBottom: 120 },
    ])
    expect(findTopmostVisibleTurn(container)).toEqual({ turnId: 't1', role: 'user' })
  })

  it('falls back to assistant when the user child has scrolled past the top', () => {
    const container = buildContainer(100, [
      { id: 't1', bottom: 150, hasUser: true, hasAssistant: true, userBottom: 50 },
    ])
    expect(findTopmostVisibleTurn(container)).toEqual({ turnId: 't1', role: 'assistant' })
  })

  it('uses user role when there is no assistant child, even if the user child is above the top', () => {
    const container = buildContainer(100, [
      { id: 't1', bottom: 150, hasUser: true, hasAssistant: false, userBottom: 50 },
    ])
    expect(findTopmostVisibleTurn(container)).toEqual({ turnId: 't1', role: 'user' })
  })

  it('returns null when the topmost element has no data-turn-id value', () => {
    const container = buildContainer(100, [{ id: '', bottom: 150 }])
    expect(findTopmostVisibleTurn(container)).toBeNull()
  })
})
