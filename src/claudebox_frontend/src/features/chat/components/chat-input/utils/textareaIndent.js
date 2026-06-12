/** Tab/Shift+Tab indent and dedent transformations on the chat textarea. */

import { leadingWhitespaceLen, lineStartOffset } from './textareaPosition'

/**
 * Apply Tab/Shift+Tab indent or dedent to the textarea. Returns true when the
 * value changed (caller should fire input event + resize). Picker priority is
 * enforced upstream by ChatInput.jsx delegation; if the picker handled Tab,
 * this is never called.
 *
 * @param {HTMLTextAreaElement} ta
 * @param {boolean} dedent - True for Shift+Tab.
 * @returns {boolean}
 */
export function applyTabKey(ta, dedent) {
  const value = ta.value
  const start = ta.selectionStart
  const end = ta.selectionEnd

  if (start !== end && value.slice(start, end).includes('\n')) {
    applyMultiLineSnap(ta, start, end, dedent)
    return true
  }

  const lineStart = lineStartOffset(value, start)
  const leadingLen = leadingWhitespaceLen(value, lineStart)
  const inLeadingZone = start - lineStart <= leadingLen

  if (dedent) {
    if (leadingLen === 0) {
      return false
    }
    const removed = snapDedentLine(ta, lineStart, leadingLen)
    ta.selectionStart = Math.max(lineStart, start - removed)
    ta.selectionEnd = Math.max(lineStart, end - removed)
    return true
  }

  if (start !== end) {
    // Single-line non-empty selection - replace with 2 spaces.
    ta.value = `${value.slice(0, start)}  ${value.slice(end)}`
    ta.selectionStart = ta.selectionEnd = start + 2
    return true
  }

  if (inLeadingZone) {
    const added = snapIndentLine(ta, lineStart, leadingLen)
    ta.selectionStart = ta.selectionEnd = lineStart + leadingLen + added
    return true
  }

  // Content-zone caret with no selection - insert 2 spaces at caret.
  ta.value = `${value.slice(0, start)}  ${value.slice(start)}`
  ta.selectionStart = ta.selectionEnd = start + 2
  return true
}

/** Insert spaces at lineStart to snap leading whitespace up to the next multiple of 2. Returns count added. */
function snapIndentLine(ta, lineStart, leadingLen) {
  const toAdd = 2 - (leadingLen % 2)
  ta.value = ta.value.slice(0, lineStart) + ' '.repeat(toAdd) + ta.value.slice(lineStart)
  return toAdd
}

/** Remove leading whitespace at lineStart to snap down to the previous multiple of 2. Returns count removed. */
function snapDedentLine(ta, lineStart, leadingLen) {
  if (leadingLen === 0) {
    return 0
  }
  const toRemove = leadingLen % 2 || 2
  ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + toRemove)
  return toRemove
}

/** Apply per-line indent or dedent to every line touched by [selStart, selEnd]; updates selection. */
function applyMultiLineSnap(ta, selStart, selEnd, dedent) {
  const startValue = ta.value
  const firstLineStart = lineStartOffset(startValue, selStart)
  const lineStarts = [firstLineStart]
  for (let i = firstLineStart; i < selEnd; i++) {
    if (startValue[i] === '\n' && i + 1 < selEnd) {
      lineStarts.push(i + 1)
    }
  }

  let totalDelta = 0
  // Apply last-to-first so earlier offsets stay valid after each in-place mutation.
  for (let j = lineStarts.length - 1; j >= 0; j--) {
    const ls = lineStarts[j]
    const ll = leadingWhitespaceLen(ta.value, ls)
    if (dedent) {
      totalDelta -= snapDedentLine(ta, ls, ll)
    } else {
      totalDelta += snapIndentLine(ta, ls, ll)
    }
  }

  ta.selectionStart = firstLineStart
  ta.selectionEnd = Math.max(firstLineStart, selEnd + totalDelta)
}
