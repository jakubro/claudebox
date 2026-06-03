/** Autocomplete state management for /commands — replaces Tribute.js. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useCapabilities from '../../../../../hooks/useCapabilities'
import { categorizeCommands, flattenCommands } from '../../../../../utils/categorize'
import { leadingCommand } from '../utils/leadingCommand'

/**
 * Manage slash-command autocomplete state for the chat textarea.
 *
 * Activates when '/' is typed at position 0 (unless an existing leading
 * slash command is already present), or when Ctrl+Space is pressed while
 * the cursor sits within a leading slash command.
 *
 * @param {RefObject} textareaRef - Ref to textarea element.
 * @param {object|null} commands - Categorized commands from session data.
 */
export default function useAutocomplete(textareaRef, commands) {
  const { capabilities } = useCapabilities()
  const skillsEnabled = capabilities ? capabilities.supports_skills : true

  const [visible, setVisible] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const visibleRef = useRef(visible)
  const composingRef = useRef(false)

  const allItems = useMemo(() => {
    if (!skillsEnabled) {
      return []
    }
    const categorized = categorizeCommands(commands)
    return flattenCommands(categorized, { excludeNonInvocable: true })
  }, [commands, skillsEnabled])

  const filteredItems = useMemo(() => {
    if (!filter) {
      return allItems
    }
    const lower = filter.toLowerCase()
    return allItems.filter(item => item.name.toLowerCase().includes(lower))
  }, [allItems, filter])

  // Reset selection when filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset on filter change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Track visibility for textarea input handler
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  /** Select a command and insert into textarea, preserving any trailing args. */
  const select = useCallback(
    item => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }
      const value = textarea.value
      const caret = textarea.selectionStart
      const lc = leadingCommand(value)
      if (lc) {
        // Replacement boundary: if the picked command starts with the typed
        // leading token, the user was mid-typing the command — consume the
        // whole token (lc.end). Otherwise the token contains user text past
        // the caret (e.g. `/refinefoo bar baz` typed in front of existing
        // text) — preserve everything from the caret onward.
        const typed = value.slice(1, lc.end)
        const userWasTypingCommand = item.name.toLowerCase().startsWith(typed.toLowerCase())
        const boundary = userWasTypingCommand ? lc.end : caret
        const trailing = value.slice(boundary)
        textarea.value = `/${item.name}${trailing.startsWith(' ') ? trailing : ` ${trailing}`}`
      } else {
        textarea.value = `/${item.name} `
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      // Place caret immediately after the inserted command + trailing space so
      // the user can keep typing arguments. Without this the caret defaults to
      // value.length (browser default), which lands past any preserved args.
      const cursorPos = 2 + item.name.length
      textarea.setSelectionRange(cursorPos, cursorPos)
      setVisible(false)
      setFilter('')
      textarea.focus()
    },
    [textareaRef],
  )

  /** Dismiss autocomplete. */
  const dismiss = useCallback(() => {
    setVisible(false)
    setFilter('')
  }, [])

  /** Handle keyboard events for autocomplete navigation (called from ChatInput keydown). */
  const handleKeyDown = useCallback(
    e => {
      // Ctrl+Space activates the picker when the cursor sits on a leading slash command.
      if (e.ctrlKey && e.key === ' ') {
        const textarea = textareaRef.current
        if (!textarea) {
          return false
        }
        const value = textarea.value
        const cursorPos = textarea.selectionStart
        const lc = leadingCommand(value)
        if (lc?.token && cursorPos >= 1 && cursorPos <= lc.end) {
          e.preventDefault()
          setFilter(value.slice(1, cursorPos))
          setVisible(true)
          return true
        }
        return false
      }

      if (!visible) {
        return false
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % filteredItems.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + filteredItems.length) % filteredItems.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // Defer during IME composition; let the user commit before accepting.
        if (composingRef.current) {
          return false
        }
        if (filteredItems.length > 0) {
          e.preventDefault()
          select(filteredItems[selectedIndex])
          return true
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
        return true
      }
      return false
    },
    [visible, filteredItems, selectedIndex, select, dismiss, textareaRef],
  )

  // Listen to textarea input to show/hide autocomplete
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const handleInput = () => {
      const value = textarea.value
      const cursorPos = textarea.selectionStart

      // Suppress if doubled '/' at start — user is editing in front of an
      // existing leading slash command, not invoking a fresh autocomplete.
      if (value.startsWith('//')) {
        setVisible(false)
        setFilter('')
        return
      }

      // Auto-trigger: textarea starts with a leading '/cmd' token and the
      // cursor sits inside it. Trailing whitespace + arguments are tolerated
      // (typing '/' at position 0 of a non-empty textarea must still open
      // the picker — see Behavior table).
      const lc = leadingCommand(value)
      if (lc?.token && cursorPos >= 1 && cursorPos <= lc.end) {
        setFilter(value.slice(1, cursorPos))
        setVisible(true)
        return
      }

      setVisible(false)
      setFilter('')
    }

    const handleCompositionStart = () => {
      composingRef.current = true
    }
    const handleCompositionEnd = () => {
      composingRef.current = false
    }

    textarea.addEventListener('input', handleInput)
    textarea.addEventListener('compositionstart', handleCompositionStart)
    textarea.addEventListener('compositionend', handleCompositionEnd)
    return () => {
      textarea.removeEventListener('input', handleInput)
      textarea.removeEventListener('compositionstart', handleCompositionStart)
      textarea.removeEventListener('compositionend', handleCompositionEnd)
    }
  }, [textareaRef])

  return {
    visible: visible && skillsEnabled,
    items: skillsEnabled ? filteredItems : [],
    selectedIndex,
    filter,
    select,
    dismiss,
    handleKeyDown,
  }
}
