/** Serialization utilities for converting structured data to XML strings. */

import { escapeXml } from '../../../../../../../../../utils/xml'

/**
 * Format a single question as structured XML.
 */
export function formatQuestionXml(q, i, selections, otherSelected, otherTexts) {
  const selected = selections[i]
  // Preserve whitespace - check length > 0 instead of trim()
  const hasOther = otherSelected[i] && otherTexts[i]?.length > 0

  const answers = []

  if (q.multiSelect) {
    if (selected instanceof Set) {
      for (const optIdx of selected) {
        const label = q.options[optIdx]?.label
        if (label) {
          answers.push(label)
        }
      }
    }
  } else if (selected !== null && q.options[selected]) {
    answers.push(q.options[selected].label)
  }

  // Add "Other" text (preserve whitespace)
  if (hasOther) {
    answers.push(otherTexts[i])
  }

  if (answers.length === 0) {
    return null
  }

  return `
    <question header="${escapeXml(q.header)}" text="${escapeXml(q.question)}">
        ${answers.map(a => `<answer>${escapeXml(a)}</answer>`).join('\n')}
    </question>
  `
}
