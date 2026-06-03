/** Tests for ChatPanel component. */

import { act, render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    toggleBookmark: vi.fn(),
  }),
}))

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
  useSessionDir: () => null,
  useSessionId: () => 'test-session-id',
  useSessionActions: () => ({
    reloadSession: mockSessionDataCtx.reloadSession,
  }),
}))

vi.mock('../../context/InteractionContext', () => ({
  useInteraction: () => mockInteractionData,
}))

vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: [], workspaceColor: null, seedSession: vi.fn() }),
}))

vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    navigateToSession: vi.fn(),
  }),
}))

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-workspace',
    workspaces: [{ id: 'test-workspace', path: '/home/user/test-workspace' }],
  }),
}))

vi.mock('../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: null, runtimeName: null }),
}))

vi.mock('../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
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

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    jumpPrevRef: { current: null },
    jumpNextRef: { current: null },
    jumpTopRef: { current: null },
    jumpBottomRef: { current: null },
    chatScrollPositionRef: { current: 0 },
    chatAutoScrollEnabledRef: { current: true },
    markUserIntentRef: { current: null },
    markProgrammaticScrollRef: { current: null },
    focusChatTab: vi.fn(),
    addSessionTab: vi.fn(),
    replaceSessionTab: vi.fn(),
  }),
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
  default: ({ onReload }) => (
    <div data-testid="mock-chat-control-bar">
      <button type="button" data-testid="mock-reload-btn" onClick={onReload}>
        Reload
      </button>
    </div>
  ),
}))

vi.mock('./components/chat-input', () => ({
  default: () => <div data-testid="mock-chat-input" />,
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

let mockDaemonStreamData = { progressMessage: null, sessionsChanged: 0, containerStatus: 0 }
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

// Real Turn, real processEvents — filtering/grouping now in EventsContext

import {
  appendTurns,
  INITIAL_TURN_GROUPING_STATE,
  isVisibleEvent,
} from '../../utils/eventProcessing'

// --- Helpers ---

/**
 * Build turn results map from raw events (same logic that was in ChatPanel).
 */
function buildTurnResults(events) {
  const results = {}
  for (const e of events) {
    if (e.type === 'result' && e.turn_id) {
      results[e.turn_id] = e.subtype
    }
  }
  return results
}

function defaultEventsData(overrides = {}) {
  const events = overrides.events || []
  const visibleEvents = events.filter(isVisibleEvent)
  return {
    events,
    turns: appendTurns([], INITIAL_TURN_GROUPING_STATE, visibleEvents).turns,
    turnResults: buildTurnResults(events),
    taskNotifications: new Map(),
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
    },
    pending: {
      showPendingMessages: [],
      addPendingMessage: vi.fn(),
      removePendingMessage: vi.fn(),
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

describe('ChatPanel', () => {
  beforeEach(() => {
    mockEventsData = defaultEventsData()
    mockSessionDataCtx = defaultSessionDataCtx()
    mockInteractionData = defaultInteractionData()
    mockChatControllerData = defaultChatControllerData()
    mockDaemonStreamData = { progressMessage: null }
    mockInterrupt.mockClear()
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
      // Orphan turn has no user message — verify no message-user div
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
        pending: {
          showPendingMessages: [{ id: 'p1', content: 'Pending message' }],
          addPendingMessage: vi.fn(),
          removePendingMessage: vi.fn(),
        },
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
        pending: {
          showPendingMessages: [{ id: 'p1', content: 'Pending' }],
          addPendingMessage: vi.fn(),
          removePendingMessage: vi.fn(),
        },
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
        pending: {
          showPendingMessages: [{ id: 'p1', content: 'first' }],
          addPendingMessage: vi.fn(),
          removePendingMessage: vi.fn(),
        },
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
  })

  describe('no-container welcome state', () => {
    it('shows welcome message when containerId is null', async () => {
      mockEventsData = defaultEventsData({ containerId: null })

      await render(<ChatPanel />)

      expect(screen.getByTestId('welcome-page')).toBeInTheDocument()
      // ChatInput renders inside the welcome page so users can submit a message
      // immediately to spawn a session.
      expect(screen.getByTestId('mock-chat-input')).toBeInTheDocument()
      // The chat-control-bar (model picker, fork, etc.) only renders for an
      // active session — it must stay hidden on the welcome screen.
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
        pending: {
          showPendingMessages: [{ id: 'p1', content: 'Pending' }],
          addPendingMessage: vi.fn(),
          removePendingMessage: vi.fn(),
        },
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
      const user = userEvent.setup()
      mockEventsData = defaultEventsData({ isResponding: true })

      await render(<ChatPanel />)

      await user.click(screen.getByTestId('mock-reload-btn'))

      expect(mockSessionDataCtx.reloadSession).not.toHaveBeenCalled()
      expect(screen.getByTestId('mock-confirm-stop-modal')).toBeInTheDocument()
    })

    it('interrupts and reloads on confirm', async () => {
      const user = userEvent.setup()
      mockEventsData = defaultEventsData({ isResponding: true })

      await render(<ChatPanel />)

      await user.click(screen.getByTestId('mock-reload-btn'))
      await user.click(screen.getByTestId('mock-confirm-btn'))

      expect(mockInterrupt).toHaveBeenCalledOnce()
      expect(mockSessionDataCtx.reloadSession).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('mock-confirm-stop-modal')).not.toBeInTheDocument()
    })

    it('dismisses modal on cancel without reloading', async () => {
      const user = userEvent.setup()
      mockEventsData = defaultEventsData({ isResponding: true })

      await render(<ChatPanel />)

      await user.click(screen.getByTestId('mock-reload-btn'))
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
        pending: {
          showPendingMessages: [{ id: 'p1', content: 'Sent message' }],
          addPendingMessage: vi.fn(),
          removePendingMessage: vi.fn(),
        },
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
})
