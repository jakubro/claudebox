/** Tests for FaviconEffect. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockEvents = { isResponding: false }
let mockInteraction = { isSubmitting: false, isAwaitingResponse: false }
const useFaviconSpy = vi.fn()

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => mockInteraction,
}))

vi.mock('../../chat/hooks/useFavicon', () => ({
  default: args => useFaviconSpy(args),
}))

import FaviconEffect from './FaviconEffect'

describe('FaviconEffect', () => {
  beforeEach(() => {
    mockEvents = { isResponding: false }
    mockInteraction = { isSubmitting: false, isAwaitingResponse: false }
    useFaviconSpy.mockClear()
  })

  function renderEffect() {
    return renderHook(() => {}, {
      wrapper: ({ children }) => (
        <>
          <FaviconEffect />
          {children}
        </>
      ),
    })
  }

  it('invokes useFavicon with isResponding=false when all flags are false', () => {
    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({ isResponding: false })
  })

  it('passes isResponding=true when EventsContext.isResponding is true', () => {
    mockEvents = { isResponding: true }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({ isResponding: true })
  })

  it('passes isResponding=true when InteractionContext.isSubmitting is true', () => {
    mockInteraction = { isSubmitting: true, isAwaitingResponse: false }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({ isResponding: true })
  })

  it('passes isResponding=true when InteractionContext.isAwaitingResponse is true', () => {
    mockInteraction = { isSubmitting: false, isAwaitingResponse: true }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({ isResponding: true })
  })

  it('re-invokes useFavicon when any composite flag flips', () => {
    const { rerender } = renderEffect()

    expect(useFaviconSpy).toHaveBeenLastCalledWith({ isResponding: false })

    mockEvents = { isResponding: true }
    rerender()

    expect(useFaviconSpy).toHaveBeenLastCalledWith({ isResponding: true })
  })
})
