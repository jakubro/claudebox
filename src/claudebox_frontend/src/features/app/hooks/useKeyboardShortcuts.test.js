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
  let rightColumnPrevRef
  let rightColumnNextRef
  let railPrevRef
  let railNextRef

  beforeEach(() => {
    handleTogglePanel = vi.fn()
    focusChatTab = vi.fn()
    setShowHelpOverlay = vi.fn()
    jumpPrevRef = { current: vi.fn() }
    jumpNextRef = { current: vi.fn() }
    jumpTopRef = { current: vi.fn() }
    jumpBottomRef = { current: vi.fn() }
    rightColumnPrevRef = { current: vi.fn() }
    rightColumnNextRef = { current: vi.fn() }
    railPrevRef = { current: vi.fn() }
    railNextRef = { current: vi.fn() }
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
      rightColumnPrevRef,
      rightColumnNextRef,
      railPrevRef,
      railNextRef,
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

  describe('right split slot navigation', () => {
    it('Alt+PageUp calls rightColumnPrevRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('PageUp', { altKey: true })
      expect(rightColumnPrevRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+PageDown calls rightColumnNextRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('PageDown', { altKey: true })
      expect(rightColumnNextRef.current).toHaveBeenCalledOnce()
    })

    it('is a no-op, not a throw, when the slot has no occupant (ref is null)', () => {
      renderHook(() =>
        useKeyboardShortcuts(
          createProps({
            rightColumnPrevRef: { current: null },
            rightColumnNextRef: { current: null },
          }),
        ),
      )
      expect(() => fireKey('PageUp', { altKey: true })).not.toThrow()
      expect(() => fireKey('PageDown', { altKey: true })).not.toThrow()
    })

    it('Alt+PageUp/PageDown never invoke the transcript jump refs', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('PageUp', { altKey: true })
      fireKey('PageDown', { altKey: true })
      expect(jumpPrevRef.current).not.toHaveBeenCalled()
      expect(jumpNextRef.current).not.toHaveBeenCalled()
      expect(jumpTopRef.current).not.toHaveBeenCalled()
      expect(jumpBottomRef.current).not.toHaveBeenCalled()
    })

    it('Alt+Up/Down/Home/End never invoke the right-column refs', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowUp', { altKey: true })
      fireKey('ArrowDown', { altKey: true })
      fireKey('Home', { altKey: true })
      fireKey('End', { altKey: true })
      expect(rightColumnPrevRef.current).not.toHaveBeenCalled()
      expect(rightColumnNextRef.current).not.toHaveBeenCalled()
    })
  })

  describe('session rail focus navigation', () => {
    it('Alt+Shift+Left calls railPrevRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowLeft', { altKey: true, shiftKey: true })
      expect(railPrevRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+Shift+Right calls railNextRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowRight', { altKey: true, shiftKey: true })
      expect(railNextRef.current).toHaveBeenCalledOnce()
    })

    it('is a no-op, not a throw, when the rail has one group (ref is null)', () => {
      renderHook(() =>
        useKeyboardShortcuts(
          createProps({ railPrevRef: { current: null }, railNextRef: { current: null } }),
        ),
      )
      expect(() => fireKey('ArrowLeft', { altKey: true, shiftKey: true })).not.toThrow()
      expect(() => fireKey('ArrowRight', { altKey: true, shiftKey: true })).not.toThrow()
    })

    it('plain Alt+Left/Right (no Shift) never invoke the rail refs - Alt+Left stays unbound', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowLeft', { altKey: true })
      fireKey('ArrowRight', { altKey: true })
      expect(railPrevRef.current).not.toHaveBeenCalled()
      expect(railNextRef.current).not.toHaveBeenCalled()
    })

    it('Alt+Shift+Left/Right never invoke the transcript jump refs', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowLeft', { altKey: true, shiftKey: true })
      fireKey('ArrowRight', { altKey: true, shiftKey: true })
      expect(jumpPrevRef.current).not.toHaveBeenCalled()
      expect(jumpNextRef.current).not.toHaveBeenCalled()
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

  describe('Alt+jump key routing (engagement-state transitions live on the jump callbacks)', () => {
    it('Alt+Up invokes jumpPrevRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowUp', { altKey: true })
      expect(jumpPrevRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+Down invokes jumpNextRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('ArrowDown', { altKey: true })
      expect(jumpNextRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+Home invokes jumpTopRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('Home', { altKey: true })
      expect(jumpTopRef.current).toHaveBeenCalledOnce()
    })

    it('Alt+End invokes jumpBottomRef', () => {
      renderHook(() => useKeyboardShortcuts(createProps()))
      fireKey('End', { altKey: true })
      expect(jumpBottomRef.current).toHaveBeenCalledOnce()
    })
  })

  describe('shortcut readiness marker', () => {
    it('is absent until a listener is attached', () => {
      expect(document.body.dataset.shortcutsReady).toBeUndefined()

      renderHook(() => useKeyboardShortcuts(createProps()))

      expect(document.body.dataset.shortcutsReady).toBe('true')
    })

    it('stays marked across re-subscription', () => {
      // The effect re-subscribes on every render, so the marker is written and deleted repeatedly.
      // It must read as continuously present - a waiter catching it off would think the shortcut is dead.
      const { rerender } = renderHook(() => useKeyboardShortcuts(createProps()))

      expect(document.body.dataset.shortcutsReady).toBe('true')

      rerender()
      expect(document.body.dataset.shortcutsReady).toBe('true')

      rerender()
      fireKey('0', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('logs')
      expect(document.body.dataset.shortcutsReady).toBe('true')
    })

    it('marks readiness only while shortcuts actually fire', () => {
      const { unmount } = renderHook(() => useKeyboardShortcuts(createProps()))

      // Present and the shortcut works.
      expect(document.body.dataset.shortcutsReady).toBe('true')
      fireKey('0', { altKey: true })
      expect(handleTogglePanel).toHaveBeenCalledWith('logs')

      unmount()

      // Gone, and the shortcut no longer fires - a waiter on the marker can never be satisfied
      // by a detached listener.
      expect(document.body.dataset.shortcutsReady).toBeUndefined()
      handleTogglePanel.mockClear()
      fireKey('0', { altKey: true })
      expect(handleTogglePanel).not.toHaveBeenCalled()
    })
  })
})
