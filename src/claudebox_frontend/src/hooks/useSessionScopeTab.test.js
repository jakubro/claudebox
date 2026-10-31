/** Tests for useSessionScopeTab. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useSessionScopeTab from './useSessionScopeTab'

describe('useSessionScopeTab', () => {
  it('starts on "session" with a session open and "all" without one', () => {
    expect(renderHook(() => useSessionScopeTab('s1')).result.current[0]).toBe('session')
    expect(renderHook(() => useSessionScopeTab(null)).result.current[0]).toBe('all')
  })

  it('holds a tab picked by hand until the session changes', () => {
    const { result, rerender } = renderHook(({ id }) => useSessionScopeTab(id), {
      initialProps: { id: 's1' },
    })

    act(() => result.current[1]('all'))
    rerender({ id: 's1' })
    expect(result.current[0]).toBe('all')

    rerender({ id: 's2' })
    expect(result.current[0]).toBe('session')

    rerender({ id: null })
    expect(result.current[0]).toBe('all')
  })
})
