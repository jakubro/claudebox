/** Tests for panelThrowInjection utils. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldInjectPanelThrow } from './panelThrowInjection'

describe('shouldInjectPanelThrow', () => {
  const originalSearch = window.location.search

  afterEach(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${originalSearch}`)
    vi.unstubAllEnvs()
    window.__claudeboxAllowThrowPanel = undefined
  })

  function setSearch(search) {
    window.history.replaceState(null, '', `${window.location.pathname}${search}`)
  }

  it('returns false with no matching query param', () => {
    setSearch('')

    expect(shouldInjectPanelThrow('todos')).toBe(false)
  })

  it('returns true for the matching panel for as long as the param is present', () => {
    setSearch('?throwPanel=todos')

    expect(shouldInjectPanelThrow('todos')).toBe(true)
    expect(shouldInjectPanelThrow('todos')).toBe(true)
  })

  it('stops matching once the param is removed', () => {
    setSearch('?throwPanel=todos')
    expect(shouldInjectPanelThrow('todos')).toBe(true)

    setSearch('')
    expect(shouldInjectPanelThrow('todos')).toBe(false)
  })

  it('does not match a different panel label', () => {
    setSearch('?throwPanel=todos')

    expect(shouldInjectPanelThrow('stash')).toBe(false)
  })

  it('is inert outside dev builds unless the test-only window flag is set', () => {
    vi.stubEnv('DEV', false)
    setSearch('?throwPanel=todos')

    expect(shouldInjectPanelThrow('todos')).toBe(false)

    window.__claudeboxAllowThrowPanel = true

    expect(shouldInjectPanelThrow('todos')).toBe(true)
  })
})
