/** Tests for AncestorGroup - a session rail group's read-only transcript. */

import { render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import useAncestorTranscript from '../hooks/useAncestorTranscript'
import AncestorGroup from './AncestorGroup'
import { TurnRoutingContext } from './turn/TurnRoutingContext'

vi.mock('../hooks/useAncestorTranscript')

// Quote highlights are AncestorQuoteHighlights' own contract (see its test file) - stubbed here
// so this file stays focused on transcript rendering.
vi.mock('./inline-replies/AncestorQuoteHighlights', () => ({
  default: () => null,
}))

vi.mock('./inline-replies/hooks/useInlineReplies', () => ({
  default: () => ({ unsent: [] }),
}))

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ navigateToSession: vi.fn() }),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'ws-1' }),
}))

let mockSessions = []
vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))

let mockStoredView = {}
vi.mock('../../../api/uiState', () => ({
  getUiState: () => Promise.resolve({ session: mockStoredView }),
}))

// Reads TurnRoutingContext itself - proves which view the group shows without
// pulling in a real Turn tree, whose routing logic HistoricalTurnList and Turn already test.
vi.mock('./HistoricalTurnList', () => ({
  default: ({ turns, isSideThread, messagesEl }) => {
    const mode = useContext(TurnRoutingContext)

    return (
      <div
        data-testid="historical-turn-list"
        data-turn-count={turns.length}
        data-routing-mode={mode}
        data-is-side-thread={isSideThread}
        data-has-messages-el={Boolean(messagesEl)}>
        {turns.map(t => (
          <div key={t.turn_id} data-testid="turn">
            {t.userMessage}
          </div>
        ))}
      </div>
    )
  },
}))

function renderAncestor(status, turns) {
  vi.mocked(useAncestorTranscript).mockReturnValue({
    status,
    turns,
    turnResults: {},
    taskNotifications: new Map(),
    todoDiffs: new Map(),
    duplicateAskUserIds: new Set(),
  })
  render(<AncestorGroup sessionId="sess-1" />)
}

describe('AncestorGroup', () => {
  beforeEach(() => {
    vi.mocked(useAncestorTranscript).mockReset()
    mockSessions = []
    mockStoredView = {}
  })

  it('shows nothing while the transcript is loading', () => {
    renderAncestor('loading', [])

    expect(screen.queryByTestId('historical-turn-list')).not.toBeInTheDocument()
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
  })

  it('renders the transcript through HistoricalTurnList once ready - no second turn renderer', async () => {
    renderAncestor('ready', [{ turn_id: 't1', userMessage: 'hello' }])

    const list = await screen.findByTestId('historical-turn-list')
    expect(list).toHaveAttribute('data-turn-count', '1')
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  // Regression: AncestorGroup owns its scroll container and must attach it the way every other
  // column does - a stale prop name leaves this rail's virtualizer with no scroll element.
  it('gives HistoricalTurnList a real scroll element, not an unattached ref', async () => {
    renderAncestor('ready', [{ turn_id: 't1', userMessage: 'hello' }])

    expect(await screen.findByTestId('historical-turn-list')).toHaveAttribute(
      'data-has-messages-el',
      'true',
    )
  })

  it.each([
    ['never picked a view, Focused', {}, TurnRoutingMode.FOCUSED],
    ['picked Everything, every call inline', { rightSlotView: 'everything' }, TurnRoutingMode.OFF],
    [
      'picked Terminal, Everything with no column',
      { rightSlotView: 'terminal' },
      TurnRoutingMode.OFF,
    ],
  ])('shows a session that %s', async (_label, stored, mode) => {
    mockStoredView = stored
    renderAncestor('ready', [{ turn_id: 't1', userMessage: 'hello' }])

    expect(await screen.findByTestId('historical-turn-list')).toHaveAttribute(
      'data-routing-mode',
      mode,
    )
  })

  it('shows an unavailable placeholder and keeps its rail slot when the session cannot be read', () => {
    vi.mocked(useAncestorTranscript).mockReturnValue({
      status: 'unavailable',
      turns: [],
      turnResults: {},
      taskNotifications: new Map(),
      todoDiffs: new Map(),
      duplicateAskUserIds: new Set(),
    })

    render(<AncestorGroup sessionId="deleted-sess" />)

    expect(screen.getByTestId('rail-ancestor')).toBeInTheDocument()
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    expect(screen.queryByTestId('historical-turn-list')).not.toBeInTheDocument()
  })

  it('carries the session id on its root element for the header path to key off', () => {
    vi.mocked(useAncestorTranscript).mockReturnValue({
      status: 'loading',
      turns: [],
      turnResults: {},
      taskNotifications: new Map(),
      todoDiffs: new Map(),
      duplicateAskUserIds: new Set(),
    })

    render(<AncestorGroup sessionId="sess-42" />)

    expect(screen.getByTestId('rail-ancestor')).toHaveAttribute('data-session-id', 'sess-42')
  })

  it('passes isSideThread through from the fetched sessions list', async () => {
    mockSessions = [{ session_id: 'sess-1', is_side_thread: true }]
    renderAncestor('ready', [])

    expect(await screen.findByTestId('historical-turn-list')).toHaveAttribute(
      'data-is-side-thread',
      'true',
    )
  })

  it('defaults isSideThread to false when the session carries no marker', async () => {
    mockSessions = [{ session_id: 'sess-1' }]
    renderAncestor('ready', [])

    expect(await screen.findByTestId('historical-turn-list')).toHaveAttribute(
      'data-is-side-thread',
      'false',
    )
  })
})
