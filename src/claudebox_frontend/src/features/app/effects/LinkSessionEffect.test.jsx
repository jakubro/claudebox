/** Tests for LinkSessionEffect - creates a session from a link's carried send messages. */

import { renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockActiveWorkspaceId = null
let mockSendMessages = []
const mockConsumeSendMessages = vi.fn()

let mockWorkspaces = []
let mockWorkspaceId = null
let mockLoading = false
const mockSelectWorkspace = vi.fn()

const mockExecuteNewSessionFromLink = vi.fn()
const mockSetPendingInsert = vi.fn()
const mockSetError = vi.fn()

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeWorkspaceId: mockActiveWorkspaceId,
    sendMessages: mockSendMessages,
    consumeSendMessages: mockConsumeSendMessages,
  }),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspaces: mockWorkspaces,
    workspaceId: mockWorkspaceId,
    loading: mockLoading,
    selectWorkspace: mockSelectWorkspace,
  }),
}))

vi.mock('../../../context/StashContext', () => ({
  useStash: () => ({ setPendingInsert: mockSetPendingInsert }),
}))

vi.mock('../../../context/InteractionContext', () => ({
  useInteraction: () => ({ setError: mockSetError }),
}))

vi.mock('../../../hooks/useNewSession', () => ({
  default: () => ({ executeNewSessionFromLink: mockExecuteNewSessionFromLink }),
}))

import LinkSessionEffect from './LinkSessionEffect'

function render() {
  return renderHook(() => {}, {
    wrapper: ({ children }) => (
      <>
        <LinkSessionEffect />
        {children}
      </>
    ),
  })
}

function renderStrict() {
  return renderHook(() => {}, {
    wrapper: ({ children }) => (
      <StrictMode>
        <LinkSessionEffect />
        {children}
      </StrictMode>
    ),
  })
}

describe('LinkSessionEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveWorkspaceId = null
    mockSendMessages = []
    mockWorkspaces = []
    mockWorkspaceId = null
    mockLoading = false
    mockExecuteNewSessionFromLink.mockResolvedValue({ undeliveredMessages: [] })
  })

  it('does nothing when the hash carries no send messages', () => {
    render()

    expect(mockConsumeSendMessages).not.toHaveBeenCalled()
    expect(mockExecuteNewSessionFromLink).not.toHaveBeenCalled()
  })

  it('waits for workspace discovery to finish before acting', () => {
    mockSendMessages = ['/greet ada']
    mockLoading = true

    render()

    expect(mockConsumeSendMessages).not.toHaveBeenCalled()
    expect(mockExecuteNewSessionFromLink).not.toHaveBeenCalled()
  })

  it('consumes silently when the named workspace is not registered', () => {
    mockSendMessages = ['/greet ada']
    mockActiveWorkspaceId = 'unknown-ws'
    mockWorkspaces = [{ id: 'ws' }]
    mockWorkspaceId = 'ws'

    render()

    expect(mockConsumeSendMessages).toHaveBeenCalledTimes(1)
    expect(mockExecuteNewSessionFromLink).not.toHaveBeenCalled()
    expect(mockSetError).not.toHaveBeenCalled()
  })

  it('switches workspace first when the link names a different registered one, without creating yet', () => {
    mockSendMessages = ['/greet ada']
    mockActiveWorkspaceId = 'other-ws'
    mockWorkspaces = [{ id: 'ws' }, { id: 'other-ws' }]
    mockWorkspaceId = 'ws'

    render()

    expect(mockSelectWorkspace).toHaveBeenCalledWith('other-ws')
    expect(mockConsumeSendMessages).not.toHaveBeenCalled()
    expect(mockExecuteNewSessionFromLink).not.toHaveBeenCalled()
  })

  it('consumes the hash and creates a session with ordered messages once the workspace is active', async () => {
    mockSendMessages = ['/greet ada', 'go']
    mockActiveWorkspaceId = 'ws'
    mockWorkspaces = [{ id: 'ws' }]
    mockWorkspaceId = 'ws'

    render()

    expect(mockConsumeSendMessages).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(mockExecuteNewSessionFromLink).toHaveBeenCalledWith(['/greet ada', 'go'])
    })
  })

  it('populates the composer and shows a notice when messages were blocked', async () => {
    mockSendMessages = ['/greet ada']
    mockActiveWorkspaceId = 'ws'
    mockWorkspaces = [{ id: 'ws' }]
    mockWorkspaceId = 'ws'
    mockExecuteNewSessionFromLink.mockResolvedValue({
      undeliveredMessages: ['/greet ada'],
    })

    render()

    await waitFor(() => {
      expect(mockSetPendingInsert).toHaveBeenCalledWith('/greet ada')
    })
    expect(mockSetError).toHaveBeenCalledWith('Message not allowed by workspace settings')
  })

  it('does not touch the composer when nothing was blocked', async () => {
    mockSendMessages = ['/greet ada']
    mockActiveWorkspaceId = 'ws'
    mockWorkspaces = [{ id: 'ws' }]
    mockWorkspaceId = 'ws'

    render()

    await waitFor(() => {
      expect(mockExecuteNewSessionFromLink).toHaveBeenCalled()
    })
    expect(mockSetPendingInsert).not.toHaveBeenCalled()
    expect(mockSetError).not.toHaveBeenCalled()
  })

  it('does not fire twice under React StrictMode double-invoked effects', async () => {
    mockSendMessages = ['/greet ada']
    mockActiveWorkspaceId = 'ws'
    mockWorkspaces = [{ id: 'ws' }]
    mockWorkspaceId = 'ws'

    renderStrict()

    await waitFor(() => {
      expect(mockExecuteNewSessionFromLink).toHaveBeenCalled()
    })
    expect(mockExecuteNewSessionFromLink).toHaveBeenCalledTimes(1)
    expect(mockConsumeSendMessages).toHaveBeenCalledTimes(1)
  })
})
