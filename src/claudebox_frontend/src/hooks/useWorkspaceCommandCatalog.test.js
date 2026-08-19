/** Tests for useWorkspaceCommandCatalog - workspace-gated command catalog fetch. */

import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '../context/WorkspaceContext'
import useWorkspaceCommandCatalog from './useWorkspaceCommandCatalog'

vi.mock('../api/workspaces', () => ({
  getCommandCatalog: vi.fn(),
}))

import { getCommandCatalog } from '../api/workspaces'

// No JSX here - this file mirrors its .js hook sibling, and JSX only transforms in .jsx files.
function withWorkspace(workspaceId) {
  return ({ children }) =>
    createElement(WorkspaceContext.Provider, { value: { workspaceId } }, children)
}

describe('useWorkspaceCommandCatalog', () => {
  beforeEach(() => {
    getCommandCatalog.mockReset()
  })

  it('stays null and skips the fetch without a WorkspaceProvider', () => {
    const { result } = renderHook(() => useWorkspaceCommandCatalog())

    expect(result.current).toBeNull()
    expect(getCommandCatalog).not.toHaveBeenCalled()
  })

  it('stays null and skips the fetch when there is no active workspace', () => {
    const { result } = renderHook(() => useWorkspaceCommandCatalog(), {
      wrapper: withWorkspace(null),
    })

    expect(result.current).toBeNull()
    expect(getCommandCatalog).not.toHaveBeenCalled()
  })

  it('fetches and resolves the catalog for an active workspace', async () => {
    const catalog = { custom: [], mcp: [], builtin: [{ name: 'help' }] }
    getCommandCatalog.mockResolvedValue(catalog)

    const { result } = renderHook(() => useWorkspaceCommandCatalog(), {
      wrapper: withWorkspace('ws-1'),
    })

    await waitFor(() => {
      expect(result.current).toEqual(catalog)
    })
  })

  it('logs a warning and leaves the catalog null when the fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getCommandCatalog.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useWorkspaceCommandCatalog(), {
      wrapper: withWorkspace('ws-1'),
    })

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'useWorkspaceCommandCatalog: getCommandCatalog failed',
        expect.any(Error),
      )
    })
    expect(result.current).toBeNull()
  })
})
