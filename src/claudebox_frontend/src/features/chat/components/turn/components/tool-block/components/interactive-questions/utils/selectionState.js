/** Pure selection-state updates for InteractiveQuestions, no React APIs. */

/**
 * Toggle option selection for a question. multiSelect questions hold a Set;
 * single-select questions hold an option index.
 */
export function nextSelections(prev, qIndex, optIndex, multiSelect) {
  const next = { ...prev }
  if (multiSelect) {
    const set = new Set(prev[qIndex])
    if (set.has(optIndex)) {
      set.delete(optIndex)
    } else {
      set.add(optIndex)
    }
    next[qIndex] = set
  } else {
    next[qIndex] = optIndex
  }
  return next
}

/**
 * Toggle the "Other" flag for a question. multiSelect flips; single-select sets true.
 */
export function nextOtherSelected(prev, qIndex, multiSelect) {
  return { ...prev, [qIndex]: multiSelect ? !prev[qIndex] : true }
}

/**
 * Whether any question carries a non-empty selection or non-empty "Other" text.
 */
export function hasAnySelection(questions, selections, otherSelected, otherTexts) {
  return Boolean(
    questions?.some((q, i) => {
      const selected = selections[i]
      const hasOther = otherSelected[i] && otherTexts[i]?.length > 0
      if (q.multiSelect) {
        return (selected instanceof Set && selected.size > 0) || hasOther
      }
      return selected !== null || hasOther
    }),
  )
}
