/** Tests for FaviconEffect. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const IDLE_EVENTS = { isResponding: false }
let mockEvents = { ...IDLE_EVENTS }
let mockInteraction = { isSubmitting: false, isAwaitingResponse: false }
let mockSessionData = { sessionData: null }
let mockRouting = { activeSessionId: 'sess-1' }
let mockWaiting = { isWaiting: false, awaitingPickup: false }
const useFaviconSpy = vi.fn()

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => mockEvents,
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => mockInteraction,
}))

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
}))

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))

vi.mock('../../../hooks/useBackgroundWaiting', () => ({
  default: () => mockWaiting,
}))

vi.mock('../../chat/hooks/useFavicon', () => ({
  default: args => useFaviconSpy(args),
}))

import FaviconEffect from './FaviconEffect'

describe('FaviconEffect', () => {
  beforeEach(() => {
    mockEvents = { ...IDLE_EVENTS, isResponding: false }
    mockInteraction = { isSubmitting: false, isAwaitingResponse: false }
    mockSessionData = { sessionData: null }
    mockRouting = { activeSessionId: 'sess-1' }
    mockWaiting = { isWaiting: false, awaitingPickup: false }
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

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: false,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes isResponding=true when EventsContext.isResponding is true', () => {
    mockEvents = { ...IDLE_EVENTS, isResponding: true }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: true,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes isResponding=true when InteractionContext.isSubmitting is true', () => {
    mockInteraction = { isSubmitting: true, isAwaitingResponse: false }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: true,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes isResponding=true when InteractionContext.isAwaitingResponse is true', () => {
    mockInteraction = { isSubmitting: false, isAwaitingResponse: true }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: true,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('re-invokes useFavicon when any composite flag flips', () => {
    const { rerender } = renderEffect()

    expect(useFaviconSpy).toHaveBeenLastCalledWith({
      isResponding: false,
      isWaiting: false,
      needsUser: false,
    })

    mockEvents = { ...IDLE_EVENTS, isResponding: true }
    rerender()

    expect(useFaviconSpy).toHaveBeenLastCalledWith({
      isResponding: true,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes needsUser=true when the open session needs the user', () => {
    mockSessionData = { sessionData: { session_id: 'sess-1', needs_user: 'Decide: A' } }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: false,
      isWaiting: false,
      needsUser: true,
    })
  })

  it('passes needsUser=false while the data still belongs to the session switched away from', () => {
    mockSessionData = { sessionData: { session_id: 'sess-old', needs_user: 'Decide: A' } }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: false,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes needsUser=false when no session data is loaded', () => {
    mockRouting = { activeSessionId: null }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: false,
      isWaiting: false,
      needsUser: false,
    })
  })

  it('passes isWaiting while the session waits on background work', () => {
    mockWaiting = { isWaiting: true, awaitingPickup: false }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: false,
      isWaiting: true,
      needsUser: false,
    })
  })

  it('shows working between a task finishing and the agent picking up', () => {
    mockWaiting = { isWaiting: false, awaitingPickup: true }

    renderEffect()

    expect(useFaviconSpy).toHaveBeenCalledWith({
      isResponding: true,
      isWaiting: false,
      needsUser: false,
    })
  })
})
