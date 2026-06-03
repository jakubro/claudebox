/** Tests for useKeyboardShortcuts hook. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useKeyboardShortcuts from './useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  let handleTogglePanel
  let focusChatTab
  let setShowHelpOverlay
  let jumpPrevRef
  let jumpNextRef
  let jumpTopRef
  let jumpBottomRef

  beforeEach(() => {
    handleTogglePanel = vi.fn()
    focusChatTab = vi.fn()
    setShowHelpOverlay = vi.fn()
    jumpPrevRef = { current: vi.fn() }
    jumpNextRef = { current: vi.fn() }
    jumpTopRef = { current: vi.fn() }
    jumpBottomRef = { current: vi.fn() }
  })

  function createProps(overrides = {}) {
    return {
      handleTogglePanel,
      focusChatTab,
      showHelpOverlay: false,
      setShowHelpOverlay,
      jumpPrevRef,
      jumpNextRef,
      jumpTopRef,
      jumpBottomRef,
      ...overrides,
    }
  }

  function fireKey(key, opts = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...opts })
    window.dispatchEvent(event)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Alt+number panel toggles', () => {
    it('Alt+0 toggles logs panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('0', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('logs')
    })

    it('Alt+1 toggles sessions panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('1', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('sessions')
    })

    it('Alt+2 toggles todos panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('2', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('todos')
    })

    it('Alt+3 toggles stash panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('3', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('stash')
    })

    it('Alt+4 toggles tasks panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('4', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('tasks')
    })

    it('Alt+5 toggles bookmarks panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('5', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('bookmarks')
    })

    it('Alt+6 toggles boards panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('6', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('boards')
    })

    it('Alt+8 toggles mcp panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('8', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('mcp')
    })

    it('Alt+9 toggles commands panel', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('9', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('commands')
    })
  })

  describe('Alt+C focuses chat', () => {
    it('calls focusChatTab on Alt+c', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('c', { altKey: true })
      expect(focusChatTab).toHaveBeenCalledOnce()
    })

    it('calls focusChatTab on Alt+C (uppercase)', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('C', { altKey: true })
      expect(focusChatTab).toHaveBeenCalledOnce()
    })
  })

  describe('Alt+/ toggles help overlay', () => {
    it('calls setShowHelpOverlay on Alt+/', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('/', { altKey: true })
      expect(setShowHelpOverlay).toHaveBeenCalledOnce()
    })
  })

  describe('message navigation', () => {
    it('Alt+ArrowUp calls jumpPrevRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowUp', { altKey: true })
      expect(jumpPrevRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+ArrowDown calls jumpNextRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowDown', { altKey: true })
      expect(jumpNextRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+Home calls jumpTopRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('Home', { altKey: true })
      expect(jumpTopRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+End calls jumpBottomRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('End', { altKey: true })
      expect(jumpBottomRef.current).toHaveBeenCalledOnce()
    })
  })

  describe('Escape', () => {
    it('closes help overlay when visible', () => {
      renderHook(() => useKeyboardShortcuts(createProps({ showHelpOverlay: true })))
      fireKey('Escape')
      expect(setShowHelpOverlay).toHaveBeenCalledWith(false)
    })

    it('does nothing when help overlay not visible', () => {
      renderHook(() => useKeyboardShortcuts(createProps({ showHelpOverlay: false })))
      fireKey('Escape')
      expect(setShowHelpOverlay).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('removes listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() => useKeyboardShortcuts(createProps()))
      unmount()
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })

  describe('non-Alt keys are ignored', () => {
    it('does not toggle panel on bare number key', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('1')
      expect(handleTogglePanel).not.toHaveBeenCalled()
    })
  })
})
