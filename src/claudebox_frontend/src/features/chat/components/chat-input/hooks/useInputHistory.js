/** Input history with Up/Down navigation and draft stack. */

import { useCallback, useEffect, useRef } from 'react'
import useLocalStorage from '../../../../../hooks/useLocalStorage'
import { isHumanEvent } from '../../../../../utils/eventPredicates'
import { parseSlashCommand } from '../../../../../utils/parsers'
import InputHistoryManager from '../InputHistoryManager'

const DEFAULT_HISTORY = [] // audit-ignore: misplaced-constant

/**
 * Persist input history per session with arrow key navigation.
 *
 * Delegates pure navigation logic to InputHistoryManager. This hook owns
 * React state (localStorage, effects) and DOM integration (cursor, resize).
 *
 * @param {string|null} sessionId - Current session ID
 * @param {RefObject} eventsRef - Ref to SSE events array (for fallback init without subscribing)
 * @param {boolean} hasEvents - Stable boolean reactive trigger: flips false→true
 *   when events first arrive per session; allows the bootstrap effect to fire
 *   exactly once without subscribing to per-token events.length churn.
 * @param {RefObject<{current: string, stack: string[]}>} draftsRef - Live ref to
 *   drafts. Mirrors React state on render AND is updated synchronously by the
 *   ChatInput keystroke handler (which bypasses React state for perf). Must be
 *   read via .current on demand — never closed over by value.
 * @param {function} saveDrafts - Function to save drafts
 * @param {RefObject} textareaRef - Ref to textarea element
 * @param {function} resizeTextarea - Function to resize textarea
 * @returns {{ inputHistory, addToHistory, navigateUp, navigateDown, resetIndex, getNavState, updateCurrentItem, prepareSubmit }}
 */
export default function useInputHistory(
  sessionId,
  eventsRef,
  hasEvents,
  draftsRef,
  saveDrafts,
  textareaRef,
  resizeTextarea,
) {
  const [inputHistory, setInputHistory] = useLocalStorage(
    sessionId ? `inputHistory:${sessionId}` : null,
    DEFAULT_HISTORY,
  )

  const managerRef = useRef(null)
  if (!managerRef.current) {
    managerRef.current = new InputHistoryManager()
  }
  const manager = managerRef.current

  const prevSessionIdRef = useRef(null)
  const pendingAdditionsRef = useRef([])
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  // Keep manager in sync with current data. Drafts are read live via ref (not from
  // a render-time snapshot) because ChatInput's persistDraftDirect bypasses React
  // state — the React `drafts` value would lag behind the typed text.
  manager.setHistory(inputHistory)
  manager.setDrafts(draftsRef.current)

  // Reset navigation and apply pending additions on session change
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      manager.resetNavigation()

      if (sessionId && pendingAdditionsRef.current.length > 0) {
        const pending = pendingAdditionsRef.current
        pendingAdditionsRef.current = []
        setInputHistory(prev => [...prev, ...pending])
      }
    }
  }, [sessionId, setInputHistory, manager])

  // Bootstrap from events when localStorage has no history. Re-fires when
  // hasEvents flips false→true (once per session); reads the lazy eventsRef
  // for the actual content so we don't subscribe to per-token churn.
  useEffect(() => {
    if (!sessionId || inputHistory.length > 0 || !hasEvents) {
      return
    }
    const stored = localStorage.getItem(`inputHistory:${sessionId}`)
    if (stored) {
      return
    }
    const currentEvents = eventsRef?.current ?? []
    const fromEvents = currentEvents.filter(isHumanEvent).map(e => {
      const parsed = parseSlashCommand(e.content)
      if (parsed) {
        return parsed.args ? `${parsed.cmd} ${parsed.args}` : parsed.cmd
      }
      return e.content
    })
    if (fromEvents.length > 0) {
      setInputHistory(fromEvents)
    }
  }, [sessionId, eventsRef, hasEvents, inputHistory.length, setInputHistory])

  // Sync recent additions with actual state
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputHistory triggers sync of manager's recent additions
  useEffect(() => {
    manager.syncRecentAdditions()
  }, [inputHistory, manager])

  const addToHistory = useCallback(
    content => {
      if (!content.trim()) {
        return
      }
      manager.addRecentAddition(content)
      if (!sessionIdRef.current) {
        pendingAdditionsRef.current.push(content)
      } else {
        setInputHistory(prev => [...prev, content])
      }
    },
    [setInputHistory, manager],
  )

  const resetIndex = useCallback(() => {
    manager.resetNavigation()
  }, [manager])

  const getNavState = useCallback(() => manager.navState, [manager])

  const navigateUp = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return false
    }
    // Refresh manager's draft snapshot with the latest direct-write value.
    manager.setDrafts(draftsRef.current)
    const cursorAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0
    const result = manager.navigateUp(cursorAtStart)
    if (result.handled && result.value !== null) {
      textarea.value = result.value
      resizeTextarea()
      textarea.selectionStart = 0
      textarea.selectionEnd = 0
    }
    return result.handled
  }, [textareaRef, resizeTextarea, draftsRef, manager])

  const navigateDown = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return false
    }
    // Refresh manager's draft snapshot with the latest direct-write value before
    // navigation logic consults _drafts.current / _drafts.stack.
    manager.setDrafts(draftsRef.current)
    const cursorAtEnd = textarea.selectionStart === textarea.value.length
    const result = manager.navigateDown(cursorAtEnd, textarea.value)
    if (result.pushToStack) {
      const stack = draftsRef.current.stack || []
      saveDrafts({ current: '', stack: [...stack, result.pushToStack] })
    }
    if (result.handled && result.value !== null) {
      textarea.value = result.value
      resizeTextarea()
      textarea.selectionStart = textarea.value.length
      textarea.selectionEnd = textarea.value.length
    }
    return result.handled
  }, [textareaRef, resizeTextarea, draftsRef, saveDrafts, manager])

  const updateCurrentItem = useCallback(
    newValue => {
      const target = manager.updateCurrentItem(newValue)
      if (!target) {
        return
      }
      if (target.source === 'draft') {
        const stack = draftsRef.current.stack || []
        const newStack = [...stack]
        newStack[target.realIndex] = newValue
        saveDrafts({ current: '', stack: newStack })
      } else if (target.source === 'history') {
        setInputHistory(prev => {
          const newHistory = [...prev]
          newHistory[target.realIndex] = newValue
          return newHistory
        })
      }
    },
    [draftsRef, saveDrafts, setInputHistory, manager],
  )

  const prepareSubmit = useCallback(
    content => {
      // Refresh draft snapshot — prepareSubmit reads stack to compute newStack.
      manager.setDrafts(draftsRef.current)
      const result = manager.prepareSubmit(content)
      saveDrafts({ current: '', stack: result.newStack })
      addToHistory(content)
      return { content: result.content, fromDraft: result.fromDraft, draftIndex: result.draftIndex }
    },
    [draftsRef, saveDrafts, addToHistory, manager],
  )

  return {
    inputHistory,
    addToHistory,
    navigateUp,
    navigateDown,
    resetIndex,
    getNavState,
    updateCurrentItem,
    prepareSubmit,
  }
}
