/** Tests for ChatInput. */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from './ChatInput'

let mockIsMobile = false
vi.mock('../../../../hooks/useIsMobile', () => ({
  default: () => mockIsMobile,
}))

let mockInteractionData = {}
let mockSessionData = {}
let mockStashData = {}
let mockDraftsData = {}
let mockInputHistoryData = {}

vi.mock('../../../../context/InteractionContext', () => ({
  useInteraction: () => mockInteractionData,
}))

vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
}))

vi.mock('../../../../context/StashContext', () => ({
  useStash: () => mockStashData,
}))

let mockOwnership = {}
vi.mock('../../../../hooks/useSessionOwnership', () => ({
  default: () => mockOwnership,
}))

vi.mock('./hooks/useAutocomplete', () => ({
  default: vi.fn(() => ({
    visible: false,
    items: [],
    selectedIndex: 0,
    filter: '',
    select: vi.fn(),
    dismiss: vi.fn(),
    handleKeyDown: vi.fn(() => false),
  })),
}))

vi.mock('./hooks/useTextareaResize', () => ({
  default: () => ({ resizeTextarea: vi.fn() }),
}))

let useRealDrafts = false
vi.mock('./hooks/useDrafts', async importOriginal => {
  const actual = await importOriginal()
  return { default: (...args) => (useRealDrafts ? actual.default(...args) : mockDraftsData) }
})

vi.mock('./hooks/useInputHistory', () => ({
  default: () => mockInputHistoryData,
}))

vi.mock('./hooks/useBlockCollapse', () => ({
  default: () => ({
    expandBeforeSubmit: vi.fn(),
    resetCollapse: vi.fn(),
    manager: {
      collapseLocal: vi.fn(),
      collapseAll: vi.fn(),
      expandLocal: vi.fn(),
      expandAll: vi.fn(),
    },
  }),
}))

// Mock chat API (only interrupt - sendMessage flows through the `send` prop)
let mockInterrupt = vi.fn(() => Promise.resolve())

vi.mock('../../../../api/chat', () => ({
  interrupt: (...args) => mockInterrupt(...args),
}))

