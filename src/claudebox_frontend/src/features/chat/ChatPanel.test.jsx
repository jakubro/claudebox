/** Tests for ChatPanel component. */

import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUiState } from '../../api/uiState'
import { createDeferred } from '../../utils/deferred'
import ChatPanel from './ChatPanel'

/** Render and flush async microtasks (getUiState promise in ChatPanel). */
async function render(ui) {
  let result
  await act(async () => {
    result = rtlRender(ui)
  })
  return result
}

// --- Mutable mocks ---

let mockEventsData = {}
let mockSessionDataCtx = {}
let mockInteractionData = {}
let mockChatControllerData = {}

// --- Mock hooks ---

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}))

vi.mock('../../context/BookmarksContext', () => ({
  useBookmarksContext: () => ({
    bookmarkedMessageIds: new Set(),
    isBookmarked: () => false,
    isTurnBookmarked: () => false,
    bookmarkedPartsOf: () => new Set(),
    toggleBookmark: vi.fn(),
  }),
}))

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

vi.mock('../../context/StreamingStatusContext', () => ({
  useStreamingStatus: () => mockEventsData,
}))

vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
  useSessionDir: () => null,
  useSessionId: () => 'test-session-id',
  useSessionWorkspace: () => null,
  useSessionActions: () => ({
    reloadSession: mockSessionDataCtx.reloadSession,
  }),
}))

vi.mock('../../context/InteractionContext', () => ({
  useInteraction: () => mockInteractionData,
}))

let mockSessions = []
let mockContainerStatus = 'running'
vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions, workspaceColor: null, seedSession: vi.fn() }),
}))

let mockRoutedSessionId = 'test-session-id'
vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeSessionId: mockRoutedSessionId,
    navigateToSession: vi.fn(),
  }),
}))

// WorkspaceContext export is also consumed directly by useSessionDefaults via
// useContext(WorkspaceContext) - re-export the createContext object so the import resolves.
let mockWorkspaceId = 'test-workspace'
vi.mock('../../context/WorkspaceContext', async () => {
  const { createContext } = await import('react')
  return {
    WorkspaceContext: createContext(null),
    useWorkspace: () => ({
      workspaceId: mockWorkspaceId,
      workspaces: [{ id: 'test-workspace', path: '/home/user/test-workspace' }],
    }),
  }
})

vi.mock('../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: null, runtimeName: null }),
}))

vi.mock('../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    deriveSessionStatus: () => mockContainerStatus,
    containerMap: {},
    setSessionContainer: vi.fn(),
    removeSessionContainer: vi.fn(),
  }),
}))

vi.mock('../../utils/navigation', () => ({
  openSessionInNewTab: vi.fn(),
}))

vi.mock('./hooks/useChatController', () => ({
  default: () => mockChatControllerData,
}))

vi.mock('./hooks/useNotifications', () => ({
  default: () => {},
}))

vi.mock('./hooks/useTurnHeights', () => ({
  default: () => ({ turnHeights: {}, userMessageHeights: {} }),
}))

vi.mock('./hooks/useMessageJump', () => ({
  default: () => ({
    jumpPrev: vi.fn(),
    jumpNext: vi.fn(),
    jumpTop: vi.fn(),
    jumpBottom: vi.fn(),
  }),
}))

// Real by default (activeView null, matching jsdom's zero-width layout), so showWorkView stays
// false everywhere except the jumpToTaskRef work-view test, which overrides it.
const mockTerminalSplitLayoutData = vi.hoisted(() => ({
  contentAreaRef: { current: null },
  terminalSplit: { view: 'off', ratio: 0.5 },
  activeView: null,
  setRightSlotView: vi.fn(),
  setTerminalSplitRatio: vi.fn(),
}))
const mockUseTerminalSplitLayout = vi.hoisted(() => vi.fn())
vi.mock('./hooks/useTerminalSplitLayout', () => ({
  useTerminalSplitLayout: (...args) => {
    mockUseTerminalSplitLayout(...args)
    return mockTerminalSplitLayoutData
  },
}))

// WorkColumn's own rendering is covered by its own test suite; showWorkView tests here exercise
// only ChatPanel's own routing into jumpToTaskInWorkColumn, not the column's internals.
vi.mock('./components/work', () => ({
  default: () => <div data-testid="mock-work-column" />,
}))

// Real findVisibleToolBlock/jumpToTask; jumpToTaskInWorkColumn is spied on so the work-view
// wiring test can assert its call args without a real virtualized WorkColumn mount.
const mockJumpToTaskInWorkColumn = vi.hoisted(() => vi.fn())
const mockJumpToTaskInTerminalColumn = vi.hoisted(() => vi.fn())
vi.mock('../../utils/taskScroll', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    jumpToTaskInWorkColumn: (...args) => mockJumpToTaskInWorkColumn(...args),
    jumpToTaskInTerminalColumn: (...args) => mockJumpToTaskInTerminalColumn(...args),
  }
})

// Stable identity across renders (mirrors the real useRef-backed context) so effects keyed on
// these refs fire only on their intended trigger, not per render.
const mockAppActions = vi.hoisted(() => ({
  jumpPrevRef: { current: null },
  jumpNextRef: { current: null },
  jumpTopRef: { current: null },
  jumpBottomRef: { current: null },
  rightColumnPrevRef: { current: null },
  rightColumnNextRef: { current: null },
  chatScrollPositionRef: { current: 0 },
  chatAutoScrollEnabledRef: { current: true },
  autoCollapseEnabledRef: { current: true },
  markUserIntentRef: { current: null },
  scrollToTurnRef: { current: null },
  expandTurnRef: { current: null },
  jumpToTaskRef: { current: null },
  jumpToBookmarkRef: { current: null },
  markProgrammaticScrollRef: { current: null },
  focusedGroupRootRef: { current: null },
  focusChatTab: vi.fn(),
  addSessionTab: vi.fn(),
  replaceSessionTab: vi.fn(),
}))

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => mockAppActions,
}))

// --- Mock heavy external libraries used by Turn's children ---

vi.mock('../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('./tools/tool-block', () => ({
  default: ({ toolUse }) => <div data-testid="tool-block">{toolUse?.content}</div>,
}))

// --- Mock child components that are not Turn ---

