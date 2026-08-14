/** Pure text-editing transforms shared by the composer and inline reply boxes. */

import { nextMarker, parseListLine } from './listMarker'
import { leadingWhitespaceLen, lineEndOffset, lineStartOffset } from './textareaPosition'

/** Characters that auto-pair when typed over a selection. */
const WRAP_PAIRS = {
  "'": "'",
  '"': '"',
  '`': '`',
  '(': ')',
  '[': ']',
  '{': '}',
}

/**
 * Wrap the selection in `<this></this>`, or insert an empty pair at the caret with no selection.
 * Caret lands after the closing tag when wrapping, or between the tags when inserting empty.
 *
 * @param {string} value
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{value: string, selStart: number, selEnd: number}}
 */
export function wrapInTags(value, selStart, selEnd) {
  const hasSelection = selStart !== selEnd
  const selection = value.slice(selStart, selEnd)
  const before = value.slice(0, selStart)
  const after = value.slice(selEnd)
  const wrapped = `<this>${selection}</this>`
  const newPos = hasSelection ? selStart + wrapped.length : selStart + 6

  return { value: before + wrapped + after, selStart: newPos, selEnd: newPos }
}

/**
 * Shift+Enter smart newline: inherits the current line's leading whitespace; on list lines,
 * continues the marker (auto-incremented for numbered, unchecked for tasks), or exits the list
 * if the marker is empty. Reads only `selStart` - a live selection's tail is left intact.
 *
 * @param {string} value
 * @param {number} selStart
 * @returns {{value: string, selStart: number, selEnd: number}}
 */
export function shiftEnter(value, selStart) {
  const caret = selStart
  const lineStart = lineStartOffset(value, caret)
  const lineEnd = lineEndOffset(value, caret)
  const lineText = value.slice(lineStart, lineEnd)
  const parsed = parseListLine(lineText)

  if (parsed && parsed.content.length === 0) {
    const indent = parsed.leadingWhitespace
    const newValue = `${value.slice(0, lineStart)}${indent}\n${indent}${value.slice(lineEnd)}`
    const pos = lineStart + indent.length + 1 + indent.length
    return { value: newValue, selStart: pos, selEnd: pos }
  }

  let prefix
  if (parsed) {
    prefix = `${parsed.leadingWhitespace}${nextMarker(parsed)}`
  } else {
    const leadingLen = leadingWhitespaceLen(value, lineStart)
    prefix = value.slice(lineStart, lineStart + leadingLen)
  }

  const newValue = `${value.slice(0, caret)}\n${prefix}${value.slice(caret)}`
  const pos = caret + 1 + prefix.length
  return { value: newValue, selStart: pos, selEnd: pos }
}

/**
 * Tab/Shift+Tab indent or dedent. Leading whitespace snaps to the next/previous multiple of 2;
 * a multi-line selection applies per-line, last-to-first, so earlier offsets stay valid.
 *
 * @param {string} value
 * @param {number} selStart
 * @param {number} selEnd
 * @param {boolean} dedent - True for Shift+Tab.
 * @returns {{value: string, selStart: number, selEnd: number} | null} Null when dedent is a no-op.
 */
export function tabKey(value, selStart, selEnd, dedent) {
  if (selStart !== selEnd && value.slice(selStart, selEnd).includes('\n')) {
    return applyMultiLineSnap(value, selStart, selEnd, dedent)
  }

  const lineStart = lineStartOffset(value, selStart)
  const leadingLen = leadingWhitespaceLen(value, lineStart)
  const inLeadingZone = selStart - lineStart <= leadingLen

  if (dedent) {
    if (leadingLen === 0) {
      return null
    }
    const { value: newValue, removed } = snapDedentLine(value, lineStart, leadingLen)
    const newStart = Math.max(lineStart, selStart - removed)
    const newEnd = Math.max(lineStart, selEnd - removed)
    return { value: newValue, selStart: newStart, selEnd: newEnd }
  }

  if (selStart !== selEnd) {
    // Single-line non-empty selection - replace with 2 spaces.
    const newValue = `${value.slice(0, selStart)}  ${value.slice(selEnd)}`
    const pos = selStart + 2
    return { value: newValue, selStart: pos, selEnd: pos }
  }

  if (inLeadingZone) {
    const { value: newValue, added } = snapIndentLine(value, lineStart, leadingLen)
    const pos = lineStart + leadingLen + added
    return { value: newValue, selStart: pos, selEnd: pos }
  }

  // Content-zone caret with no selection - insert 2 spaces at caret.
  const newValue = `${value.slice(0, selStart)}  ${value.slice(selStart)}`
  const pos = selStart + 2
  return { value: newValue, selStart: pos, selEnd: pos }
}

/** Insert spaces at lineStart to snap leading whitespace up to the next multiple of 2. */
function snapIndentLine(value, lineStart, leadingLen) {
  const toAdd = 2 - (leadingLen % 2)
  return {
    value: value.slice(0, lineStart) + ' '.repeat(toAdd) + value.slice(lineStart),
    added: toAdd,
  }
}

/** Remove leading whitespace at lineStart to snap down to the previous multiple of 2. */
function snapDedentLine(value, lineStart, leadingLen) {
  if (leadingLen === 0) {
    return { value, removed: 0 }
  }
  const toRemove = leadingLen % 2 || 2
  return { value: value.slice(0, lineStart) + value.slice(lineStart + toRemove), removed: toRemove }
}

/** Apply per-line indent or dedent to every line touched by [selStart, selEnd]. */
function applyMultiLineSnap(value, selStart, selEnd, dedent) {
  const firstLineStart = lineStartOffset(value, selStart)
  const lineStarts = [firstLineStart]
  for (let i = firstLineStart; i < selEnd; i++) {
    if (value[i] === '\n' && i + 1 < selEnd) {
      lineStarts.push(i + 1)
    }
  }

  // Thread the mutating value through each line, last-to-first, so earlier offsets stay valid.
  let current = value
  let totalDelta = 0
  for (let j = lineStarts.length - 1; j >= 0; j--) {
    const ls = lineStarts[j]
    const ll = leadingWhitespaceLen(current, ls)
    if (dedent) {
      const result = snapDedentLine(current, ls, ll)
      current = result.value
      totalDelta -= result.removed
    } else {
      const result = snapIndentLine(current, ls, ll)
      current = result.value
      totalDelta += result.added
    }
  }

  return {
    value: current,
    selStart: firstLineStart,
    selEnd: Math.max(firstLineStart, selEnd + totalDelta),
  }
}

/**
 * Wrap a selection in a matching pair (quotes, brackets) when `key` is a paired character.
 * No-op (returns null) with no selection or an unpaired key.
 *
 * @param {string} value
 * @param {number} selStart
 * @param {number} selEnd
 * @param {string} key - The character that was typed.
 * @returns {{value: string, selStart: number, selEnd: number} | null}
 */
export function wrapPair(value, selStart, selEnd, key) {
  if (selStart === selEnd) {
    return null
  }
  const close = WRAP_PAIRS[key]
  if (!close) {
    return null
  }

  const before = value.slice(0, selStart)
  const selected = value.slice(selStart, selEnd)
  const after = value.slice(selEnd)
  const newValue = before + key + selected + close + after
  const newPos = selEnd + 2 // +1 open +1 close, cursor after close

  return { value: newValue, selStart: newPos, selEnd: newPos }
}
