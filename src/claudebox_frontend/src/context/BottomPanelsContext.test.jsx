/** Tests for BottomPanelsContext - bottom-slot ownership without render churn. */

import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockSessionId = null
const mockGetUiState = vi.fn(() => Promise.resolve({}))
const mockPatchSessionUiState = vi.fn(() => Promise.resolve())

vi.mock('./SessionDataContext', () => ({ useSessionId: () => mockSessionId }))
vi.mock('../api/uiState', () => ({
  getUiState: (...args) => mockGetUiState(...args),
  patchSessionUiState: (...args) => mockPatchSessionUiState(...args),
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

function Body({ counter }) {
  useBottomPanels()
  counter.renders += 1
  if (counter.renders > RENDER_CEILING) {
    throw new Error(`runaway render loop: ${counter.renders} renders`)
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
    const counter = { renders: 0 }

    render(
      <BottomPanelsProvider>
        <Body counter={counter} />
      </BottomPanelsProvider>,
    )

    expect(counter.renders).toBeLessThanOrEqual(RENDER_CEILING)
  })
})

describe('BottomPanelsContext follows the layout across sessions', () => {
  const STORED = {
    latest: { session: { bottomPanels: { openSet: ['containers'], height: 300 } } },
    A: { session: { bottomPanels: { openSet: ['logs'], height: 250 } } },
    B: { session: { bottomPanels: { openSet: [], height: 200 } } },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockSessionId = null
    mockGetUiState.mockReset()
    mockGetUiState.mockImplementation(id => Promise.resolve(STORED[id ?? 'latest']))
    mockPatchSessionUiState.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mounted() {
    const hook = renderHook(() => useBottomPanels(), { wrapper })
    await act(async () => {})

    return hook
  }

  async function attach(hook, id) {
    mockSessionId = id
    hook.rerender()
    await act(async () => {})
  }

  it("restores the latest record at mount and the first attached session's own", async () => {
    const hook = await mounted()
    expect([...hook.result.current.openSet]).toEqual(['containers'])

    await attach(hook, 'A')

    expect([...hook.result.current.openSet]).toEqual(['logs'])
  })

  it('keeps the strip as it is when another session is opened', async () => {
    const hook = await mounted()
    await attach(hook, 'A')
    mockGetUiState.mockClear()

    await attach(hook, null)
    await attach(hook, 'B')

    expect([...hook.result.current.openSet]).toEqual(['logs'])
    expect(mockGetUiState).not.toHaveBeenCalled()
  })

  it('saves a change made just before a switch into the session it was made in', async () => {
    const hook = await mounted()
    await attach(hook, 'A')
    act(() => hook.result.current.togglePanel('containers'))
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    await attach(hook, null)
    await attach(hook, 'B')
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockPatchSessionUiState.mock.calls).toEqual([
      [
        'A',
        [
          {
            op: 'set',
            path: 'bottomPanels',
            value: { openSet: ['logs', 'containers'], height: 250 },
          },
        ],
      ],
    ])
  })

  it('saves a change made after a switch to the new session only', async () => {
    const hook = await mounted()
    await attach(hook, 'A')
    await attach(hook, null)
    await attach(hook, 'B')

    act(() => hook.result.current.togglePanel('logs'))
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockPatchSessionUiState.mock.calls.map(call => call[0])).toEqual(['B'])
  })
})
