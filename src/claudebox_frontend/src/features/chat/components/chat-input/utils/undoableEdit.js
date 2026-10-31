/** Apply an editing shortcut's result to a textarea as one browser edit, so Ctrl+Z undoes it. */

const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
).set

/**
 * Replace only the span that differs through the browser's insert-text edit, then place the selection
 * (omitted selStart leaves it); where no browser edit applies, assign the value and fire `input`.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ value: string, selStart?: number, selEnd?: number }} result
 */
export function applyUndoableEdit(textarea, result) {
  const current = textarea.value
  const next = result.value

  if (current !== next) {
    const [start, end] = changedSpan(current, next, textarea.selectionStart, textarea.selectionEnd)
    const inserted = next.slice(start, next.length - (current.length - end))
    textarea.setSelectionRange(start, end)
    const applied = inserted
      ? document.execCommand?.('insertText', false, inserted)
      : document.execCommand?.('delete')

    if (!applied || textarea.value !== next) {
      nativeValueSetter.call(textarea, next)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  if (result.selStart !== undefined) {
    textarea.setSelectionRange(result.selStart, result.selEnd)
  }
}

// Undo re-selects the replaced span, so a result that only replaces the selection keeps it as the
// span even where the replacement shares edge characters with it (wrapping `<b>` in tags).
function changedSpan(current, next, selStart, selEnd) {
  if (
    next.startsWith(current.slice(0, selStart)) &&
    next.endsWith(current.slice(selEnd)) &&
    next.length >= current.length - (selEnd - selStart)
  ) {
    return [selStart, selEnd]
  }

  const max = Math.min(current.length, next.length)
  let head = 0
  while (head < max && current[head] === next[head]) {
    head++
  }
  let tail = 0
  while (tail < max - head && current.at(-1 - tail) === next.at(-1 - tail)) {
    tail++
  }
  return [head, current.length - tail]
}