vi.mock('./components/chat-control-bar', () => ({
  default: ({ onReload, onToggleAutoCollapse, minimapPinned, onToggleMinimap }) => (
    <div data-testid="mock-chat-control-bar">
      <button
        type="button"
        data-testid="mock-minimap-btn"
        aria-pressed={minimapPinned}
        onClick={onToggleMinimap}>
        Minimap
      </button>
      <button type="button" data-testid="mock-reload-btn" onClick={onReload}>
        Reload
      </button>
      <button type="button" data-testid="mock-autocollapse-btn" onClick={onToggleAutoCollapse}>
        AutoCollapse
      </button>
    </div>
  ),
}))

vi.mock('./components/chat-input', () => ({
  default: ({ canInterrupt }) => (
    <div data-testid="mock-chat-input" data-can-interrupt={String(Boolean(canInterrupt))} />
  ),
}))

vi.mock('./components/minimap', () => ({
  default: () => <div data-testid="mock-minimap" />,
}))

vi.mock('./components/QueuedMessageBubble', () => ({
  default: () => <div data-testid="mock-queued-message-bubble" />,
}))

vi.mock('./components/RewindModal', () => ({
  default: () => <div data-testid="mock-rewind-modal" />,
}))

vi.mock('./components/SettingChangeDivider', () => ({
  default: () => <div data-testid="mock-setting-change-divider" />,
}))

vi.mock('../../components/ConfirmStopModal.jsx', () => ({
  default: ({ variant, onConfirm, onCancel }) => (
    <div data-testid="mock-confirm-stop-modal" data-variant={variant ?? 'stop'}>
      <button type="button" data-testid="mock-confirm-btn" onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" data-testid="mock-cancel-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}))

const mockInterrupt = vi.fn(() => Promise.resolve())
vi.mock('../../api/chat', () => ({
  interrupt: (...args) => mockInterrupt(...args),
}))

vi.mock('../../api/sessions', () => ({
  forkSession: vi.fn(),
}))

vi.mock('../../api/uiState', () => ({
  getUiState: vi.fn(() => Promise.resolve({})),
  patchSessionUiState: vi.fn(),
}))

let mockDaemonStreamData = { progressMessage: null, sessionsChanged: 0, changesByWorkspace: {} }
vi.mock('../../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({
    toast: null,
    showStillRunningToast: vi.fn(),
    dismissStillRunningToast: vi.fn(),
  }),
}))

vi.mock('../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => mockDaemonStreamData,
}))

// Real Turn, real processEvents; filtering/grouping lives in EventsContext.

import {
  appendTurns,
  INITIAL_TURN_GROUPING_STATE,
  isVisibleEvent,
} from '../../utils/eventProcessing'
import { RIGHT_SLOT_VIEWS, RightSlotView } from './utils/rightSlotViews'

// --- Helpers ---

/** Build turn results map from raw events, mirroring ChatPanel's own turn-result mapping. */
function buildTurnResults(events) {
  const results = {}
  for (const e of events) {
    if (e.type === 'result' && e.turn_id) {
      results[e.turn_id] = e.subtype
    }
  }
  return results
}

const NO_CREATIONS = { current: 0, bySeq: {} }

function defaultEventsData(overrides = {}) {
  const events = overrides.events || []
  const visibleEvents = events.filter(isVisibleEvent)
  return {
    events,
    turns: appendTurns([], INITIAL_TURN_GROUPING_STATE, visibleEvents).turns,
    turnResults: buildTurnResults(events),
    taskNotifications: new Map(),
    backgroundLaunches: new Map(),
    runningBackgroundWork: [],
    awaitingPickup: false,
    todoDiffs: new Map(),
    isConnected: true,
    isResponding: false,
    isResuming: false,
    isReplaying: false,
    replayTotal: 0,
    replayProgress: 0,
    containerId: 'test-container',
    isCreating: false,
    clearCreating: vi.fn(),
    isResumeRequestPending: false,
    isCreateRequestPending: false,
    creations: NO_CREATIONS,
    getCreation: () => NO_CREATIONS,
    ...overrides,
  }
}

function defaultSessionDataCtx(overrides = {}) {
  return {
    sessionId: 'sess-1',
    sessionName: 'Test Session',
    workspace: '/test',
    notificationsEnabled: false,
    reloadSession: vi.fn(),
    ...overrides,
  }
}

function defaultInteractionData(overrides = {}) {
  return {
    isSubmitting: false,
    interruptStatus: null,
    isAwaitingResponse: false,
    setError: vi.fn(),
    ...overrides,
  }
}

function defaultChatControllerData(overrides = {}) {
  return {
    refs: {
      messagesRef: { current: null },
      panelRef: { current: null },
    },
    scroll: {
      handleScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    },
    pending: {
      showPendingMessages: [],
      addPendingMessage: vi.fn(),
      removePendingMessage: vi.fn(),
      sentTurnTimes: {},
    },
    queue: {
      queueItems: [],
      enqueueMessage: vi.fn(),
      editQueuedItem: vi.fn(),
      cancelQueuedItem: vi.fn(),
      requeueItem: vi.fn(),
      sendNowItem: vi.fn(),
    },
    deferred: {
      deferredSend: null,
      deferSend: vi.fn(),
    },
    send: vi.fn(),
    ...overrides,
  }
}

async function reloadWhileResponding() {
  const user = userEvent.setup()
  mockEventsData = defaultEventsData({ isResponding: true })
  await render(<ChatPanel />)
  await user.click(screen.getByTestId('mock-reload-btn'))

  return user
}

