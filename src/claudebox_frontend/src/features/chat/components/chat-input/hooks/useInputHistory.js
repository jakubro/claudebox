/** Input history with Up/Down navigation and draft stack. */

import { useCallback, useEffect, useRef } from 'react'
import { INPUT_HISTORY_STORAGE_PREFIX } from '../../../../../config/storage'
import {
  MAX_INPUT_HISTORY_BYTES,
  MAX_INPUT_HISTORY_ENTRIES,
} from '../../../../../config/thresholds'
import useLocalStorage from '../../../../../hooks/useLocalStorage'
import { isHumanEvent } from '../../../../../utils/eventPredicates'
import { parseSlashCommand } from '../../../../../utils/parsers'
import InputHistoryManager from '../InputHistoryManager'
import { capHistory } from '../utils/inputHistoryCap'

const DEFAULT_HISTORY = [] // audit-ignore: misplaced-constant
const HISTORY_LIMITS = { maxEntries: MAX_INPUT_HISTORY_ENTRIES, maxBytes: MAX_INPUT_HISTORY_BYTES }

/**
 * Delegates pure navigation logic to InputHistoryManager. This hook owns React state
 * (localStorage, effects) and DOM integration (cursor, resize).
 *
 * @param {string|null} sessionId - Current session ID.
 * @param {RefObject} eventsRef - Ref to the SSE events array (fallback init without subscribing).
 * @param {boolean} hasEvents - Stable trigger: flips false->true once per session so the bootstrap
 *   effect fires exactly once, without subscribing to per-token events.length churn.
 * @param {RefObject<{current: string, stack: string[]}>} draftsRef - Live ref to drafts; mirrors
 *   React state on render but is also written synchronously by ChatInput's keystroke handler
 *   (bypassing React state for perf) - must be read via `.current`, never closed over by value.
 * @param {function} saveDrafts - Saves drafts.
 * @param {RefObject} textareaRef - Ref to the textarea element.
 * @param {function} resizeTextarea - Resizes the textarea.
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
    sessionId ? `${INPUT_HISTORY_STORAGE_PREFIX}${sessionId}` : null,
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

  // Keeps manager in sync; drafts are read live via ref (not a render snapshot) because ChatInput's
  // persistDraftDirect bypasses React state, so `drafts` would otherwise lag behind the typed text.
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
        setInputHistory(prev => capHistory([...prev, ...pending], HISTORY_LIMITS))
      }
    }
  }, [sessionId, setInputHistory, manager])

  // Bootstraps from events when localStorage has no history; re-fires when hasEvents flips
  // false->true once per session, reading the lazy eventsRef to avoid per-token churn.
  useEffect(() => {
    if (!sessionId || inputHistory.length > 0 || !hasEvents) {
      return
    }
    const stored = localStorage.getItem(`${INPUT_HISTORY_STORAGE_PREFIX}${sessionId}`)
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
      setInputHistory(capHistory(fromEvents, HISTORY_LIMITS))
    }
  }, [sessionId, eventsRef, hasEvents, inputHistory.length, setInputHistory])

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
        setInputHistory(prev => capHistory([...prev, content], HISTORY_LIMITS))
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
    // Refresh manager's draft snapshot with the latest direct-write value before navigation logic consults it.
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
          return capHistory(newHistory, HISTORY_LIMITS)
        })
      }
    },
    [draftsRef, saveDrafts, setInputHistory, manager],
  )

  const prepareSubmit = useCallback(
    content => {
      // Refresh draft snapshot - prepareSubmit reads stack to compute newStack.
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