describe('ChatInput', () => {
  let defaultProps

  async function focusChatInput(props = {}) {
    const user = userEvent.setup()
    render(<ChatInput {...defaultProps} {...props} />)
    const textarea = screen.getByTestId('chat-input')
    await user.click(textarea)

    return { user, textarea }
  }

  beforeEach(() => {
    mockInterrupt = vi.fn(() => Promise.resolve())
    useRealDrafts = false
    mockOwnership = ownershipOf('test-session')

    mockInteractionData = {
      interruptStatus: 'idle',
      startInterrupt: vi.fn(),
      completeInterrupt: vi.fn(),
      setError: vi.fn(),
      showHint: vi.fn(),
    }

    mockSessionData = {
      sessionId: 'test-session',
      commands: [],
    }

    mockStashData = {
      stashPush: vi.fn(),
      stashPop: vi.fn(),
      pendingInsert: null,
      clearPendingInsert: vi.fn(),
    }

    mockDraftsData = {
      drafts: { current: '', stack: [] },
      saveDrafts: vi.fn(),
      userHasTypedRef: { current: false },
    }

    mockInputHistoryData = {
      addToHistory: vi.fn(),
      navigateUp: vi.fn(() => false),
      navigateDown: vi.fn(() => false),
      resetIndex: vi.fn(),
      getNavState: vi.fn(() => ({ source: null })),
      updateCurrentItem: vi.fn(),
      prepareSubmit: vi.fn(),
    }

    defaultProps = {
      isConnected: true,
      canInterrupt: false,
      refs: {
        panel: { current: document.createElement('div') },
        messages: { current: document.createElement('div') },
        autoScrollEnabled: { current: true },
        events: { current: [] },
      },
      send: vi.fn(() => Promise.resolve(true)),
      enqueueMessage: vi.fn(),
      deferSend: vi.fn(),
      queueEdit: { item: null, clear: vi.fn() },
    }
  })

  it('renders a textarea', () => {
    render(<ChatInput {...defaultProps} />)

    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })

  it('keeps textarea enabled when not connected (always-enabled invariant)', () => {
    render(<ChatInput {...defaultProps} isConnected={false} />)

    expect(screen.getByTestId('chat-input')).not.toBeDisabled()
  })

  it('keeps textarea enabled when connected', () => {
    render(<ChatInput {...defaultProps} isConnected={true} />)

    expect(screen.getByTestId('chat-input')).not.toBeDisabled()
  })

  describe('keyboard shortcuts', () => {
    it('submits on Enter', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'hello')
      await user.keyboard('{Enter}')

      expect(defaultProps.send).toHaveBeenCalledWith('hello', { attachments: [] })
    })

    it('does not submit on Shift+Enter', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'hello')
      await user.keyboard('{Shift>}{Enter}{/Shift}')

      expect(defaultProps.send).not.toHaveBeenCalled()
    })

    it('does not submit empty input', async () => {
      const { user } = await focusChatInput()
      await user.keyboard('{Enter}')

      expect(defaultProps.send).not.toHaveBeenCalled()
    })

    it('calls interrupt on Ctrl+.', async () => {
      const { user } = await focusChatInput({ canInterrupt: true })
      await user.keyboard('{Control>}.{/Control}')

      expect(mockInterrupt).toHaveBeenCalled()
    })

    it('does not interrupt when canInterrupt is false', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} canInterrupt={false} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Control>}.{/Control}')

      expect(mockInterrupt).not.toHaveBeenCalled()
    })

    it('stashes input on Ctrl+S', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'stash me')
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).toHaveBeenCalledWith('stash me')
    })

    it('pops stash on Ctrl+Shift+S', async () => {
      const { user } = await focusChatInput()
      await user.keyboard('{Control>}{Shift>}S{/Shift}{/Control}')

      expect(mockStashData.stashPop).toHaveBeenCalled()
    })
  })

  describe('submit flow', () => {
    it('calls send and clears textarea on submit', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'test message')
      await user.keyboard('{Enter}')

      expect(defaultProps.send).toHaveBeenCalledWith('test message', { attachments: [] })
      expect(textarea.value).toBe('')
    })

    it('calls send with prompt and attachments', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'test message')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledTimes(1)
        expect(defaultProps.send).toHaveBeenCalledWith('test message', { attachments: [] })
      })
    })

    it('resets sending state after send completes', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'first')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledWith('first', { attachments: [] })
      })

      // Send a second message - verifies `sending` was reset to false
      await user.click(textarea)
      await user.type(textarea, 'second')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledTimes(2)
        expect(defaultProps.send).toHaveBeenLastCalledWith('second', { attachments: [] })
      })
    })

    it('Enter twice with only replies buffered sends once', async () => {
      const user = userEvent.setup()
      let release
      defaultProps.send = vi.fn(() => new Promise(resolve => (release = resolve)))
      render(<ChatInput {...defaultProps} hasBufferedReplies={() => true} />)

      await user.click(screen.getByTestId('chat-input'))
      await user.keyboard('{Enter}')
      await user.keyboard('{Enter}')
      release(true)

      await vi.waitFor(() => expect(defaultProps.send).toHaveBeenCalledTimes(1))
      expect(defaultProps.send).toHaveBeenCalledWith('', { attachments: [] })
    })

    it('Enter again while the message is on its way sends nothing', async () => {
      const user = userEvent.setup()
      let release
      defaultProps.send = vi.fn(() => new Promise(resolve => (release = resolve)))
      render(<ChatInput {...defaultProps} hasBufferedReplies={() => true} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'see below')
      await user.keyboard('{Enter}')
      await user.keyboard('{Enter}')
      release(true)

      await vi.waitFor(() => expect(textarea.value).toBe(''))
      expect(defaultProps.send).toHaveBeenCalledTimes(1)
      expect(defaultProps.send).toHaveBeenCalledWith('see below', { attachments: [] })
    })

    it('keeps text typed while the message was on its way', async () => {
      let release
      defaultProps.send = vi.fn(() => new Promise(resolve => (release = resolve)))
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'first')
      await user.keyboard('{Enter}')
      await user.clear(textarea)
      await user.type(textarea, 'notes')
      await act(async () => release(true))

      expect(textarea.value).toBe('notes')
      expect(mockInputHistoryData.prepareSubmit).toHaveBeenCalledWith('first', 'notes')
    })

    it('sends text entered while the message was on its way right after it', async () => {
      const releases = []
      defaultProps.send = vi.fn(() => new Promise(resolve => releases.push(resolve)))
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'first')
      await user.keyboard('{Enter}')
      await user.clear(textarea)
      await user.type(textarea, 'second')
      await user.keyboard('{Enter}')
      expect(defaultProps.send).toHaveBeenCalledTimes(1)

      await act(async () => releases[0](true))
      await vi.waitFor(() => expect(defaultProps.send).toHaveBeenCalledTimes(2))
      expect(defaultProps.send).toHaveBeenLastCalledWith('second', { attachments: [] })
      await act(async () => releases[1](true))

      expect(textarea.value).toBe('')
    })

    it('leaves the text in the box when send fails', async () => {
      defaultProps.send = vi.fn(() => Promise.resolve(false))
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'will not send')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledWith('will not send', { attachments: [] })
      })
      expect(textarea.value).toBe('will not send')
    })
  })

  describe('pending insert', () => {
    it('inserts pending text into textarea', () => {
      mockStashData.pendingInsert = 'inserted text'
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      expect(textarea.value).toBe('inserted text')
      expect(mockStashData.clearPendingInsert).toHaveBeenCalled()
    })

    it('resets history index after inserting', () => {
      mockStashData.pendingInsert = 'inserted text'
      render(<ChatInput {...defaultProps} />)

      expect(mockInputHistoryData.resetIndex).toHaveBeenCalled()
    })

    it('saves drafts with inserted text', () => {
      mockStashData.pendingInsert = 'inserted text'
      render(<ChatInput {...defaultProps} />)

      expect(mockDraftsData.saveDrafts).toHaveBeenCalledWith({
        current: 'inserted text',
        stack: [],
      })
    })
  })

  describe('interrupt edge cases', () => {
    it('does not interrupt when already stopping', async () => {
      mockInteractionData.interruptStatus = 'stopping'
      const { user } = await focusChatInput({ canInterrupt: true })
      await user.keyboard('{Control>}.{/Control}')

      expect(mockInterrupt).not.toHaveBeenCalled()
    })

    it('reports error on interrupt failure', async () => {
      mockInterrupt = vi.fn(() => Promise.reject(new Error('interrupt failed')))
      const { user } = await focusChatInput({ canInterrupt: true })
      await user.keyboard('{Control>}.{/Control}')

      await vi.waitFor(() => {
        expect(mockInteractionData.setError).toHaveBeenCalledWith('Interrupt failed')
      })
    })
  })

  describe('stash edge cases', () => {
    it('does not stash empty input', async () => {
      const { user } = await focusChatInput()
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).not.toHaveBeenCalled()
    })

    it('does not stash whitespace-only input', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, '   ')
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).not.toHaveBeenCalled()
    })

    it('clears textarea after stashing', async () => {
      const { user, textarea } = await focusChatInput()
      await user.type(textarea, 'stash me')
      await user.keyboard('{Control>}s{/Control}')

      expect(textarea.value).toBe('')
    })
  })

  describe('overlay mode', () => {
    it('keeps textarea enabled in resuming mode (submit no-ops until replay completes)', () => {
      render(<ChatInput {...defaultProps} overlayMode="resuming" />)

      expect(screen.getByTestId('chat-input')).not.toBeDisabled()
    })

    it('keeps textarea editable in creating mode despite disconnected', () => {
      render(<ChatInput {...defaultProps} isConnected={false} overlayMode="creating" />)

      expect(screen.getByTestId('chat-input')).not.toBeDisabled()
    })

    it('defers message during creating overlay instead of sending', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} overlayMode="creating" />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'pre-composed')
      await user.keyboard('{Enter}')

      expect(defaultProps.send).not.toHaveBeenCalled()
      expect(defaultProps.deferSend).toHaveBeenCalledWith('pre-composed', [])
      // Text should be cleared (queued successfully)
      expect(textarea.value).toBe('')
    })

    it('blocks send during resuming overlay', () => {
      render(<ChatInput {...defaultProps} overlayMode="resuming" />)

      // Textarea stays enabled (always-enabled invariant); isSendBlocked suppresses send instead.
      expect(defaultProps.send).not.toHaveBeenCalled()
    })
  })

  describe('focus management', () => {
    it('focuses textarea on initial render when connected', () => {
      render(<ChatInput {...defaultProps} isConnected={true} />)

      expect(screen.getByTestId('chat-input')).toHaveFocus()
    })

    it('focuses textarea on initial render even when disconnected (always-focused invariant)', () => {
      render(<ChatInput {...defaultProps} isConnected={false} />)

      expect(screen.getByTestId('chat-input')).toHaveFocus()
    })
  })

  describe('X11 middle-click paste guard', () => {
    // Helper to create paste event (ClipboardEvent not available in jsdom)
    const createPasteEvent = () => new Event('paste', { bubbles: true, cancelable: true })

    function renderAfterOutsideMiddleClick() {
      render(<ChatInput {...defaultProps} />)
      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: document.body })
      document.dispatchEvent(mouseDownEvent)

      return screen.getByTestId('chat-input')
    }

    it('blocks paste when middle-click originates outside textarea', () => {
      const textarea = renderAfterOutsideMiddleClick()

      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('allows paste when middle-click originates inside textarea', () => {
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: textarea })
      document.dispatchEvent(mouseDownEvent)

      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('allows paste from keyboard (Ctrl+V)', () => {
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('clears flag after mouseup and rAF', () => {
      const rAFSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => cb())
      const textarea = renderAfterOutsideMiddleClick()

      // rAF fires synchronously (mocked) and clears the flag
      const mouseUpEvent = new MouseEvent('mouseup', { button: 1, bubbles: true })
      document.dispatchEvent(mouseUpEvent)

      // Paste after flag cleared should go through
      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
      rAFSpy.mockRestore()
    })

    it('blocks paste on held middle-click (>100ms hold)', () => {
      vi.useFakeTimers()
      const textarea = renderAfterOutsideMiddleClick()

      // Hold for 200ms - no mouseup yet, flag should persist
      vi.advanceTimersByTime(200)

      // Paste fires while still holding - should be blocked
      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('what the box holds belongs to the session on screen', () => {
    beforeEach(() => {
      useRealDrafts = true
      localStorage.clear()
      sessionStorage.clear()
    })

    function renderFor({ attached, owner, pending = false }) {
      mockSessionData = { ...mockSessionData, sessionId: attached }
      mockOwnership = { ...ownershipOf(owner), isOwnerAttached: !pending && owner === attached }
      // A fresh refs object re-renders the memoised composer, as a context change would in the app.
      return (
        <ChatInput
          {...defaultProps}
          refs={{ ...defaultProps.refs }}
          overlayMode={pending ? 'resuming' : null}
        />
      )
    }

    it("keeps text typed while B opens as B's draft, leaving A's untouched", async () => {
      localStorage.setItem('draft:A', JSON.stringify({ current: 'draft of A', stack: [] }))
      const { rerender } = render(renderFor({ attached: 'A', owner: 'A' }))

      rerender(renderFor({ attached: 'A', owner: 'B', pending: true }))
      await userEvent.type(screen.getByRole('textbox'), 'typed while B opens')
      rerender(renderFor({ attached: 'B', owner: 'B' }))

      expect(screen.getByRole('textbox')).toHaveValue('typed while B opens')
      expect(JSON.parse(localStorage.getItem('draft:B')).current).toBe('typed while B opens')
      expect(JSON.parse(localStorage.getItem('draft:A')).current).toBe('draft of A')
    })

    it("shows A's own draft on returning to A", async () => {
      localStorage.setItem('draft:A', JSON.stringify({ current: 'draft of A', stack: [] }))
      const { rerender } = render(renderFor({ attached: 'B', owner: 'B' }))

      rerender(renderFor({ attached: 'A', owner: 'A' }))

      await vi.waitFor(() => {
        expect(screen.getByRole('textbox')).toHaveValue('draft of A')
      })
    })

    it('restores preserved input only into the session it was typed in', () => {
      sessionStorage.setItem(
        '_cb_preserved_input',
        JSON.stringify({ owner: { sessionId: 'A' }, content: 'message for A' }),
      )
      const { rerender } = render(renderFor({ attached: 'B', owner: 'B' }))
      expect(screen.getByRole('textbox')).toHaveValue('')

      rerender(renderFor({ attached: 'A', owner: 'A' }))
      expect(screen.getByRole('textbox')).toHaveValue('message for A')
    })

    it.each([
      ['Enter', '{Enter}'],
      ['Alt+Enter', '{Alt>}{Enter}{/Alt}'],
    ])('a blocked %s shows the loading hint and keeps the text', async (_name, keys) => {
      render(
        <ChatInput
          {...renderFor({ attached: 'A', owner: 'B', pending: true }).props}
          hasBufferedReplies={() => true}
        />,
      )
      const box = screen.getByRole('textbox')
      await userEvent.type(box, 'for B')

      await userEvent.type(box, keys)

      expect(mockInteractionData.showHint).toHaveBeenCalledWith('Wait for the session to load')
      expect(defaultProps.send).not.toHaveBeenCalled()
      expect(defaultProps.enqueueMessage).not.toHaveBeenCalled()
      expect(box).toHaveValue('for B')
    })
  })
  describe('input handed back by a failed creation', () => {
    function renderWithHandle() {
      const handle = { current: null }
      render(
        <ChatInput {...defaultProps} refs={{ ...defaultProps.refs, composerHandle: handle }} />,
      )
      return handle
    }

    it('follows the saved draft the empty box would restore', () => {
      mockDraftsData.drafts = { current: 'draft A', stack: [] }
      const handle = renderWithHandle()

      act(() => {
        handle.current.returnInput({ rawPrompt: 'first', currentAttachments: [] })
      })

      expect(screen.getByRole('textbox')).toHaveValue('draft A\n\nfirst')
      expect(mockDraftsData.saveDrafts).toHaveBeenCalledWith({
        current: 'draft A\n\nfirst',
        stack: [],
      })
    })

    it('comes before what was typed since', async () => {
      // Typed while the creation owned the box, then the session left owns it again.
      mockOwnership = { ...ownershipOf(null), ownerNow: () => ({ creation: 1 }) }
      const handle = { current: null }
      const refs = { ...defaultProps.refs, composerHandle: handle }
      const { rerender } = render(<ChatInput {...defaultProps} refs={refs} />)
      await userEvent.type(screen.getByRole('textbox'), 'typed since')
      mockOwnership = ownershipOf('test-session')
      mockDraftsData = { ...mockDraftsData, drafts: { current: '', stack: [] } }
      rerender(<ChatInput {...defaultProps} refs={{ ...refs }} />)

      act(() => {
        handle.current.returnInput({ rawPrompt: 'first', currentAttachments: [] })
      })

      expect(screen.getByRole('textbox')).toHaveValue('first\n\ntyped since')
    })
  })

  it('focus() on the handle leaves focus alone on mobile', () => {
    mockIsMobile = true
    const handle = { current: null }
    render(<ChatInput {...defaultProps} refs={{ ...defaultProps.refs, composerHandle: handle }} />)

    act(() => handle.current.focus())

    expect(document.activeElement).not.toBe(screen.getByRole('textbox'))
    mockIsMobile = false
  })

  it('focus() on the handle puts the cursor back where it was', async () => {
    const handle = { current: null }
    render(<ChatInput {...defaultProps} refs={{ ...defaultProps.refs, composerHandle: handle }} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'draft text')
    box.setSelectionRange(5, 5)
    box.blur()

    act(() => handle.current.focus())

    expect(document.activeElement).toBe(box)
    expect([box.selectionStart, box.selectionEnd]).toEqual([5, 5])
  })

  it('keeps the text on Alt+Enter where nothing can be queued (the welcome screen)', async () => {
    render(<ChatInput {...defaultProps} enqueueMessage={null} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello')

    await userEvent.type(box, '{Alt>}{Enter}{/Alt}')

    expect(box).toHaveValue('hello')
  })
})

function ownershipOf(sessionId) {
  return {
    ownerSessionId: sessionId,
    isOwnerAttached: true,
    ownerNow: () => ({ sessionId }),
    resolveOwner: tag => tag?.sessionId ?? null,
    isRoutedOwner: () => true,
  }
}