describe('ChatPanel', () => {
  beforeEach(() => {
    mockRoutedSessionId = 'test-session-id'
    mockWorkspaceId = 'test-workspace'
    mockUseTerminalSplitLayout.mockClear()
    mockSessions = []
    mockContainerStatus = 'running'
    mockEventsData = defaultEventsData()
    mockSessionDataCtx = defaultSessionDataCtx()
    mockInteractionData = defaultInteractionData()
    mockChatControllerData = defaultChatControllerData()
    mockDaemonStreamData = { progressMessage: null }
    mockInterrupt.mockClear()
    mockAppActions.autoCollapseEnabledRef.current = true
    mockAppActions.chatAutoScrollEnabledRef.current = true
  })

  describe('waiting on background work', () => {
    const finishedTurn = [
      {
        type: 'user',
        is_human: true,
        content: 'Start it',
        turn_id: 't1',
        ts: '2026-01-01T00:00:01Z',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Started.',
        turn_id: 't1',
        ts: '2026-01-01T00:00:02Z',
      },
      { type: 'result', subtype: 'success', turn_id: 't1' },
    ]
    const oneTask = [
      { id: 'b1', name: 'Wait ninety seconds\nsecond line', toolUseId: 'tu1', index: 1 },
    ]

    it('names the one task the finished turn waits on, in place of the duration', async () => {
      mockEventsData = defaultEventsData({ events: finishedTurn, runningBackgroundWork: oneTask })

      await render(<ChatPanel />)

      expect(screen.getByTestId('turn-progress-waiting')).toHaveTextContent(
        'Waiting on Wait ninety seconds...',
      )
      expect(screen.queryByText(/worked for/)).not.toBeInTheDocument()
    })

    it('counts several tasks', async () => {
      mockEventsData = defaultEventsData({
        events: finishedTurn,
        runningBackgroundWork: [...oneTask, { ...oneTask[0], id: 'a2', name: 'Review' }],
      })

      await render(<ChatPanel />)

      expect(screen.getByTestId('turn-progress-waiting')).toHaveTextContent(
        'Waiting on 2 background tasks',
      )
    })

    it('shows no waiting line once the session has no live container', async () => {
      mockContainerStatus = 'none'
      mockEventsData = defaultEventsData({ events: finishedTurn, runningBackgroundWork: oneTask })

      await render(<ChatPanel />)

      expect(screen.queryByTestId('turn-progress-waiting')).not.toBeInTheDocument()
    })

    it('shows no waiting line while a sent message waits for its turn', async () => {
      mockEventsData = defaultEventsData({ events: finishedTurn, runningBackgroundWork: oneTask })
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('Next'),
      })

      await render(<ChatPanel />)

      expect(screen.queryByTestId('turn-progress-waiting')).not.toBeInTheDocument()
    })

    it('shows working between a task finishing and the agent picking up', async () => {
      mockEventsData = defaultEventsData({ events: finishedTurn, awaitingPickup: true })

      await render(<ChatPanel />)

      expect(screen.getByTestId('turn-progress-working')).toBeInTheDocument()
      expect(screen.queryByTestId('turn-progress-waiting')).not.toBeInTheDocument()
    })
  })

  describe('event filtering', () => {
    it('filters out system init events', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'system', subtype: 'init', content: 'init' },
          { type: 'user', is_human: true, content: 'Hello', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Hi', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      // Should have one turn (init filtered out)
      expect(turns).toHaveLength(1)
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })

    it('filters out system hook_response events', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'system', subtype: 'hook_response', content: 'hook' },
          { type: 'user', is_human: true, content: 'Message', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(1)
      expect(screen.getByText('Message')).toBeInTheDocument()
    })

    it('filters out result events from visible events', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'Ask', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Answer', turn_id: 't1' },
          { type: 'result', subtype: 'success', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      // Result events should not create their own turn
      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(1)
    })

    it('keeps normal system events that are not init or hook_response', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'First', turn_id: 't1' },
          { type: 'system', subtype: 'interrupt_sent', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(1)
    })
  })

  describe('auto-collapse', () => {
    // Events carry `ts` so getTurnTimeRange yields a startTime - without it TurnMeta (and its
    // collapse toggle) never renders, so a turn cannot be expanded/collapsed by hand.
    const threeCompletedTurns = () => ({
      events: [
        { type: 'user', is_human: true, content: 'One', turn_id: 't1', ts: '2026-01-01T00:00:01Z' },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'A1',
          turn_id: 't1',
          ts: '2026-01-01T00:00:02Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't1' },
        { type: 'user', is_human: true, content: 'Two', turn_id: 't2', ts: '2026-01-01T00:00:11Z' },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'A2',
          turn_id: 't2',
          ts: '2026-01-01T00:00:12Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't2' },
        {
          type: 'user',
          is_human: true,
          content: 'Three',
          turn_id: 't3',
          ts: '2026-01-01T00:00:21Z',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'A3',
          turn_id: 't3',
          ts: '2026-01-01T00:00:22Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't3' },
      ],
    })

    const renderThreeTurns = () => {
      mockEventsData = defaultEventsData(threeCompletedTurns())

      return render(<ChatPanel />)
    }

    const renderThreeTurnsCollapsed = async () => {
      const view = await renderThreeTurns()
      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
      })

      return view
    }

    const renderWithFirstTurnExpanded = async () => {
      const user = userEvent.setup()
      const view = await renderThreeTurnsCollapsed()
      const firstTurn = () => document.querySelector('[data-turn-id="t1"]')
      await user.click(document.querySelector('[data-turn-id="t1"] .turn-meta'))
      await waitFor(() => {
        expect(firstTurn()).not.toHaveClass('turn-collapsed')
      })

      return { user, ...view }
    }

    it('collapses every turn except the last by default', async () => {
      await renderThreeTurns()

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t2"]')).toHaveClass('turn-collapsed')
      expect(document.querySelector('[data-turn-id="t3"]')).not.toHaveClass('turn-collapsed')
    })

    it('expands every collapsed turn when auto-collapse is toggled off', async () => {
      const user = userEvent.setup()
      await renderThreeTurnsCollapsed()

      await user.click(screen.getByTestId('mock-autocollapse-btn'))

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t2"]')).not.toHaveClass('turn-collapsed')
    })

    const withFourthTurn = () => ({
      events: [
        ...threeCompletedTurns().events,
        {
          type: 'user',
          is_human: true,
          content: 'Four',
          turn_id: 't4',
          ts: '2026-01-01T00:00:31Z',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'A4',
          turn_id: 't4',
          ts: '2026-01-01T00:00:32Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't4' },
      ],
    })

    it('keeps a manually-expanded turn expanded when a new turn arrives', async () => {
      // Manually expand the oldest collapsed turn.
      const { rerender } = await renderWithFirstTurnExpanded()

      // A new turn arrives (t4 becomes the last turn).
      mockEventsData = defaultEventsData(withFourthTurn())
      await act(async () => {
        rerender(<ChatPanel />)
      })

      // The manual expand survives; the previously-last turn (t3) collapses.
      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t3"]')).toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
      expect(document.querySelector('[data-turn-id="t2"]')).toHaveClass('turn-collapsed')
      expect(document.querySelector('[data-turn-id="t4"]')).not.toHaveClass('turn-collapsed')
    })

    it('returns a manually-expanded turn to auto control once it is collapsed by hand', async () => {
      // Expand t1, then collapse it again by hand (clears its manual-expand memory).
      const { user, rerender } = await renderWithFirstTurnExpanded()
      await user.click(document.querySelector('[data-turn-id="t1"] .turn-meta'))
      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
      })

      // New turn arrives: t1 stays collapsed (back under auto control).
      mockEventsData = defaultEventsData(withFourthTurn())
      await act(async () => {
        rerender(<ChatPanel />)
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t4"]')).not.toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
    })

    it('wipes manual-expand memory when auto-collapse is toggled off then on', async () => {
      // Manually expand t1.
      const { user } = await renderWithFirstTurnExpanded()

      // Toggle off (all expand) then on (fresh collapse-all-but-last, memory wiped).
      await user.click(screen.getByTestId('mock-autocollapse-btn'))
      await user.click(screen.getByTestId('mock-autocollapse-btn'))

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t2"]')).toHaveClass('turn-collapsed')
      expect(document.querySelector('[data-turn-id="t3"]')).not.toHaveClass('turn-collapsed')
    })

    it('expandTurnRef opens a collapsed turn for a sibling panel (Tasks)', async () => {
      await renderThreeTurnsCollapsed()

      await act(async () => {
        mockAppActions.expandTurnRef.current('t1')
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
      })
    })

    it('expandTurnRef no-ops on a turn that is already open', async () => {
      await renderThreeTurns()

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t3"]')).not.toHaveClass('turn-collapsed')
      })

      await act(async () => {
        mockAppActions.expandTurnRef.current('t3')
      })

      expect(document.querySelector('[data-turn-id="t3"]')).not.toHaveClass('turn-collapsed')
    })

    it('a turn opened via expandTurnRef stays open across the next auto-collapse recompute', async () => {
      const { rerender } = await renderThreeTurnsCollapsed()

      await act(async () => {
        mockAppActions.expandTurnRef.current('t1')
      })
      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
      })

      // A new turn arrives (t4 becomes the last turn) - the recompute runs again.
      mockEventsData = defaultEventsData(withFourthTurn())
      await act(async () => {
        rerender(<ChatPanel />)
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t3"]')).toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
    })

    it('a turn opened via expandTurnRef as a new turn arrives in the same update stays open', async () => {
      const { rerender } = await renderThreeTurnsCollapsed()

      mockEventsData = defaultEventsData(withFourthTurn())
      await act(async () => {
        mockAppActions.expandTurnRef.current('t3')
        rerender(<ChatPanel />)
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t4"]')).not.toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t2"]')).toHaveClass('turn-collapsed')
      expect(document.querySelector('[data-turn-id="t3"]')).not.toHaveClass('turn-collapsed')
    })

    it('keeps a turn opened before the session id arrived open when the next turn arrives', async () => {
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: null })
      const { rerender } = await renderThreeTurnsCollapsed()

      await act(async () => {
        mockAppActions.expandTurnRef.current('t1')
      })
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'sess-1' })
      await act(async () => {
        rerender(<ChatPanel />)
      })
      mockEventsData = defaultEventsData(withFourthTurn())
      await act(async () => {
        rerender(<ChatPanel />)
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t3"]')).toHaveClass('turn-collapsed')
      })
      expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
    })
  })

  describe('jumpToTaskRef', () => {
    // t1 (collapsed by default) carries the Task block; t2 is the last, open turn.
    const twoTurnsTaskInFirst = () => ({
      events: [
        { type: 'user', is_human: true, content: 'One', turn_id: 't1', ts: '2026-01-01T00:00:01Z' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          tool_use_id: 'task_1',
          tool_input: { description: 'Do research' },
          turn_id: 't1',
          ts: '2026-01-01T00:00:02Z',
        },
        {
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: 'task_1',
          content: 'Done',
          turn_id: 't1',
          ts: '2026-01-01T00:00:03Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't1' },
        { type: 'user', is_human: true, content: 'Two', turn_id: 't2', ts: '2026-01-01T00:00:11Z' },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'A2',
          turn_id: 't2',
          ts: '2026-01-01T00:00:12Z',
        },
        { type: 'result', subtype: 'success', turn_id: 't2' },
      ],
    })

    it('highlights an already-mounted task block in the open turn, without expanding anything', async () => {
      mockEventsData = defaultEventsData({
        events: [
          {
            type: 'user',
            is_human: true,
            content: 'One',
            turn_id: 't1',
            ts: '2026-01-01T00:00:01Z',
          },
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Task',
            tool_use_id: 'task_open',
            tool_input: { description: 'Do research' },
            turn_id: 't1',
            ts: '2026-01-01T00:00:02Z',
          },
          {
            type: 'user',
            subtype: 'tool_result',
            tool_use_id: 'task_open',
            content: 'Done',
            turn_id: 't1',
            ts: '2026-01-01T00:00:03Z',
          },
        ],
      })
      await render(<ChatPanel />)

      await waitFor(() => {
        expect(document.querySelector('[data-tool-use-id="task_open"]')).toBeInTheDocument()
      })

      await act(async () => {
        mockAppActions.jumpToTaskRef.current({ id: 'task_open', turnId: 't1' })
      })

      await waitFor(() => {
        expect(document.querySelector('[data-tool-use-id="task_open"]')).toHaveClass(
          'task-highlight',
        )
      })
    })

    it('expands the collapsed turn holding the task block, then highlights it', async () => {
      mockEventsData = defaultEventsData(twoTurnsTaskInFirst())
      await render(<ChatPanel />)

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
      })

      await act(async () => {
        mockAppActions.jumpToTaskRef.current({ id: 'task_1', turnId: 't1' })
      })

      await waitFor(() => {
        expect(document.querySelector('[data-turn-id="t1"]')).not.toHaveClass('turn-collapsed')
      })
      await waitFor(() => {
        expect(document.querySelector('[data-tool-use-id="task_1"]')).toHaveClass('task-highlight')
      })
    })

    it('does not throw when the task cannot be resolved (no turn id, block absent)', async () => {
      mockEventsData = defaultEventsData(twoTurnsTaskInFirst())
      await render(<ChatPanel />)

      await act(async () => {
        mockAppActions.jumpToTaskRef.current({ id: 'task_missing', turnId: null })
      })

      expect(document.querySelector('[data-turn-id="t1"]')).toHaveClass('turn-collapsed')
    })

    describe('work view active', () => {
      beforeEach(() => {
        mockTerminalSplitLayoutData.activeView = RIGHT_SLOT_VIEWS[RightSlotView.WORK]
        mockJumpToTaskInWorkColumn.mockClear()
      })

      afterEach(() => {
        mockTerminalSplitLayoutData.activeView = null
      })

      it('routes to jumpToTaskInWorkColumn with the task turn resolved by index', async () => {
        mockEventsData = defaultEventsData(twoTurnsTaskInFirst())
        await render(<ChatPanel />)

        await act(async () => {
          mockAppActions.jumpToTaskRef.current({ id: 'task_1', turnId: 't1' })
        })

        expect(mockJumpToTaskInWorkColumn).toHaveBeenCalledWith(
          0,
          'task_1',
          expect.objectContaining({
            markUserIntent: expect.any(Function),
            markProgrammaticScroll: expect.any(Function),
            markReturnedToBottom: expect.any(Function),
          }),
        )
      })

      it('does not call jumpToTaskInWorkColumn when the task turn is not found', async () => {
        mockEventsData = defaultEventsData(twoTurnsTaskInFirst())
        await render(<ChatPanel />)

        await act(async () => {
          mockAppActions.jumpToTaskRef.current({ id: 'task_1', turnId: 'no-such-turn' })
        })

        expect(mockJumpToTaskInWorkColumn).not.toHaveBeenCalled()
      })
    })

    describe('with the terminal view open', () => {
      const twoCommands = () => ({
        events: [
          { type: 'user', is_human: true, content: 'Go', turn_id: 't1' },
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Bash',
            tool_use_id: 'tu1',
            tool_input: { command: 'ls' },
          },
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Bash',
            tool_use_id: 'tu2',
            tool_input: { command: 'sleep 60' },
          },
        ],
      })

      beforeEach(() => {
        mockTerminalSplitLayoutData.activeView = RIGHT_SLOT_VIEWS[RightSlotView.TERMINAL]
        mockJumpToTaskInTerminalColumn.mockClear()
      })

      afterEach(() => {
        mockTerminalSplitLayoutData.activeView = null
      })

      it('lands a command row on its entry in the terminal column', async () => {
        mockEventsData = defaultEventsData(twoCommands())
        await render(<ChatPanel />)

        await act(async () => {
          mockAppActions.jumpToTaskRef.current({ id: 'tu2', turnId: 't1', kind: 'command' })
        })

        expect(mockJumpToTaskInTerminalColumn).toHaveBeenCalledWith(
          1,
          'tu2',
          expect.objectContaining({ markProgrammaticScroll: expect.any(Function) }),
        )
      })

      it('leaves a subagent row to the transcript', async () => {
        mockEventsData = defaultEventsData(twoCommands())
        await render(<ChatPanel />)

        await act(async () => {
          mockAppActions.jumpToTaskRef.current({ id: 'task_1', turnId: 't1', kind: 'subagent' })
        })

        expect(mockJumpToTaskInTerminalColumn).not.toHaveBeenCalled()
      })
    })
  })

  describe('turn grouping', () => {
    it('groups events into turns starting with human user messages', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'Turn 1', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Response 1', turn_id: 't1' },
          { type: 'user', is_human: true, content: 'Turn 2', turn_id: 't2' },
          { type: 'assistant', subtype: 'text', content: 'Response 2', turn_id: 't2' },
        ],
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(2)
      expect(screen.getByText('Turn 1')).toBeInTheDocument()
      expect(screen.getByText('Turn 2')).toBeInTheDocument()
    })

    it('creates orphan turn for assistant events without prior user message', async () => {
      mockEventsData = defaultEventsData({
        events: [{ type: 'assistant', subtype: 'text', content: 'Orphan', turn_id: 't0' }],
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(1)
      // Orphan turn has no user message - verify no message-user div
      expect(screen.queryByTestId('message-user')).not.toBeInTheDocument()
    })
  })

  describe('turn results map', () => {
    it('maps result events to turn_id for status styling', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'Ask', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Answer', turn_id: 't1' },
          { type: 'result', subtype: 'success', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      // Success result doesn't apply error class
      expect(document.querySelector('.turn-error')).not.toBeInTheDocument()
    })

    it('maps error result status correctly', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'Ask', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Fail', turn_id: 't1' },
          { type: 'result', subtype: 'error', turn_id: 't1' },
        ],
      })

      await render(<ChatPanel />)

      // Error result applies turn-error class on real Turn
      expect(document.querySelector('.turn-error')).toBeInTheDocument()
    })
  })

  describe('pending messages', () => {
    it('renders pending message turns', async () => {
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('Pending message'),
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      const pendingTurn = turns.find(t => t.classList.contains('pending'))
      expect(pendingTurn).toBeTruthy()
      expect(screen.getByText('Pending message')).toBeInTheDocument()
    })

    it('renders pending messages after regular turns', async () => {
      mockEventsData = defaultEventsData({
        events: [
          { type: 'user', is_human: true, content: 'Real msg', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'Reply', turn_id: 't1' },
        ],
      })
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('Pending'),
      })

      await render(<ChatPanel />)

      const turns = screen.getAllByTestId('turn-container')
      expect(turns).toHaveLength(2)
      expect(screen.getByText('Real msg')).toBeInTheDocument()
      expect(turns[1].classList.contains('pending')).toBe(true)
    })
  })

  describe('replay overlay', () => {
    it('shows replay progress bar when isReplaying is true', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 100,
        replayProgress: 50,
      })

      await render(<ChatPanel />)

      const overlay = document.querySelector('.chat-replay-overlay')
      expect(overlay).toBeInTheDocument()

      const fill = document.querySelector('.chat-replay-progress-fill')
      expect(fill).toBeInTheDocument()
      expect(fill.style.width).toBe('50%')
    })

    it('shows 0% width when replayTotal is 0', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 0,
        replayProgress: 0,
      })

      await render(<ChatPanel />)

      const fill = document.querySelector('.chat-replay-progress-fill')
      expect(fill.style.width).toBe('0%')
    })

    it('hides ChatControlBar during replay', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 10,
        replayProgress: 5,
      })

      await render(<ChatPanel />)

      expect(screen.queryByTestId('mock-chat-control-bar')).not.toBeInTheDocument()
    })

    it('shows ChatControlBar and ChatInput when not replaying', async () => {
      mockEventsData = defaultEventsData({ isReplaying: false })

      await render(<ChatPanel />)

      expect(screen.getByTestId('mock-chat-control-bar')).toBeInTheDocument()
      expect(screen.getByTestId('mock-chat-input')).toBeInTheDocument()
    })

    it('shows progress message during creation', async () => {
      mockEventsData = defaultEventsData({ isCreating: true })
      mockDaemonStreamData = { progressMessage: 'Creating container' }

      await render(<ChatPanel />)

      expect(screen.getByText('Creating container…')).toBeInTheDocument()
    })

    it('shows replay count during replay', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 100,
        replayProgress: 42,
      })

      await render(<ChatPanel />)

      expect(screen.getByText('Replaying events (42/100)…')).toBeInTheDocument()
    })

    it('shows resuming fallback when no progress message', async () => {
      mockEventsData = defaultEventsData({
        isResuming: true,
        isReplaying: false,
      })

      await render(<ChatPanel />)

      expect(screen.getByText('Loading session…')).toBeInTheDocument()
    })

    it('shows daemon progress message during resume when available', async () => {
      mockEventsData = defaultEventsData({
        isResuming: true,
        isReplaying: false,
      })
      mockDaemonStreamData = { progressMessage: 'Resuming session' }

      await render(<ChatPanel />)

      expect(screen.getByText('Resuming session…')).toBeInTheDocument()
    })

    it('shows replay overlay when isResuming is true (before replay starts)', async () => {
      mockEventsData = defaultEventsData({
        isResuming: true,
        isReplaying: false,
        replayTotal: 0,
        replayProgress: 0,
      })

      await render(<ChatPanel />)

      const overlay = document.querySelector('.chat-replay-overlay')
      expect(overlay).toBeInTheDocument()
      expect(screen.queryByTestId('mock-chat-control-bar')).not.toBeInTheDocument()
    })

    it('shows ChatInput during overlay (textarea always visible)', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 10,
        replayProgress: 5,
      })

      await render(<ChatPanel />)

      expect(screen.getByTestId('mock-chat-input')).toBeInTheDocument()
    })

    it('wraps pending turns in .chat-overlay-hoist so they sit above the overlay during isCreating', async () => {
      mockEventsData = defaultEventsData({ isCreating: true })
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('first'),
      })

      await render(<ChatPanel />)

      const overlay = document.querySelector('.chat-replay-overlay')
      expect(overlay).toBeInTheDocument()

      const hoist = document.querySelector('.chat-overlay-hoist')
      expect(hoist).toBeInTheDocument()
      const pendingTurn = hoist.querySelector('[data-testid="turn-container"]')
      expect(pendingTurn).toBeTruthy()
      expect(pendingTurn.classList.contains('pending')).toBe(true)
    })

    it('wraps deferred-message turn in .chat-overlay-hoist when no pending and overlay visible', async () => {
      mockEventsData = defaultEventsData({ isCreating: true })
      mockChatControllerData = defaultChatControllerData({
        deferred: {
          deferredSend: { content: 'deferred msg', attachments: null },
          deferSend: vi.fn(),
        },
      })

      await render(<ChatPanel />)

      const hoist = document.querySelector('.chat-overlay-hoist')
      expect(hoist).toBeInTheDocument()
      expect(hoist.querySelector('[data-testid="turn-container"]')).toBeTruthy()
    })

    it('wraps queued message bubbles in the same .chat-overlay-hoist so they stay visible during isCreating', async () => {
      mockEventsData = defaultEventsData({ isCreating: true })
      mockChatControllerData = defaultChatControllerData({
        queue: {
          queueItems: [{ id: 'q1', content: 'queued msg' }],
          enqueueMessage: vi.fn(),
          editQueuedItem: vi.fn(),
          cancelQueuedItem: vi.fn(),
          requeueItem: vi.fn(),
          sendNowItem: vi.fn(),
        },
      })

      await render(<ChatPanel />)

      const hoist = document.querySelector('.chat-overlay-hoist')
      expect(hoist).toBeInTheDocument()
      expect(hoist.querySelector('[data-testid="mock-queued-message-bubble"]')).toBeTruthy()
    })

    it('renders the overlay as a child of chat-content-area, not chat-transcript-column', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 10,
        replayProgress: 5,
      })

      await render(<ChatPanel />)

      const overlay = document.querySelector('.chat-replay-overlay')
      expect(overlay.parentElement).toHaveClass('chat-content-area')
      expect(overlay.closest('.chat-transcript-column')).toBeNull()
    })

    it('does not render the transcript minimap while the overlay is up', async () => {
      mockEventsData = defaultEventsData({
        isReplaying: true,
        replayTotal: 10,
        replayProgress: 5,
      })

      await render(<ChatPanel />)

      expect(screen.queryByTestId('mock-minimap')).not.toBeInTheDocument()
    })
  })

  describe('while another session opens', () => {
    it('offers no Stop for the session being left while the routed one opens', async () => {
      mockRoutedSessionId = 'sess-b'
      mockEventsData = defaultEventsData({ isResponding: true, isResumeRequestPending: true })

      await render(<ChatPanel />)

      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-can-interrupt', 'false')
    })

    it('offers Stop for the routed session once it is the one attached', async () => {
      mockEventsData = defaultEventsData({ isResponding: true })

      await render(<ChatPanel />)

      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-can-interrupt', 'true')
    })

    it('keeps "Resuming" past its safety timeout while the open request is pending', async () => {
      vi.useFakeTimers()
      try {
        const clearResume = vi.fn()
        mockEventsData = defaultEventsData({
          isResuming: true,
          isResumeRequestPending: true,
          clearResume,
        })

        await render(<ChatPanel />)
        act(() => {
          vi.advanceTimersByTime(31_000)
        })

        expect(clearResume).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('no-container welcome state', () => {
    it('shows welcome message when containerId is null', async () => {
      mockRoutedSessionId = null
      mockEventsData = defaultEventsData({ containerId: null })

      await render(<ChatPanel />)

      expect(screen.getByTestId('welcome-page')).toBeInTheDocument()
      // ChatInput renders inside the welcome page so users can submit a message immediately to spawn a session.
      expect(screen.getByTestId('mock-chat-input')).toBeInTheDocument()
      // The chat-control-bar (model picker, fork, etc.) only renders for an active session - it must
      // stay hidden on the welcome screen.
      expect(screen.queryByTestId('mock-chat-control-bar')).not.toBeInTheDocument()
    })

    it('does not show welcome message when containerId is set', async () => {
      mockEventsData = defaultEventsData({ containerId: 'ctr-1' })

      await render(<ChatPanel />)

      expect(screen.queryByText(/Start a new session/)).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message when no events and no pending messages', async () => {
      mockEventsData = defaultEventsData({ events: [] })
      mockChatControllerData = defaultChatControllerData()

      await render(<ChatPanel />)

      expect(screen.getByText('Waiting for messages...')).toBeInTheDocument()
    })

    it('does not show empty message when there are events', async () => {
      mockEventsData = defaultEventsData({
        events: [{ type: 'user', is_human: true, content: 'Hello', turn_id: 't1' }],
      })

      await render(<ChatPanel />)

      expect(screen.queryByText('Waiting for messages...')).not.toBeInTheDocument()
    })

    it('does not show empty message when there are pending messages', async () => {
      mockEventsData = defaultEventsData({ events: [] })
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('Pending'),
      })

      await render(<ChatPanel />)

      expect(screen.queryByText('Waiting for messages...')).not.toBeInTheDocument()
    })
  })

  describe('reload guard', () => {
    it('reloads immediately when not responding', async () => {
      const user = userEvent.setup()
      mockEventsData = defaultEventsData({ isResponding: false })

      await render(<ChatPanel />)

      await user.click(screen.getByTestId('mock-reload-btn'))

      expect(mockSessionDataCtx.reloadSession).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('mock-confirm-stop-modal')).not.toBeInTheDocument()
    })

    it('shows confirmation modal when responding', async () => {
      await reloadWhileResponding()

      expect(mockSessionDataCtx.reloadSession).not.toHaveBeenCalled()
      expect(screen.getByTestId('mock-confirm-stop-modal')).toBeInTheDocument()
    })

    it('interrupts and reloads on confirm', async () => {
      const user = await reloadWhileResponding()
      await user.click(screen.getByTestId('mock-confirm-btn'))

      expect(mockInterrupt).toHaveBeenCalledOnce()
      expect(mockSessionDataCtx.reloadSession).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('mock-confirm-stop-modal')).not.toBeInTheDocument()
    })

    it('dismisses modal on cancel without reloading', async () => {
      const user = await reloadWhileResponding()
      await user.click(screen.getByTestId('mock-cancel-btn'))

      expect(mockInterrupt).not.toHaveBeenCalled()
      expect(mockSessionDataCtx.reloadSession).not.toHaveBeenCalled()
      expect(screen.queryByTestId('mock-confirm-stop-modal')).not.toBeInTheDocument()
    })
  })

  describe('deferred send fallback', () => {
    it('renders deferred message as pending turn in main chat area', async () => {
      mockEventsData = defaultEventsData({ isCreating: false })
      mockChatControllerData = defaultChatControllerData({
        deferred: {
          deferredSend: { content: 'Pre-composed message', attachments: [] },
          deferSend: vi.fn(),
        },
      })

      await render(<ChatPanel />)

      expect(screen.getByText('Pre-composed message')).toBeInTheDocument()
      const turns = screen.getAllByTestId('turn-container')
      expect(turns[turns.length - 1].classList.contains('pending')).toBe(true)
    })

    it('does not render deferred message when pending messages exist', async () => {
      mockEventsData = defaultEventsData({ isCreating: false })
      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage('Sent message'),
        deferred: {
          deferredSend: { content: 'Pre-composed message', attachments: [] },
          deferSend: vi.fn(),
        },
      })

      await render(<ChatPanel />)

      expect(screen.getByText('Sent message')).toBeInTheDocument()
      expect(screen.queryByText('Pre-composed message')).not.toBeInTheDocument()
    })
  })

  describe('active and stopping states', () => {
    it('marks last turn as active when responding', async () => {
      mockEventsData = defaultEventsData({
        isResponding: true,
        events: [
          { type: 'user', is_human: true, content: 'Q1', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'A1', turn_id: 't1' },
          { type: 'user', is_human: true, content: 'Q2', turn_id: 't2' },
          { type: 'assistant', subtype: 'text', content: 'A2', turn_id: 't2' },
        ],
      })

      await render(<ChatPanel />)

      // Real Turn shows "Working" indicator when isActive=true
      expect(screen.getByText('Working')).toBeInTheDocument()
      // Only the last turn should show Working indicator
      expect(screen.getAllByText('Working')).toHaveLength(1)
    })

    it('marks last turn as stopping when interrupt is stopping', async () => {
      mockEventsData = defaultEventsData({
        isResponding: true,
        events: [
          { type: 'user', is_human: true, content: 'Q1', turn_id: 't1' },
          { type: 'assistant', subtype: 'text', content: 'A1', turn_id: 't1' },
        ],
      })
      mockInteractionData = defaultInteractionData({
        interruptStatus: 'stopping',
      })

      await render(<ChatPanel />)

      // Real Turn shows "Stopping" indicator when isStopping=true
      expect(screen.getByText('Stopping')).toBeInTheDocument()
    })
  })

  describe('active turn pending-message state', () => {
    // Must assert at the ChatPanel level: ToolBlock.test.jsx's skip-detection tests drive
    // TurnProvider directly and pass regardless of ChatPanel's own wiring.
    function askUserQuestionEvents() {
      return [
        { type: 'user', is_human: true, content: 'Help me set up the project', turn_id: 't1' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'AskUserQuestion',
          tool_use_id: 'tool_001',
          tool_name: 'AskUserQuestion',
          tool_input: {
            questions: [
              {
                question: 'Which framework?',
                header: 'Framework',
                options: [{ label: 'React' }, { label: 'Vue' }],
              },
            ],
          },
        },
        // Awaiting-answer marker - a live question carries this result, not a missing one.
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'Answer questions?',
          tool_use_id: 'tool_001',
        },
      ]
    }

    it('marks the question Skipped and retires the live form the instant a message is in flight', async () => {
      mockEventsData = defaultEventsData({ events: askUserQuestionEvents() })
      const { container, rerender } = await render(<ChatPanel />)

      // Mount with no message in flight, then transition - the skip effect only fires on a
      // false->true edge, never when mounted already-pending.
      const formBefore = container.querySelector('.tool-questions-interactive')
      expect(formBefore).not.toBeNull()
      expect(formBefore).not.toHaveClass('disabled')

      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage("actually, let's use Svelte"),
      })
      await act(async () => {
        rerender(<ChatPanel />)
      })

      // Skipping collapses the block the same way answering it does.
      expect(container.querySelector('.tool-questions-interactive')).toBeNull()
      expect(screen.getByText('Skipped')).toBeInTheDocument()
      expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-status', 'completed')
    })

    it('does not retire the form as Skipped when a selection was submitted before the message goes in flight', async () => {
      mockEventsData = defaultEventsData({ events: askUserQuestionEvents() })
      const user = userEvent.setup()
      const { rerender } = await render(<ChatPanel />)

      // Mirrors Enter-with-a-selection: setWasAnsweredLocally(true) runs synchronously before
      // the send call that later surfaces a pending message.
      await user.click(screen.getByText('React'))
      await user.click(screen.getByText('Submit Response'))

      mockChatControllerData = defaultChatControllerData({
        pending: pendingMessage("actually, let's use Svelte"),
      })
      await act(async () => {
        rerender(<ChatPanel />)
      })

      // Answered, not skipped - the ordering the Enter-with-selection path depends on.
      expect(screen.queryByText('Skipped')).not.toBeInTheDocument()
    })

    it('leaves the form fully interactive when no message is in flight', async () => {
      mockEventsData = defaultEventsData({ events: askUserQuestionEvents() })

      const { container } = await render(<ChatPanel />)

      const form = container.querySelector('.tool-questions-interactive')
      expect(form).not.toBeNull()
      expect(form).not.toHaveClass('disabled')
      expect(form.querySelector('.tool-submit-btn')).not.toBeNull()
    })
  })

  describe('minimap pins across a session switch', () => {
    let reads

    beforeEach(() => {
      reads = { A: createDeferred(), B: createDeferred() }
      getUiState.mockImplementation(id => reads[id].promise)
    })

    afterEach(() => {
      getUiState.mockImplementation(() => Promise.resolve({}))
    })

    const pinned = () => screen.getByTestId('mock-minimap-btn').getAttribute('aria-pressed')

    async function switchAToB() {
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'A' })
      const view = await render(<ChatPanel />)
      for (const id of [null, 'B']) {
        mockSessionDataCtx = defaultSessionDataCtx({ sessionId: id })
        await act(async () => {
          view.rerender(<ChatPanel />)
        })
      }

      return view
    }

    it('drops a late reply for the session left', async () => {
      await switchAToB()

      await act(async () => {
        reads.B.resolve({ session: { minimapPinned: true } })
      })
      await act(async () => {
        reads.A.resolve({ session: { minimapPinned: false } })
      })

      expect(pinned()).toBe('true')
    })

    it('shows pinned when the session read fails', async () => {
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'A' })
      const view = await render(<ChatPanel />)
      await act(async () => {
        reads.A.resolve({ session: { minimapPinned: false } })
      })
      expect(pinned()).toBe('false')

      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'B' })
      await act(async () => {
        view.rerender(<ChatPanel />)
      })
      await act(async () => {
        reads.B.reject(new Error('timeout'))
      })

      expect(pinned()).toBe('true')
    })

    it('keeps a toggle made while the session reads its own value', async () => {
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'B' })
      await render(<ChatPanel />)
      await userEvent.click(screen.getByTestId('mock-minimap-btn'))

      await act(async () => {
        reads.B.resolve({ session: { minimapPinned: true } })
      })

      expect(pinned()).toBe('false')
    })
  })

  describe('the session whose view is read', () => {
    it('is the routed session while its own data has not arrived', async () => {
      mockRoutedSessionId = 'opening-session'
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: null })

      await render(<ChatPanel />)

      expect(mockUseTerminalSplitLayout).toHaveBeenLastCalledWith('opening-session', false)
    })

    it('is none until a workspace is picked', async () => {
      mockWorkspaceId = null

      await render(<ChatPanel />)

      expect(mockUseTerminalSplitLayout).toHaveBeenLastCalledWith(null, false)
    })
  })

  describe('view state across a session switch', () => {
    const threadEvents = name => [
      { type: 'user', is_human: true, content: `${name} inherited question`, turn_id: `${name}-0` },
      {
        type: 'system',
        subtype: 'container_restarted',
        turn_id: `${name}-0`,
        message_data: { fork_parent_session_id: 'source' },
      },
      { type: 'user', is_human: true, content: `${name} own question`, turn_id: `${name}-1` },
    ]

    async function showThread(view, name) {
      mockRoutedSessionId = `thread-${name}`
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: `thread-${name}` })
      mockEventsData = defaultEventsData({ events: threadEvents(name) })
      await act(async () => {
        view.rerender(<ChatPanel />)
      })
    }

    const foldRow = () => screen.getByTestId('thread-fold-row')

    beforeEach(() => {
      mockSessions = [
        { session_id: 'thread-A', is_side_thread: true },
        { session_id: 'thread-B', is_side_thread: true },
      ]
      mockRoutedSessionId = 'thread-A'
      mockSessionDataCtx = defaultSessionDataCtx({ sessionId: 'thread-A' })
      mockEventsData = defaultEventsData({ events: threadEvents('A') })
    })

    it('opens the next thread folded, and the one unfolded folded again on return', async () => {
      const view = await render(<ChatPanel />)
      await userEvent.click(foldRow())
      expect(foldRow()).toHaveAttribute('aria-expanded', 'true')

      await showThread(view, 'B')
      expect(foldRow()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('B inherited question')).not.toBeInTheDocument()

      await showThread(view, 'A')
      expect(foldRow()).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps the fold when the same session is re-attached', async () => {
      const view = await render(<ChatPanel />)
      await userEvent.click(foldRow())

      for (const id of [null, 'thread-A']) {
        mockSessionDataCtx = defaultSessionDataCtx({ sessionId: id })
        await act(async () => {
          view.rerender(<ChatPanel />)
        })
      }

      expect(foldRow()).toHaveAttribute('aria-expanded', 'true')
    })

    it('closes an open reload confirmation on a switch without acting', async () => {
      mockEventsData = defaultEventsData({ events: threadEvents('A'), isResponding: true })
      const view = await render(<ChatPanel />)
      await userEvent.click(screen.getByTestId('mock-reload-btn'))
      expect(screen.getByTestId('mock-confirm-stop-modal')).toBeInTheDocument()

      await showThread(view, 'B')

      expect(screen.queryByTestId('mock-confirm-stop-modal')).not.toBeInTheDocument()
      expect(mockInterrupt).not.toHaveBeenCalled()
      expect(mockSessionDataCtx.reloadSession).not.toHaveBeenCalled()
    })
  })
})

function pendingMessage(content) {
  return {
    showPendingMessages: [{ id: 'p1', content }],
    addPendingMessage: vi.fn(),
    removePendingMessage: vi.fn(),
    sentTurnTimes: {},
  }
}
