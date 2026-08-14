/** Tests for BottomPanelsContext - bottom-slot ownership without render churn. */

import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./SessionDataContext', () => ({ useSessionId: () => null }))
vi.mock('../api/uiState', () => ({
  getUiState: () => Promise.resolve({}),
  patchSessionUiState: () => Promise.resolve(),
}))
vi.mock('../features/icon-strip/hooks/useBadgeCounts', () => ({
  default: () => ({
    todoCount: 0,
    stashCount: 0,
    taskCount: 0,
    mcpFailedCount: 0,
    logsHasErrors: false,
  }),
}))

import IconStrip from '../features/icon-strip/IconStrip'
import { BottomPanelsProvider, useBottomPanels } from './BottomPanelsContext'

const wrapper = ({ children }) => <BottomPanelsProvider>{children}</BottomPanelsProvider>

const RENDER_CEILING = 25

describe('BottomPanelsContext', () => {
  it('claims a side for the given ids', () => {
    const { result } = renderHook(() => useBottomPanels(), { wrapper })

    act(() => result.current.setBottomPanelIds('right', ['logs']))

    expect([...result.current.panelSideMap]).toEqual([['logs', 'right']])
    expect(result.current.isBottomPanelId('logs')).toBe(true)
  })

  // This map's identity drives the context value, so an unchanged set must yield the same
  // object - or a repeated effect turns into a loop.
  it('keeps the same map when the ids are unchanged', () => {
    const { result } = renderHook(() => useBottomPanels(), { wrapper })
    act(() => result.current.setBottomPanelIds('right', ['logs']))
    const first = result.current.panelSideMap

    act(() => result.current.setBottomPanelIds('right', ['logs']))

    expect(result.current.panelSideMap).toBe(first)
  })

  it('replaces only the ids belonging to the given side', () => {
    const { result } = renderHook(() => useBottomPanels(), { wrapper })
    act(() => result.current.setBottomPanelIds('left', ['containers']))
    act(() => result.current.setBottomPanelIds('right', ['logs']))

    act(() => result.current.setBottomPanelIds('right', ['other']))

    expect([...result.current.panelSideMap].sort()).toEqual([
      ['containers', 'left'],
      ['other', 'right'],
    ])
  })

  it('releases a side when given no ids', () => {
    const { result } = renderHook(() => useBottomPanels(), { wrapper })
    act(() => result.current.setBottomPanelIds('right', ['logs']))

    act(() => result.current.setBottomPanelIds('right', []))

    expect(result.current.panelSideMap.size).toBe(0)
  })

  // Regression guard: DesktopLayoutBody both consumes the context and renders IconStrip with a
  // literal array prop, so each render passes a new array. Without declarative claiming, the
  // strip's effect would remove/re-add ids every run, each write producing a new map and
  // context value, until React aborts the tree.
  it('does not re-render a consumer that renders the strip with a literal', () => {
    let renders = 0

    function Body() {
      useBottomPanels()
      renders += 1
      if (renders > RENDER_CEILING) {
        throw new Error(`runaway render loop: ${renders} renders`)
      }
      return (
        <IconStrip
          position="right"
          panels={['todos']}
          bottomPanels={['logs']}
          onTogglePanel={() => {}}
        />
      )
    }

    render(
      <BottomPanelsProvider>
        <Body />
      </BottomPanelsProvider>,
    )

    expect(renders).toBeLessThanOrEqual(RENDER_CEILING)
  })
})
