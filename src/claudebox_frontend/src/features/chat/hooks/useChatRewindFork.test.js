/** Tests for useChatRewindFork's executeFork - stop-first, parent override, tabOpened. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forkSession, stopSession } from '../../../api/sessions'
import { openSessionInNewTab } from '../../../utils/navigation'
import useChatRewindFork from './useChatRewindFork'

vi.mock('../../../api/sessions', () => ({
  forkSession: vi.fn(),
  stopSession: vi.fn(),
}))

vi.mock('../../../utils/navigation', () => ({
  openSessionInNewTab: vi.fn(),
}))

function setup(overrides = {}) {
  const props = {
    sessionId: 'main-1',
    workspaceId: 'ws-1',
    isResponding: false,
    navigateToSession: vi.fn(),
    focusChatTab: vi.fn(),
    seedSession: vi.fn(),
    setError: vi.fn(),
    startForking: vi.fn(),
    clearForking: vi.fn(),
    ...overrides,
  }
  const { result } = renderHook(() => useChatRewindFork(props))
  return { result, props }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeFork - source id override', () => {
  it('forks the given sourceId instead of the current session', async () => {
    forkSession.mockResolvedValue({ session_id: 'promoted-1' })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    await act(async () => {
      await result.current.executeFork(null, 'fork-browser-tab', { sourceId: 'side-1' })
    })

    expect(forkSession).toHaveBeenCalledWith('side-1', null, { parent_session_id: undefined })
  })

  it('defaults to the current session when no sourceId is given', async () => {
    forkSession.mockResolvedValue({ session_id: 'fork-1' })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    await act(async () => {
      await result.current.executeFork(null, 'fork-browser-tab')
    })

    expect(forkSession).toHaveBeenCalledWith('main-1', null, { parent_session_id: undefined })
  })
})

describe('executeFork - parent override', () => {
  it('forwards parentSessionId to forkSession', async () => {
    forkSession.mockResolvedValue({ session_id: 'promoted-1' })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    await act(async () => {
      await result.current.executeFork(null, 'fork-browser-tab', {
        sourceId: 'side-1',
        parentSessionId: 'main-1',
      })
    })

    expect(forkSession).toHaveBeenCalledWith('side-1', null, { parent_session_id: 'main-1' })
  })
})

describe('executeFork - stopSourceFirst', () => {
  it('stops the source before forking when requested', async () => {
    const order = []
    stopSession.mockImplementation(async () => order.push('stop'))
    forkSession.mockImplementation(async () => {
      order.push('fork')
      return { session_id: 'promoted-1' }
    })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    await act(async () => {
      await result.current.executeFork(null, 'fork-browser-tab', {
        sourceId: 'side-1',
        stopSourceFirst: true,
      })
    })

    expect(order).toEqual(['stop', 'fork'])
  })

  it('never calls stopSession when stopSourceFirst is not set', async () => {
    forkSession.mockResolvedValue({ session_id: 'fork-1' })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    await act(async () => {
      await result.current.executeFork(null, 'fork-browser-tab')
    })

    expect(stopSession).not.toHaveBeenCalled()
  })

  it('a stop failure reports failureMessage and never forks', async () => {
    stopSession.mockRejectedValue(new Error('gone'))
    const setError = vi.fn()
    const { result } = setup({ setError })

    let outcome
    await act(async () => {
      outcome = await result.current.executeFork(null, 'fork-browser-tab', {
        sourceId: 'side-1',
        stopSourceFirst: true,
        failureMessage: 'Promote failed',
      })
    })

    expect(outcome).toBeNull()
    expect(forkSession).not.toHaveBeenCalled()
    expect(setError).toHaveBeenCalledWith('Promote failed')
  })
})

describe('executeFork - tabOpened', () => {
  it('reflects a successfully opened tab', async () => {
    forkSession.mockResolvedValue({ session_id: 'promoted-1' })
    openSessionInNewTab.mockReturnValue({})
    const { result } = setup()

    let outcome
    await act(async () => {
      outcome = await result.current.executeFork(null, 'fork-browser-tab', { sourceId: 'side-1' })
    })

    expect(outcome).toMatchObject({ session_id: 'promoted-1', tabOpened: true })
  })

  it('is false when the popup was blocked, without failing the promotion', async () => {
    forkSession.mockResolvedValue({ session_id: 'promoted-1' })
    openSessionInNewTab.mockReturnValue(null)
    const { result } = setup()

    let outcome
    await act(async () => {
      outcome = await result.current.executeFork(null, 'fork-browser-tab', { sourceId: 'side-1' })
    })

    expect(outcome).toMatchObject({ session_id: 'promoted-1', tabOpened: false })
  })
})

describe('executeFork - fork-here arm is unaffected by the new options', () => {
  it('still reuses the container and navigates in-tab', async () => {
    forkSession.mockResolvedValue({ session_id: 'fork-1' })
    const navigateToSession = vi.fn()
    const { result } = setup({ navigateToSession })

    await act(async () => {
      await result.current.executeFork('turn-1', 'fork-here')
    })

    expect(forkSession).toHaveBeenCalledWith('main-1', 'turn-1', { reuse_container: true })
    expect(navigateToSession).toHaveBeenCalledWith('ws-1', 'fork-1')
    expect(openSessionInNewTab).not.toHaveBeenCalled()
  })
})
