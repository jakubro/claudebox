/** Tests for ContainerMapContext. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContainerMapProvider, useContainerMap } from './ContainerMapContext'

describe('useContainerMap', () => {
  const wrapper = ({ children }) => <ContainerMapProvider>{children}</ContainerMapProvider>

  it('starts with empty map', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    expect(result.current.containerMap).toEqual({})
  })

  it('setSessionContainer populates the map', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })

    act(() => {
      result.current.setSessionContainer('sess-1', 'ctr-1')
    })

    expect(result.current.containerMap).toEqual({ 'sess-1': 'ctr-1' })
  })

  it('removeSessionContainer clears the entry', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })

    act(() => {
      result.current.setSessionContainer('sess-1', 'ctr-1')
    })
    act(() => {
      result.current.removeSessionContainer('sess-1')
    })

    expect(result.current.containerMap).toEqual({})
  })

  it('tracks multiple sessions independently', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })

    act(() => {
      result.current.setSessionContainer('sess-1', 'ctr-1')
      result.current.setSessionContainer('sess-2', 'ctr-2')
    })

    expect(result.current.containerMap).toEqual({ 'sess-1': 'ctr-1', 'sess-2': 'ctr-2' })

    act(() => {
      result.current.removeSessionContainer('sess-1')
    })

    expect(result.current.containerMap).toEqual({ 'sess-2': 'ctr-2' })
  })

  it('returns stable callback references across renders', () => {
    const { result, rerender } = renderHook(() => useContainerMap(), { wrapper })

    const set1 = result.current.setSessionContainer
    const remove1 = result.current.removeSessionContainer

    rerender()

    expect(result.current.setSessionContainer).toBe(set1)
    expect(result.current.removeSessionContainer).toBe(remove1)
  })
})

describe('deriveSessionStatus', () => {
  const wrapper = ({ children }) => <ContainerMapProvider>{children}</ContainerMapProvider>

  it('returns "none" when no container is known anywhere', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    expect(result.current.deriveSessionStatus('s1')).toBe('none')
  })

  it('returns "running" from the eager container map', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    act(() => result.current.setSessionContainer('s1', 'ctr-1'))
    expect(result.current.deriveSessionStatus('s1')).toBe('running')
  })

  it('returns "running" from the canonical sessions list', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    const sessions = [{ session_id: 's1', container_id: 'ctr-1' }]
    expect(result.current.deriveSessionStatus('s1', sessions)).toBe('running')
  })

  it('returns "running" from the fallback container id', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    expect(result.current.deriveSessionStatus('s1', [], 'ctr-1')).toBe('running')
  })

  it('returns "stopping" with precedence over a present container', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    act(() => {
      result.current.setSessionContainer('s1', 'ctr-1')
      result.current.addStoppingSession('s1')
    })
    expect(result.current.deriveSessionStatus('s1')).toBe('stopping')
  })

  it('clears out of "stopping" once the stopping flag and mapping are removed', () => {
    const { result } = renderHook(() => useContainerMap(), { wrapper })
    act(() => {
      result.current.setSessionContainer('s1', 'ctr-1')
      result.current.addStoppingSession('s1')
    })
    expect(result.current.deriveSessionStatus('s1')).toBe('stopping')

    // Mirror the terminal "stopped" handler: drop the stopping flag + mapping.
    act(() => {
      result.current.removeStoppingSession('s1')
      result.current.removeSessionContainer('s1')
    })
    expect(result.current.deriveSessionStatus('s1')).toBe('none')
  })
})
