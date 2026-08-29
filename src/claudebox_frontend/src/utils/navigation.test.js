/** Tests for navigation utilities. */

import { describe, expect, it, vi } from 'vitest'
import { buildSessionHref, openSessionInNewTab, openWorkspaceInNewTab } from './navigation'

describe('openSessionInNewTab', () => {
  it('opens session URL in a new tab', () => {
    window.open = vi.fn()

    openSessionInNewTab('ws-1', 'sess-42')

    expect(window.open).toHaveBeenCalledWith(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42`,
      '_blank',
    )
  })

  it('calls window.open exactly once', () => {
    window.open = vi.fn()

    openSessionInNewTab('ws-2', 'sess-99')

    expect(window.open).toHaveBeenCalledTimes(1)
  })

  it('appends /turns/u-<id> when options.turnId + user messageType supplied', () => {
    window.open = vi.fn()

    openSessionInNewTab('ws-1', 'sess-42', { turnId: 'tid-1', messageType: 'user' })

    expect(window.open).toHaveBeenCalledWith(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42/turns/u-tid-1`,
      '_blank',
    )
  })

  it('appends /turns/a-<id> when options.turnId + assistant messageType supplied', () => {
    window.open = vi.fn()

    openSessionInNewTab('ws-1', 'sess-42', { turnId: 'tid-2', messageType: 'assistant' })

    expect(window.open).toHaveBeenCalledWith(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42/turns/a-tid-2`,
      '_blank',
    )
  })

  it('omits turn segment when only one option field is set', () => {
    window.open = vi.fn()

    openSessionInNewTab('ws-1', 'sess-42', { turnId: 'tid-1' })

    expect(window.open).toHaveBeenCalledWith(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42`,
      '_blank',
    )
  })

  it('returns the window handle window.open produced', () => {
    const win = {}
    window.open = vi.fn(() => win)

    expect(openSessionInNewTab('ws-1', 'sess-42')).toBe(win)
  })

  it('returns null when the popup is blocked', () => {
    window.open = vi.fn(() => null)

    expect(openSessionInNewTab('ws-1', 'sess-42')).toBeNull()
  })
})

describe('buildSessionHref', () => {
  it('builds the same hash route openSessionInNewTab passes to window.open', () => {
    expect(buildSessionHref('ws-1', 'sess-42')).toBe(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42`,
    )
  })

  it('appends the turn segment when supplied', () => {
    expect(buildSessionHref('ws-1', 'sess-42', { turnId: 'tid-1', messageType: 'user' })).toBe(
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/sess-42/turns/u-tid-1`,
    )
  })
})

describe('openWorkspaceInNewTab', () => {
  it('opens workspace URL in a new tab', () => {
    window.open = vi.fn()

    openWorkspaceInNewTab('ws-7')

    expect(window.open).toHaveBeenCalledWith(
      `${location.pathname}${location.search}#/workspaces/ws-7`,
      '_blank',
    )
  })

  it('calls window.open exactly once', () => {
    window.open = vi.fn()

    openWorkspaceInNewTab('ws-3')

    expect(window.open).toHaveBeenCalledTimes(1)
  })
})
