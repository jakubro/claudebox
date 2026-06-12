/** Shift+Enter smart newline - indent inheritance + markdown list-marker continuation. */

import { nextMarker, parseListLine } from './listMarker'
import { leadingWhitespaceLen, lineEndOffset, lineStartOffset } from './textareaPosition'

/**
 * Apply Shift+Enter smart newline to the textarea. Layer 1 inherits leading
 * whitespace; layer 2 (list lines) continues the marker, with empty markers
 * exiting the list. Always mutates the textarea (no early-return path).
 *
 * @param {HTMLTextAreaElement} ta
 */
export function applyShiftEnter(ta) {
  const value = ta.value
  const caret = ta.selectionStart
  const lineStart = lineStartOffset(value, caret)
  const lineEnd = lineEndOffset(value, caret)
  const lineText = value.slice(lineStart, lineEnd)
  const parsed = parseListLine(lineText)

  if (parsed && parsed.content.length === 0) {
    // Empty marker - exit the list. Replace marker with empty (keep indent),
    // insert '\n', new line preserves indent.
    const indent = parsed.leadingWhitespace
    ta.value = `${value.slice(0, lineStart)}${indent}\n${indent}${value.slice(lineEnd)}`
    ta.selectionStart = ta.selectionEnd = lineStart + indent.length + 1 + indent.length
    return
  }

  let prefix
  if (parsed) {
    prefix = `${parsed.leadingWhitespace}${nextMarker(parsed)}`
  } else {
    const leadingLen = leadingWhitespaceLen(value, lineStart)
    prefix = value.slice(lineStart, lineStart + leadingLen)
  }

  ta.value = `${value.slice(0, caret)}\n${prefix}${value.slice(caret)}`
  ta.selectionStart = ta.selectionEnd = caret + 1 + prefix.length
}
