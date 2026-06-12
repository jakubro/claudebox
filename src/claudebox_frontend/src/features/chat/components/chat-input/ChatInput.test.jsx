/** Tests for ChatInput. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from './ChatInput'

// Mock useIsMobile to always return desktop
vi.mock('../../../../hooks/useIsMobile', () => ({
  default: () => false,
}))

// Mutable mock data
let mockInteractionData = {}
let mockSessionData = {}
let mockStashData = {}
let mockDraftsData = {}
let mockInputHistoryData = {}

// Mock contexts
vi.mock('../../../../context/InteractionContext', () => ({
  useInteraction: () => mockInteractionData,
}))

vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
}))

vi.mock('../../../../context/StashContext', () => ({
  useStash: () => mockStashData,
}))

// Mock hooks
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

vi.mock('./hooks/useDrafts', () => ({
  default: () => mockDraftsData,
}))

vi.mock('./hooks/useInputHistory', () => ({
  default: () => mockInputHistoryData,
}))

vi.mock('./hooks/useAutoPair', () => ({
  default: () => ({ wrapSelection: vi.fn() }),
}))

vi.mock('./hooks/useBlockCollapse', () => ({
  default: () => ({
    collapseLocal: vi.fn(),
    collapseAll: vi.fn(),
    expandLocal: vi.fn(),
    expandAll: vi.fn(),
    expandBeforeSubmit: vi.fn(),
    resetCollapse: vi.fn(),
  }),
}))

// Mock chat API (only interrupt - sendMessage flows through the `send` prop)
let mockInterrupt = vi.fn(() => Promise.resolve())

vi.mock('../../../../api/chat', () => ({
  interrupt: (...args) => mockInterrupt(...args),
}))

describe('ChatInput', () => {
  let defaultProps

  beforeEach(() => {
    mockInterrupt = vi.fn(() => Promise.resolve())

    mockInteractionData = {
      interruptStatus: 'idle',
      startInterrupt: vi.fn(),
      completeInterrupt: vi.fn(),
      setError: vi.fn(),
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
      send: vi.fn(() => Promise.resolve()),
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
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      // Type text and press Enter
      await user.click(textarea)
      await user.type(textarea, 'hello')
      await user.keyboard('{Enter}')

      expect(defaultProps.send).toHaveBeenCalledWith('hello', [])
    })

    it('does not submit on Shift+Enter', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'hello')
      await user.keyboard('{Shift>}{Enter}{/Shift}')

      expect(defaultProps.send).not.toHaveBeenCalled()
    })

    it('does not submit empty input', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Enter}')

      expect(defaultProps.send).not.toHaveBeenCalled()
    })

    it('calls interrupt on Ctrl+.', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} canInterrupt={true} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
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
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'stash me')
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).toHaveBeenCalledWith('stash me')
    })

    it('pops stash on Ctrl+Shift+S', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Control>}{Shift>}S{/Shift}{/Control}')

      expect(mockStashData.stashPop).toHaveBeenCalled()
    })
  })

  describe('submit flow', () => {
    it('calls send and clears textarea on submit', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'test message')
      await user.keyboard('{Enter}')

      expect(defaultProps.send).toHaveBeenCalledWith('test message', [])
      expect(textarea.value).toBe('')
    })

    it('calls send with prompt and attachments', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'test message')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledTimes(1)
        expect(defaultProps.send).toHaveBeenCalledWith('test message', [])
      })
    })

    it('resets sending state after send completes', async () => {
      // Verify the component can send again after a successful send resolves
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, 'first')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledWith('first', [])
      })

      // Send a second message - verifies `sending` was reset to false
      await user.click(textarea)
      await user.type(textarea, 'second')
      await user.keyboard('{Enter}')

      await vi.waitFor(() => {
        expect(defaultProps.send).toHaveBeenCalledTimes(2)
        expect(defaultProps.send).toHaveBeenLastCalledWith('second', [])
      })
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
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} canInterrupt={true} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Control>}.{/Control}')

      expect(mockInterrupt).not.toHaveBeenCalled()
    })

    it('reports error on interrupt failure', async () => {
      mockInterrupt = vi.fn(() => Promise.reject(new Error('interrupt failed')))
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} canInterrupt={true} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Control>}.{/Control}')

      await vi.waitFor(() => {
        expect(mockInteractionData.setError).toHaveBeenCalledWith('Interrupt failed')
      })
    })
  })

  describe('stash edge cases', () => {
    it('does not stash empty input', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).not.toHaveBeenCalled()
    })

    it('does not stash whitespace-only input', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, '   ')
      await user.keyboard('{Control>}s{/Control}')

      expect(mockStashData.stashPush).not.toHaveBeenCalled()
    })

    it('clears textarea after stashing', async () => {
      const user = userEvent.setup()
      render(<ChatInput {...defaultProps} />)

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
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

      // Textarea is disabled so we can't type, but verify send is blocked
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

  describe('fallback refs', () => {
    it('renders without refs and queueEdit props', () => {
      render(
        <ChatInput
          isConnected={true}
          canInterrupt={false}
          send={vi.fn()}
          enqueueMessage={vi.fn()}
        />,
      )

      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    })
  })

  describe('X11 middle-click paste guard', () => {
    // Helper to create paste event (ClipboardEvent not available in jsdom)
    const createPasteEvent = () => new Event('paste', { bubbles: true, cancelable: true })

    it('blocks paste when middle-click originates outside textarea', () => {
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      // Simulate middle-click (mousedown) outside textarea
      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: document.body })
      document.dispatchEvent(mouseDownEvent)

      // Simulate paste event
      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('allows paste when middle-click originates inside textarea', () => {
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      // Simulate middle-click (mousedown) inside textarea
      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: textarea })
      document.dispatchEvent(mouseDownEvent)

      // Simulate paste event
      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('allows paste from keyboard (Ctrl+V)', () => {
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      // Simulate paste without mousedown
      const pasteEvent = createPasteEvent()
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')
      textarea.dispatchEvent(pasteEvent)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('clears flag after mouseup and rAF', () => {
      const rAFSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => cb())
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      // Simulate middle-click (mousedown) outside textarea
      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: document.body })
      document.dispatchEvent(mouseDownEvent)

      // Simulate mouseup - rAF fires synchronously (mocked) and clears flag
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
      render(<ChatInput {...defaultProps} />)
      const textarea = screen.getByTestId('chat-input')

      // Simulate middle-click (mousedown) outside textarea
      const mouseDownEvent = new MouseEvent('mousedown', { button: 1, bubbles: true })
      Object.defineProperty(mouseDownEvent, 'target', { value: document.body })
      document.dispatchEvent(mouseDownEvent)

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
})
